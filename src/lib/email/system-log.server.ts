// Warstwa danych raportu wysyłek maili systemowych (auth + transakcyjne).
//
// Źródłem prawdy jest tabela email_send_log, do której pisze webhook auth oraz
// dispatcher kolejki. Jeden e-mail generuje wiele wierszy (pending -> sent/dlq),
// więc KAŻDE zliczenie deduplikujemy po message_id, biorąc najnowszy wiersz.
//
// Tabela jest dostępna wyłącznie dla service_role (RLS), dlatego odczyt idzie
// przez klienta admina - wywołujący jest wcześniej weryfikowany rolą admina
// w middleware server function.

export type SystemEmailStatus =
  "pending" | "sent" | "dlq" | "suppressed" | "failed" | "bounced" | "complained";

export interface SystemEmailRow {
  messageId: string;
  templateName: string;
  recipientEmail: string;
  status: SystemEmailStatus;
  errorMessage: string | null;
  createdAt: string;
  attempts: number;
}

export interface SystemEmailDayPoint {
  day: string;
  sent: number;
  failed: number;
  suppressed: number;
  pending: number;
}

export interface SystemEmailReport {
  days: number;
  totals: {
    total: number;
    sent: number;
    failed: number;
    suppressed: number;
    pending: number;
  };
  deliveryRate: number | null;
  templates: string[];
  series: SystemEmailDayPoint[];
  rows: SystemEmailRow[];
  rowsTotal: number;
  suppressedRecipients: number;
  infraReady: boolean;
  generatedAt: string;
}

export interface SystemEmailQuery {
  days: number;
  template: string | null;
  status: SystemEmailStatus | null;
  search: string | null;
  page: number;
  pageSize: number;
}

const FAILED: readonly SystemEmailStatus[] = ["dlq", "failed", "bounced", "complained"];

function statusOf(value: unknown): SystemEmailStatus {
  const allowed: readonly string[] = [
    "pending",
    "sent",
    "dlq",
    "suppressed",
    "failed",
    "bounced",
    "complained",
  ];
  return typeof value === "string" && allowed.includes(value)
    ? (value as SystemEmailStatus)
    : "pending";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  return typeof value === "string" ? value : "";
}

function nullableText(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function emptyReport(days: number, infraReady: boolean): SystemEmailReport {
  return {
    days,
    totals: { total: 0, sent: 0, failed: 0, suppressed: 0, pending: 0 },
    deliveryRate: null,
    templates: [],
    series: [],
    rows: [],
    rowsTotal: 0,
    suppressedRecipients: 0,
    infraReady,
    generatedAt: new Date().toISOString(),
  };
}

/** Deduplikacja: najnowszy wiersz na message_id (kolejność wejściowa: malejąco po dacie). */
function dedupe(raw: Record<string, unknown>[]): SystemEmailRow[] {
  const seen = new Map<string, SystemEmailRow>();
  const attempts = new Map<string, number>();

  for (const item of raw) {
    const messageId = text(item, "message_id") || text(item, "id");
    if (!messageId) continue;
    attempts.set(messageId, (attempts.get(messageId) ?? 0) + 1);
    if (seen.has(messageId)) continue;
    seen.set(messageId, {
      messageId,
      templateName: text(item, "template_name") || "unknown",
      recipientEmail: text(item, "recipient_email"),
      status: statusOf(item.status),
      errorMessage: nullableText(item, "error_message"),
      createdAt: text(item, "created_at"),
      attempts: 0,
    });
  }

  return [...seen.values()].map((row) => ({
    ...row,
    attempts: attempts.get(row.messageId) ?? 1,
  }));
}

function buildSeries(rows: SystemEmailRow[], days: number): SystemEmailDayPoint[] {
  const buckets = new Map<string, SystemEmailDayPoint>();
  const today = new Date();
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    buckets.set(key, { day: key, sent: 0, failed: 0, suppressed: 0, pending: 0 });
  }

  for (const row of rows) {
    const key = row.createdAt.slice(0, 10);
    const bucket = buckets.get(key);
    if (!bucket) continue;
    if (row.status === "sent") bucket.sent += 1;
    else if (FAILED.includes(row.status)) bucket.failed += 1;
    else if (row.status === "suppressed") bucket.suppressed += 1;
    else bucket.pending += 1;
  }

  return [...buckets.values()];
}

export async function fetchSystemEmailReport(query: SystemEmailQuery): Promise<SystemEmailReport> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - (query.days - 1));
  since.setUTCHours(0, 0, 0, 0);

  const { data, error } = await supabaseAdmin
    .from("email_send_log")
    .select("message_id, template_name, recipient_email, status, error_message, created_at")
    .gte("created_at", since.toISOString())
    .order("created_at", { ascending: false })
    .limit(5000);

  if (error) {
    // Brak tabeli = infrastruktura mailowa nie jest jeszcze gotowa.
    const missing = /relation .* does not exist|schema cache/i.test(error.message);
    if (missing) return emptyReport(query.days, false);
    throw new Error(error.message);
  }

  const all = dedupe(Array.isArray(data) ? data.filter(isRecord) : []);

  const totals = all.reduce(
    (acc, row) => {
      acc.total += 1;
      if (row.status === "sent") acc.sent += 1;
      else if (FAILED.includes(row.status)) acc.failed += 1;
      else if (row.status === "suppressed") acc.suppressed += 1;
      else acc.pending += 1;
      return acc;
    },
    { total: 0, sent: 0, failed: 0, suppressed: 0, pending: 0 },
  );

  const settled = totals.sent + totals.failed;
  const deliveryRate = settled > 0 ? totals.sent / settled : null;

  const needle = query.search?.trim().toLowerCase() ?? "";
  const filtered = all.filter((row) => {
    if (query.template && row.templateName !== query.template) return false;
    if (query.status) {
      if (query.status === "dlq" ? !FAILED.includes(row.status) : row.status !== query.status) {
        return false;
      }
    }
    if (needle && !row.recipientEmail.toLowerCase().includes(needle)) return false;
    return true;
  });

  const start = (query.page - 1) * query.pageSize;

  // Liczba AKTYWNYCH wykluczeń z listy kanonicznej. Wcześniej liczyliśmy wiersze
  // zaszłej tabeli `suppressed_emails`, która nie znała wygaśnięcia ani zdjęcia
  // blokady - raport pokazywał więc adresy, na które od dawna wolno już wysyłać.
  let suppressedRecipients = 0;
  const { count } = await supabaseAdmin
    .from("email_suppressions")
    .select("id", { count: "exact", head: true })
    .is("released_at", null)
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`);
  if (typeof count === "number") suppressedRecipients = count;

  return {
    days: query.days,
    totals,
    deliveryRate,
    templates: [...new Set(all.map((row) => row.templateName))].sort(),
    series: buildSeries(all, query.days),
    rows: filtered.slice(start, start + query.pageSize),
    rowsTotal: filtered.length,
    suppressedRecipients,
    infraReady: true,
    generatedAt: new Date().toISOString(),
  };
}
