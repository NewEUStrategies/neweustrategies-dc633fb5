import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
// The database outbox commits with rejection. Stripe's webhook remains the
// authority for payment completion and the existing invoice/refund notices.
import type { StripeEnv } from "@/lib/stripe.server";

interface RefundJob {
  id: string;
  claimToken: string;
  orderId: string;
  environment: StripeEnv;
  transactionId: string;
}

function parseJob(value: unknown): RefundJob | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.id !== "string" ||
    typeof row.claim_token !== "string" ||
    typeof row.order_id !== "string" ||
    typeof row.transaction_id !== "string" ||
    !/^(pi_|cs_)[A-Za-z0-9_]+$/.test(row.transaction_id) ||
    row.provider !== "stripe" ||
    row.order_status !== "paid" ||
    (row.environment !== "sandbox" && row.environment !== "live")
  )
    return null;
  return {
    id: row.id,
    claimToken: row.claim_token,
    orderId: row.order_id,
    environment: row.environment,
    transactionId: row.transaction_id,
  };
}

export interface RegistrationRefundBatch {
  claimed: number;
  submitted: number;
  failed: number;
  deferred: number;
}

export async function runRegistrationRefunds(
  supabaseAdmin: SupabaseClient<Database>,
  limit = 10,
  deadlineAt = Date.now() + 10_000,
): Promise<RegistrationRefundBatch> {
  const result: RegistrationRefundBatch = { claimed: 0, submitted: 0, failed: 0, deferred: 0 };
  if (Date.now() >= deadlineAt) return result;
  const { data, error } = await supabaseAdmin.rpc("_event_registration_refunds_claim", {
    p_limit: limit,
  });
  if (error) throw error;
  if (!Array.isArray(data)) throw new Error("invalid_refund_batch");
  result.claimed = data.length;
  const { refundTransactionFully } = await import("@/lib/billing/refundProvider.server");
  for (const raw of data) {
    // Claims not reached within the budget become eligible after the lease.
    if (Date.now() >= deadlineAt) {
      result.deferred += 1;
      continue;
    }
    const job = parseJob(raw);
    const row = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? raw : null;
    if (!row || typeof row.id !== "string" || typeof row.claim_token !== "string") {
      throw new Error("invalid_refund_claim");
    }
    const refund = job
      ? await refundTransactionFully(
          job.environment,
          job.transactionId,
          "registration_rejected",
          `event-rejection:${job.orderId}`,
        )
      : { ok: false as const, error: "invalid_refund_order" };
    const { error: settleError, data: settled } = await supabaseAdmin.rpc(
      "_event_registration_refunds_settle",
      {
        p_job_id: row.id,
        p_claim_token: row.claim_token,
        p_refund_id: sqlNullable(refund.ok ? refund.adjustmentId : null),
        p_error: sqlNullable(
          refund.ok ? (refund.adjustmentId ? null : "missing_provider_refund_id") : refund.error,
        ),
      },
    );
    if (settleError) throw settleError;
    // A fast webhook can have completed the job before this acknowledgement.
    if (!settled) continue;
    if (refund.ok && refund.adjustmentId) result.submitted += 1;
    else result.failed += 1;
  }
  return result;
}

/**
 * Generated RPC args mark plpgsql text params as non-null, but the SQL settle
 * contract relies on NULL (`p_error IS NULL`). PostgREST forwards JSON null.
 */
function sqlNullable(value: string | null): string {
  return value as string;
}
