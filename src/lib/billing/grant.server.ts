// Server-only entitlement granting. Shared by the Stripe webhook and the
// mock-mode finaliser so "a paid order unlocks content" lives in one place and
// behaves identically in both paths. Uses the service-role client because
// user_subscriptions / user_purchases are insert-locked to service_role.
import { periodEndFor, entitlementForOrder } from "@/lib/billing/entitlement";

export interface GrantableOrder {
  id: string;
  user_id: string;
  tenant_id: string;
  kind: "subscription" | "one_time";
  plan_id: string | null;
  entity_type: "post" | "page" | "media" | null;
  entity_id: string | null;
  amount_cents: number | null;
  currency: string | null;
}

/**
 * Grant the entitlement a paid order represents.
 *
 * - subscription -> active user_subscriptions row, period end derived from the
 *   plan interval. Idempotent on external_ref (Stripe retries webhooks), so a
 *   replay refreshes the period instead of duplicating the row.
 * - one_time -> active user_purchases row, idempotent on the
 *   (user_id, entity_type, entity_id) unique key.
 *
 * This is what has_content_access() reads, so it is the single point that turns
 * payment into access.
 *
 * **Throws on any database failure - by contract.** The Stripe webhook's
 * "grant-before-flip" safety net depends on it: the handler turns a thrown error
 * into HTTP 500, which makes Stripe redeliver the event and retry the grant.
 * `supabase-js` does NOT throw on write errors (it returns them in `error`), so
 * every read that gates the grant and every write that performs it is checked
 * explicitly below. Swallowing one of them would let the caller flip the order
 * to `paid` and answer 200 - Stripe would never retry and the customer would
 * stay charged with no access.
 */
export async function grantEntitlement(
  order: GrantableOrder,
  externalRef: string | null,
): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const entitlement = entitlementForOrder(order);

  if (entitlement.type === "subscription") {
    // Lifetime (one-time plan purchase) => no expiry; has_content_access()
    // treats current_period_end IS NULL as never-expiring.
    let periodEnd: string | null = null;
    if (!entitlement.lifetime) {
      const { data: plan, error: planErr } = await supabaseAdmin
        .from("access_plans")
        .select("interval")
        .eq("id", entitlement.planId)
        .maybeSingle();
      // A MISSING plan row is tolerated (periodEndFor(null) => safe default);
      // a FAILED lookup is not - it would silently grant the default period
      // instead of the one the customer paid for.
      if (planErr) throw new Error(`grant: access_plans lookup failed: ${planErr.message}`);
      periodEnd = periodEndFor(plan?.interval ?? null, new Date()).toISOString();
    }
    const ref = externalRef ?? order.id;

    const { data: existing, error: existingErr } = await supabaseAdmin
      .from("user_subscriptions")
      .select("id")
      .eq("external_ref", ref)
      .maybeSingle();
    // This read picks insert-vs-refresh. If it fails we must not fall through to
    // the insert branch: external_ref is unique, so the insert would fail too
    // and the whole grant would be lost.
    if (existingErr) {
      throw new Error(`grant: user_subscriptions lookup failed (${ref}): ${existingErr.message}`);
    }

    if (existing) {
      const { error } = await supabaseAdmin
        .from("user_subscriptions")
        .update({ status: "active", current_period_end: periodEnd, canceled_at: null })
        .eq("id", existing.id);
      if (error) {
        throw new Error(`grant: user_subscriptions refresh failed (${ref}): ${error.message}`);
      }
    } else {
      const { error } = await supabaseAdmin.from("user_subscriptions").insert({
        user_id: order.user_id,
        tenant_id: order.tenant_id,
        plan_id: entitlement.planId,
        status: "active",
        external_ref: ref,
        current_period_end: periodEnd,
      });
      if (error) {
        throw new Error(`grant: user_subscriptions insert failed (${ref}): ${error.message}`);
      }
    }
    return;
  }

  if (entitlement.type === "purchase") {
    const { error } = await supabaseAdmin.from("user_purchases").upsert(
      {
        user_id: order.user_id,
        tenant_id: order.tenant_id,
        entity_type: entitlement.entityType,
        entity_id: entitlement.entityId,
        amount_cents: order.amount_cents ?? 0,
        currency: order.currency ?? "PLN",
        status: "active",
      },
      { onConflict: "user_id,entity_type,entity_id" },
    );
    if (error) {
      throw new Error(
        `grant: user_purchases upsert failed (${order.user_id}/${entitlement.entityType}/${entitlement.entityId}): ${error.message}`,
      );
    }
  }
}
