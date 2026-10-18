// Odczyt stanów rozliczeń i zwrotów dla panelu administratora.
// Bramka: zalogowany + rola `admin` w obszarze wołającego (assertAdmin);
// najemca pochodzi z profilu wołającego, nigdy z ładunku.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  SETTLEMENT_STATUSES,
  deriveSettlementStatus,
  filterSettlementRows,
  type SettlementRow,
} from "@/lib/billing/settlementStatus";

const inputSchema = z.object({
  status: z.enum(["all", ...SETTLEMENT_STATUSES]),
  fromIso: z.string().datetime().nullable(),
  toIso: z.string().datetime().nullable(),
});

export interface SettlementReport {
  rows: SettlementRow[];
  truncated: boolean;
}

const LIMIT = 500;

/**
 * Ile identyfikatorów zamówień idzie w JEDNYM odczycie zleceń zwrotu.
 * `.in(...)` jedzie w adresie żądania GET: zmierzone na postgrest-js 2.116,
 * 100 identyfikatorów to ~4,1 tys. znaków adresu, a pełna strona 500 -
 * ~19,7 tys., ponad bufor wiersza żądania bramki przed PostgREST-em (8 KB,
 * por. `INVITATION_LOOKUP_CHUNK_SIZE` w `admin/invitations.functions.ts`).
 * Odpowiedź 414 wywracała cały raport każdemu najemcy z ponad ~200
 * zamówieniami w oknie. Porcje idą równolegle.
 */
const JOB_LOOKUP_CHUNK = 100;

export const getSettlementReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => inputSchema.parse(input))
  .handler(async ({ data, context }): Promise<SettlementReport> => {
    const { assertAdmin } = await import("@/lib/billing/diagnostics.server");
    const { tenantId } = await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Z metadanych zamówienia (dane kasy, adres paragonu) potrzebny jest
    // jeden znacznik - reszta nie opuszcza bazy.
    let query = supabaseAdmin
      .from("payment_orders")
      .select(
        "id, created_at, kind, status, amount_cents, refunded_amount_cents, currency, environment, needs_manual_review:metadata->needs_manual_review",
      )
      .eq("tenant_id", tenantId);
    // Filtr stanu w SQL, PRZED oknem `limit` - nakładany dopiero w pamięci
    // gubił zamówienia w wybranym stanie leżące za 500 najnowszymi
    // zamówieniami wszystkich stanów. Stany zwrotu zależą od porównania dwóch
    // kolumn (zwrot >= kwota), którego filtr PostgREST nie wyrazi: SQL bierze
    // kandydatów, a dokładny podział robi `filterSettlementRows` tą samą
    // regułą, która nadaje etykietę (`deriveSettlementStatus`).
    switch (data.status) {
      case "all":
        break;
      case "paid":
        query = query.eq("status", "paid").lte("refunded_amount_cents", 0);
        break;
      case "partially_refunded":
        query = query.eq("status", "paid").gt("refunded_amount_cents", 0);
        break;
      case "refunded":
        query = query.or("status.eq.refunded,and(status.eq.paid,refunded_amount_cents.gt.0)");
        break;
      default:
        query = query.eq("status", data.status);
    }
    if (data.fromIso) query = query.gte("created_at", data.fromIso);
    if (data.toIso) query = query.lt("created_at", data.toIso);
    const { data: orders, error } = await query
      .order("created_at", { ascending: false })
      .limit(LIMIT + 1);
    if (error) throw new Error(error.message);

    const truncated = orders.length > LIMIT;
    const page = orders.slice(0, LIMIT);
    const ids = page.map((o) => o.id);
    const parts: string[][] = [];
    for (let i = 0; i < ids.length; i += JOB_LOOKUP_CHUNK) {
      parts.push(ids.slice(i, i + JOB_LOOKUP_CHUNK));
    }
    const lookups = await Promise.all(
      parts.map((part) =>
        supabaseAdmin
          .from("event_registration_refund_jobs")
          .select("payment_order_id, state, last_error")
          .eq("tenant_id", tenantId)
          .in("payment_order_id", part),
      ),
    );
    // Klucz może być `null` (wpłata ręczna bez zamówienia, REG-03) - filtr
    // `in` takich zleceń nie zwraca, a wiersz zamówienia i tak pyta o swój id.
    const jobs = new Map<string | null, { state: string; last_error: string | null }>();
    for (const { data: jobRows, error: jobError } of lookups) {
      if (jobError) throw new Error(jobError.message);
      for (const job of jobRows) jobs.set(job.payment_order_id, job);
    }

    const rows: SettlementRow[] = page.map((o) => {
      const job = jobs.get(o.id);
      return {
        id: o.id,
        createdAt: o.created_at,
        kind: o.kind,
        status: deriveSettlementStatus(o.status, o.amount_cents, o.refunded_amount_cents),
        amountCents: o.amount_cents,
        refundedCents: o.refunded_amount_cents,
        currency: o.currency,
        environment: o.environment,
        refundJobState: job?.state ?? null,
        refundJobError: job?.last_error ?? null,
        needsReview: o.needs_manual_review === true,
      };
    });

    return { rows: filterSettlementRows(rows, data.status), truncated };
  });
