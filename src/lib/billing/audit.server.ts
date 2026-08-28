// Audyt rozliczeń: zamówienia, dziennik webhooków i decyzje korygujące
// (zwrot / obciążenie zwrotne) w jednym widoku księgowym.
//
// PO CO OSOBNY MODUŁ OBOK `reconcile.server`. Uzgadnianie odpowiada na pytanie
// „czego brakuje i jak to naprawić" - patrzy do operatora i porównuje. Audyt
// odpowiada na pytanie „co się wydarzyło i kiedy" - czyta WYŁĄCZNIE naszą bazę
// i nie dzwoni po API. Dzięki temu można go uruchomić także wtedy, gdy Stripe
// jest niedostępny, a wynik jest deterministyczny: to samo zapytanie zawsze
// zwróci ten sam materiał dowodowy.
//
// ZAKRES DANYCH. Świadomie nie wynosimy danych osobowych kupującego - eksport
// trafia do arkusza poza systemem. Identyfikujemy zamówienie po naszym `id`
// i identyfikatorach operatora; powiązanie z osobą zostaje w aplikacji.
//
// Moduł server-only (klient service_role) - importuj wyłącznie z handlerów.
import { toCsv } from "@/lib/csv/formatCsv";

export type AuditEnv = "sandbox" | "live";

export interface AuditOrderRow {
  id: string;
  createdAt: string;
  updatedAt: string | null;
  status: string;
  kind: string;
  amountCents: number | null;
  refundedCents: number;
  currency: string | null;
  eventId: string | null;
  entityType: string | null;
  entityId: string | null;
  providerSessionId: string | null;
  providerPaymentIntentId: string | null;
  providerCustomerId: string | null;
  providerChargeId: string | null;
}

export interface AuditWebhookRow {
  id: string;
  eventId: string | null;
  eventType: string;
  status: string;
  occurredAt: string | null;
  processedAt: string | null;
  durationMs: number | null;
  retryCount: number;
  error: string | null;
}

export interface AuditReport {
  environment: AuditEnv;
  sinceIso: string;
  generatedAt: string;
  orders: AuditOrderRow[];
  webhooks: AuditWebhookRow[];
  totals: {
    orders: number;
    paidCents: number;
    refundedCents: number;
    webhooksFailed: number;
  };
  /** Prawda, gdy trafiliśmy w limit - operator musi zawęzić okno. */
  truncated: boolean;
}

/** Twardy limit wierszy: audyt ma być szybki, a nie zrzucać całą bazę. */
const ROW_LIMIT = 500;

export interface AuditQuery {
  environment: AuditEnv;
  sinceHours: number;
  /** Zawęża audyt do jednego wydarzenia (`payment_orders.metadata.event_id`). */
  eventId?: string | null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Zbiera materiał audytowy z bazy - bez żadnego wywołania do operatora. */
export async function buildAuditReport(query: AuditQuery): Promise<AuditReport> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const sinceIso = new Date(Date.now() - query.sinceHours * 3600_000).toISOString();

  let ordersQuery = supabaseAdmin
    .from("payment_orders")
    .select(
      "id, created_at, updated_at, status, kind, amount_cents, refunded_amount_cents, currency, entity_type, entity_id, metadata, provider_session_id, provider_payment_intent_id, provider_customer_id, provider_charge_id",
    )
    .eq("environment", query.environment)
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(ROW_LIMIT);

  // Filtr po wydarzeniu działa na JSON-ie metadanych - identyfikator jest
  // walidowany jako UUID na wejściu funkcji serwerowej.
  if (query.eventId) ordersQuery = ordersQuery.eq("metadata->>event_id", query.eventId);

  const [ordersRes, hooksRes] = await Promise.all([
    ordersQuery,
    supabaseAdmin
      .from("payment_webhook_events")
      .select(
        "id, event_id, event_type, status, occurred_at, processed_at, duration_ms, retry_count, error",
      )
      .eq("environment", query.environment)
      .gte("occurred_at", sinceIso)
      .order("occurred_at", { ascending: false })
      .limit(ROW_LIMIT),
  ]);

  if (ordersRes.error) throw new Error(`audyt: zamówienia - ${ordersRes.error.message}`);
  if (hooksRes.error) throw new Error(`audyt: zdarzenia - ${hooksRes.error.message}`);

  const orders: AuditOrderRow[] = (ordersRes.data ?? []).map((row) => {
    const metadata = (row.metadata ?? {}) as Record<string, unknown>;
    return {
      id: row.id,
      createdAt: row.created_at,
      updatedAt: row.updated_at ?? null,
      status: row.status,
      kind: row.kind,
      amountCents: num(row.amount_cents),
      refundedCents: num(row.refunded_amount_cents) ?? 0,
      currency: row.currency ?? null,
      eventId: typeof metadata.event_id === "string" ? metadata.event_id : null,
      entityType: row.entity_type ?? null,
      entityId: row.entity_id ?? null,
      providerSessionId: row.provider_session_id ?? null,
      providerPaymentIntentId: row.provider_payment_intent_id ?? null,
      providerCustomerId: row.provider_customer_id ?? null,
      providerChargeId: row.provider_charge_id ?? null,
    };
  });

  const webhooks: AuditWebhookRow[] = (hooksRes.data ?? []).map((row) => ({
    id: row.id,
    eventId: row.event_id ?? null,
    eventType: row.event_type,
    status: row.status,
    occurredAt: row.occurred_at ?? null,
    processedAt: row.processed_at ?? null,
    durationMs: num(row.duration_ms),
    retryCount: row.retry_count ?? 0,
    error: row.error ?? null,
  }));

  return {
    environment: query.environment,
    sinceIso,
    generatedAt: new Date().toISOString(),
    orders,
    webhooks,
    totals: {
      orders: orders.length,
      // „Zaksięgowane" liczymy z zamówień opłaconych i częściowo zwróconych -
      // pełny zwrot nie jest przychodem, więc do sumy nie wchodzi.
      paidCents: orders
        .filter((o) => o.status === "paid" || o.status === "partially_refunded")
        .reduce((sum, o) => sum + (o.amountCents ?? 0), 0),
      refundedCents: orders.reduce((sum, o) => sum + o.refundedCents, 0),
      webhooksFailed: webhooks.filter((w) => w.status === "failed").length,
    },
    truncated: orders.length >= ROW_LIMIT || webhooks.length >= ROW_LIMIT,
  };
}

const ORDER_COLUMNS = [
  "order_id",
  "created_at",
  "updated_at",
  "status",
  "kind",
  "amount_cents",
  "refunded_cents",
  "currency",
  "event_id",
  "entity_type",
  "entity_id",
  "stripe_session_id",
  "stripe_payment_intent_id",
  "stripe_customer_id",
  "stripe_charge_id",
] as const;

const WEBHOOK_COLUMNS = [
  "row_id",
  "stripe_event_id",
  "event_type",
  "status",
  "occurred_at",
  "processed_at",
  "duration_ms",
  "retry_count",
  "error",
] as const;

function orderCells(row: AuditOrderRow): Array<string | number | null> {
  return [
    row.id,
    row.createdAt,
    row.updatedAt,
    row.status,
    row.kind,
    row.amountCents,
    row.refundedCents,
    row.currency,
    row.eventId,
    row.entityType,
    row.entityId,
    row.providerSessionId,
    row.providerPaymentIntentId,
    row.providerCustomerId,
    row.providerChargeId,
  ];
}

function webhookCells(row: AuditWebhookRow): Array<string | number | null> {
  return [
    row.id,
    row.eventId,
    row.eventType,
    row.status,
    row.occurredAt,
    row.processedAt,
    row.durationMs,
    row.retryCount,
    row.error,
  ];
}

export interface AuditExport {
  fileName: string;
  mimeType: string;
  /** Zawartość pliku w base64 - jedyny kształt bezpieczny dla granicy RPC. */
  base64: string;
}

/**
 * CSV łączy obie tabele w jednym pliku (sekcje rozdzielone pustym wierszem),
 * bo arkusz księgowy jest czytany liniowo, a XLSX rozdziela je na zakładki.
 */
export function auditToCsv(report: AuditReport): string {
  return [
    toCsv(ORDER_COLUMNS, report.orders.map(orderCells)),
    "",
    toCsv(WEBHOOK_COLUMNS, report.webhooks.map(webhookCells)),
  ].join("\n");
}

function base64Of(text: string): string {
  return Buffer.from(text, "utf-8").toString("base64");
}

/** Buduje plik eksportu w żądanym formacie. */
export async function buildAuditExport(
  report: AuditReport,
  format: "csv" | "xlsx",
): Promise<AuditExport> {
  const day = report.generatedAt.slice(0, 10);
  const stem = `rozliczenia-audyt-${report.environment}-${day}`;

  if (format === "csv") {
    // BOM, bo Excel bez niego traktuje UTF-8 jako stronę kodową systemu
    // i rozsypuje polskie znaki w nazwach statusów.
    return {
      fileName: `${stem}.csv`,
      mimeType: "text/csv;charset=utf-8",
      base64: base64Of(`\uFEFF${auditToCsv(report)}`),
    };
  }

  const XLSX = await import("xlsx");
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([[...ORDER_COLUMNS], ...report.orders.map(orderCells)]),
    "Zamowienia",
  );
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([[...WEBHOOK_COLUMNS], ...report.webhooks.map(webhookCells)]),
    "Webhooki",
  );
  const binary = XLSX.write(book, { bookType: "xlsx", type: "base64" }) as string;
  return {
    fileName: `${stem}.xlsx`,
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    base64: binary,
  };
}
