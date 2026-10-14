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

export const getSettlementReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => inputSchema.parse(input))
  .handler(async ({ data, context }): Promise<SettlementReport> => {
    const { assertAdmin } = await import("@/lib/billing/diagnostics.server");
    const { tenantId } = await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let query = supabaseAdmin
      .from("payment_orders")
      .select(
        "id, created_at, kind, status, amount_cents, refunded_amount_cents, currency, environment, metadata",
      )
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(LIMIT + 1);
    if (data.fromIso) query = query.gte("created_at", data.fromIso);
    if (data.toIso) query = query.lt("created_at", data.toIso);
    const { data: orders, error } = await query;
    if (error) throw new Error(error.message);

    const list = orders ?? [];
    const truncated = list.length > LIMIT;
    const page = list.slice(0, LIMIT);
    const ids = page.map((o) => o.id);

    const jobs = new Map<string, { state: string; error: string | null }>();
    if (ids.length > 0) {
      const { data: jobRows, error: jobError } = await supabaseAdmin
        .from("event_registration_refund_jobs")
        .select("payment_order_id, state, last_error")
        .eq("tenant_id", tenantId)
        .in("payment_order_id", ids);
      if (jobError) throw new Error(jobError.message);
      for (const j of jobRows ?? []) {
        // Zlecenie bez zamówienia (wpłata ręczna, REG-03) nie należy do żadnego
        // wiersza tej listy - filtr `in` i tak go nie zwraca, typ pilnuje reszty.
        if (j.payment_order_id === null) continue;
        jobs.set(j.payment_order_id, { state: j.state, error: j.last_error });
      }
    }

    const rows: SettlementRow[] = page.map((o) => {
      const amount = o.amount_cents ?? 0;
      const refunded = o.refunded_amount_cents ?? 0;
      const meta =
        o.metadata && typeof o.metadata === "object" && !Array.isArray(o.metadata)
          ? (o.metadata as Record<string, unknown>)
          : {};
      const job = jobs.get(o.id);
      return {
        id: o.id,
        createdAt: o.created_at,
        kind: String(o.kind),
        status: deriveSettlementStatus(String(o.status), amount, refunded),
        rawStatus: String(o.status),
        amountCents: amount,
        refundedCents: refunded,
        currency: o.currency,
        environment: o.environment ?? null,
        refundJobState: job?.state ?? null,
        refundJobError: job?.error ?? null,
        needsReview: meta["needs_manual_review"] === true,
      };
    });

    return { rows: filterSettlementRows(rows, data.status), truncated };
  });
