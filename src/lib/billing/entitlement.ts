// Pure entitlement helpers shared by the Stripe webhook and the mock-mode
// finaliser. Kept side-effect free so the period maths is unit-testable.

export type PlanInterval = "day" | "week" | "month" | "year" | "one_time" | string;

/** The cadence values Stripe accepts for `recurring[interval]`. */
export type StripeRecurringInterval = "day" | "week" | "month" | "year";

/**
 * Map a plan interval to a Stripe `recurring[interval]`. Stripe only accepts
 * day/week/month/year, so a "once"/"one_time"/unknown interval falls back to
 * "month" (a subscription has to recur on some cadence). This keeps the Checkout
 * Session's billing cadence in lockstep with the plan instead of charging every
 * plan monthly regardless of its real interval.
 */
export function stripeRecurringInterval(
  interval: PlanInterval | null | undefined,
): StripeRecurringInterval {
  if (interval === "day" || interval === "week" || interval === "month" || interval === "year") {
    return interval;
  }
  return "month";
}

/**
 * End of the access window for a subscription, given its plan interval.
 * Defaults to one month for unknown/missing intervals.
 */
export function periodEndFor(interval: PlanInterval | null | undefined, from: Date): Date {
  const d = new Date(from.getTime());
  switch (interval) {
    case "year":
      d.setFullYear(d.getFullYear() + 1);
      break;
    case "week":
      d.setDate(d.getDate() + 7);
      break;
    case "day":
      d.setDate(d.getDate() + 1);
      break;
    default:
      d.setMonth(d.getMonth() + 1);
  }
  return d;
}

export type OrderKind = "subscription" | "one_time";
export type EntityType = "post" | "page" | "media";

export interface OrderForGrant {
  kind: OrderKind;
  plan_id: string | null;
  entity_type: EntityType | null;
  entity_id: string | null;
}

export type Entitlement =
  | { type: "subscription"; planId: string }
  | { type: "purchase"; entityType: EntityType; entityId: string }
  | { type: "none" };

/**
 * Decide what a paid order grants. A subscription order needs a plan; a one-time
 * order needs an entity. Anything incomplete grants nothing (defensive - never
 * throws on a malformed/partial order during webhook processing).
 */
export function entitlementForOrder(order: OrderForGrant): Entitlement {
  if (order.kind === "subscription" && order.plan_id) {
    return { type: "subscription", planId: order.plan_id };
  }
  if (order.kind === "one_time" && order.entity_type && order.entity_id) {
    return { type: "purchase", entityType: order.entity_type, entityId: order.entity_id };
  }
  return { type: "none" };
}
