// Server-only entitlement granting. Shared by the Stripe webhook and the
// mock-mode finaliser so "a paid order unlocks content" lives in one place and
// behaves identically in both paths. Uses the service-role client because
// user_subscriptions / user_purchases are insert-locked to service_role.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
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
 */
export async function grantEntitlement(
  order: GrantableOrder,
  externalRef: string | null,
): Promise<void> {
  const entitlement = entitlementForOrder(order);

  if (entitlement.type === "subscription") {
    const { data: plan } = await supabaseAdmin
      .from("access_plans")
      .select("interval")
      .eq("id", entitlement.planId)
      .maybeSingle();
    const periodEnd = periodEndFor(plan?.interval ?? null, new Date()).toISOString();
    const ref = externalRef ?? order.id;

    const { data: existing } = await supabaseAdmin
      .from("user_subscriptions")
      .select("id")
      .eq("external_ref", ref)
      .maybeSingle();

    if (existing) {
      await supabaseAdmin
        .from("user_subscriptions")
        .update({ status: "active", current_period_end: periodEnd, canceled_at: null })
        .eq("id", existing.id);
    } else {
      await supabaseAdmin.from("user_subscriptions").insert({
        user_id: order.user_id,
        tenant_id: order.tenant_id,
        plan_id: entitlement.planId,
        status: "active",
        external_ref: ref,
        current_period_end: periodEnd,
      });
    }
    return;
  }

  if (entitlement.type === "purchase") {
    await supabaseAdmin.from("user_purchases").upsert(
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
  }
}
