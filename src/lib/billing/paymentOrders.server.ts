// Wszystkie zamówienia płatnicze tenanta dla panelu admina - logika odczytu.
//
// Świadomie przez `context.supabase` (RLS admina), nie przez rolę serwisową:
// panel nie może zobaczyć więcej, niż baza przyzna zalogowanemu adminowi.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Tables } from "@/integrations/supabase/types";

export type PaymentOrderStatusFilter =
  "all" | "pending" | "processing" | "paid" | "failed" | "refunded" | "canceled";

export interface PaymentOrderRow {
  id: string;
  createdAt: string;
  paidAt: string | null;
  status: string;
  kind: string;
  provider: string;
  environment: string | null;
  /** Brak = sesja u operatora nigdy nie została powiązana z zamówieniem. */
  sessionId: string | null;
  amountCents: number;
  currency: string;
  planId: string | null;
  planName: string | null;
  buyerId: string | null;
  buyerEmail: string | null;
}

export interface PaymentOrdersSummary {
  total: number;
  /** Zamówienia „wiszące": pending/processing bez identyfikatora sesji. */
  stuck: number;
  paid: number;
  failed: number;
}

/**
 * Wiersz zamówienia - kolumny WYPROWADZONE z wygenerowanych typów, nie
 * przepisane ręcznie.
 *
 * Ręczna kopia rozjechała się z bazą w dwie strony naraz:
 *  - `provider` i `environment` deklarowała jako `| null` przy kolumnach NOT NULL,
 *    więc kod nosił martwe gałęzie „a jeśli null";
 *  - `status` i `kind` jako `string`, choć w bazie są ENUMAMI - porównanie
 *    z literałem, którego w enumie nie ma (`"canceled"` vs `"cancelled"`),
 *    kompilowało się i po cichu nie trafiało nigdy.
 * `as unknown as OrderRecord[]` kasowało obie różnice. Przy 760 migracjach
 * forward-only to jest jedyna rzecz, która stoi między zmianą kolumny
 * a cichym `undefined` w rozliczeniach.
 */
type OrderRecord = Pick<
  Tables<"payment_orders">,
  | "id"
  | "created_at"
  | "paid_at"
  | "status"
  | "kind"
  | "provider"
  | "environment"
  | "provider_session_id"
  | "amount_cents"
  | "currency"
  | "plan_id"
  | "user_id"
  | "receipt_email"
>;

const SELECT =
  "id, created_at, paid_at, status, kind, provider, environment, provider_session_id, amount_cents, currency, plan_id, user_id, receipt_email";

export async function loadPaymentOrders(
  supabase: SupabaseClient,
  options: { status: PaymentOrderStatusFilter; limit: number },
): Promise<{ rows: PaymentOrderRow[]; summary: PaymentOrdersSummary }> {
  let query = supabase
    .from("payment_orders")
    .select(SELECT)
    .order("created_at", { ascending: false })
    .limit(options.limit);
  if (options.status !== "all") query = query.eq("status", options.status);

  const { data, error } = await query;
  if (error) throw error;
  const records = (data ?? []) as OrderRecord[];

  const planIds = [...new Set(records.map((r) => r.plan_id).filter((v): v is string => !!v))];
  const planNames = new Map<string, string>();
  if (planIds.length > 0) {
    const { data: plans } = await supabase
      .from("access_plans")
      .select("id, name")
      .in("id", planIds);
    for (const plan of (plans ?? []) as { id: string; name: string | null }[]) {
      if (plan.name) planNames.set(plan.id, plan.name);
    }
  }

  const rows: PaymentOrderRow[] = records.map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    paidAt: r.paid_at,
    status: r.status,
    kind: r.kind,
    provider: r.provider ?? "-",
    environment: r.environment,
    sessionId: r.provider_session_id,
    amountCents: r.amount_cents,
    currency: r.currency,
    planId: r.plan_id,
    planName: r.plan_id ? (planNames.get(r.plan_id) ?? null) : null,
    buyerId: r.user_id,
    buyerEmail: r.receipt_email,
  }));

  const summary: PaymentOrdersSummary = {
    total: rows.length,
    stuck: rows.filter(
      (r) => (r.status === "pending" || r.status === "processing") && r.sessionId === null,
    ).length,
    paid: rows.filter((r) => r.status === "paid").length,
    failed: rows.filter((r) => r.status === "failed").length,
  };

  return { rows, summary };
}
