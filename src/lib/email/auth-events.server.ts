// Warstwa danych diagnostyki webhooka maili autoryzacyjnych.
//
// Źródłem prawdy jest tabela auth_email_events, do której pisze
// /platform/email/auth/webhook. Tabela jest dostępna wyłącznie dla
// service_role, więc odczyt idzie przez klienta admina - rola wywołującego
// jest wcześniej weryfikowana w middleware server function.

export type AuthEventStatus = "enqueued" | "rejected" | "failed";

export interface AuthEmailEventRow {
  id: string;
  createdAt: string;
  runId: string | null;
  messageId: string | null;
  emailType: string;
  lang: string | null;
  langSource: string | null;
  langFallback: boolean;
  langRaw: string | null;
  recipientMasked: string | null;
  recipientDomain: string | null;
  sender: string | null;
  senderDomain: string | null;
  subject: string | null;
  redirectTo: string | null;
  actionUrlHost: string | null;
  greetingName: string | null;
  status: AuthEventStatus;
  errorMessage: string | null;
  durationMs: number | null;
}

export interface AuthEmailEventsReport {
  days: number;
  totals: {
    total: number;
    enqueued: number;
    failed: number;
    pl: number;
    en: number;
    fallback: number;
  };
  bySource: { source: string; count: number }[];
  byType: { type: string; count: number }[];
  rows: AuthEmailEventRow[];
  rowsTotal: number;
  infraReady: boolean;
  generatedAt: string;
}

export interface AuthEmailEventsQuery {
  days: number;
  emailType: string | null;
  lang: string | null;
  status: AuthEventStatus | null;
  fallbackOnly: boolean;
  search: string | null;
  page: number;
  pageSize: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function statusOf(value: unknown): AuthEventStatus {
  return value === "rejected" || value === "failed" ? value : "enqueued";
}

function mapRow(raw: Record<string, unknown>): AuthEmailEventRow {
  return {
    id: str(raw, "id") ?? crypto.randomUUID(),
    createdAt: str(raw, "created_at") ?? "",
    runId: str(raw, "run_id"),
    messageId: str(raw, "message_id"),
    emailType: str(raw, "email_type") ?? "unknown",
    lang: str(raw, "lang"),
    langSource: str(raw, "lang_source"),
    langFallback: raw.lang_fallback === true,
    langRaw: str(raw, "lang_raw"),
    recipientMasked: str(raw, "recipient_masked"),
    recipientDomain: str(raw, "recipient_domain"),
    sender: str(raw, "sender"),
    senderDomain: str(raw, "sender_domain"),
    subject: str(raw, "subject"),
    redirectTo: str(raw, "redirect_to"),
    actionUrlHost: str(raw, "action_url_host"),
    greetingName: str(raw, "greeting_name"),
    status: statusOf(raw.status),
    errorMessage: str(raw, "error_message"),
    durationMs: typeof raw.duration_ms === "number" ? raw.duration_ms : null,
  };
}

function emptyReport(days: number, infraReady: boolean): AuthEmailEventsReport {
  return {
    days,
    totals: { total: 0, enqueued: 0, failed: 0, pl: 0, en: 0, fallback: 0 },
    bySource: [],
    byType: [],
    rows: [],
    rowsTotal: 0,
    infraReady,
    generatedAt: new Date().toISOString(),
  };
}

function tally(values: (string | null)[]): { key: string; count: number }[] {
  const map = new Map<string, number>();
  for (const value of values) {
    const key = value ?? "unknown";
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count);
}

export async function fetchAuthEmailEvents(
  query: AuthEmailEventsQuery,
): Promise<AuthEmailEventsReport> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - (query.days - 1));
  since.setUTCHours(0, 0, 0, 0);

  const { data, error } = await supabaseAdmin
    .from("auth_email_events" as never)
    .select("*")
    .gte("created_at", since.toISOString())
    .order("created_at", { ascending: false })
    .limit(3000);

  if (error) {
    const missing = /relation .* does not exist|schema cache/i.test(error.message);
    if (missing) return emptyReport(query.days, false);
    throw new Error(error.message);
  }

  const all = (Array.isArray(data) ? data.filter(isRecord) : []).map(mapRow);

  const totals = all.reduce(
    (acc, row) => {
      acc.total += 1;
      if (row.status === "enqueued") acc.enqueued += 1;
      else acc.failed += 1;
      if (row.lang === "pl") acc.pl += 1;
      if (row.lang === "en") acc.en += 1;
      if (row.langFallback) acc.fallback += 1;
      return acc;
    },
    { total: 0, enqueued: 0, failed: 0, pl: 0, en: 0, fallback: 0 },
  );

  const needle = query.search?.toLowerCase() ?? null;
  const filtered = all.filter((row) => {
    if (query.emailType && row.emailType !== query.emailType) return false;
    if (query.lang && row.lang !== query.lang) return false;
    if (query.status && row.status !== query.status) return false;
    if (query.fallbackOnly && !row.langFallback) return false;
    if (needle) {
      const haystack = [
        row.recipientMasked,
        row.recipientDomain,
        row.subject,
        row.redirectTo,
        row.runId,
        row.messageId,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  });

  const start = (query.page - 1) * query.pageSize;

  return {
    days: query.days,
    totals,
    bySource: tally(all.map((r) => r.langSource)).map((e) => ({
      source: e.key,
      count: e.count,
    })),
    byType: tally(all.map((r) => r.emailType)).map((e) => ({ type: e.key, count: e.count })),
    rows: filtered.slice(start, start + query.pageSize),
    rowsTotal: filtered.length,
    infraReady: true,
    generatedAt: new Date().toISOString(),
  };
}
