// Pure entitlement helpers shared by the Stripe webhook and the mock-mode
// finaliser. Kept side-effect free so the period maths is unit-testable.

export type PlanInterval = "day" | "week" | "month" | "quarter" | "year" | "one_time" | string;

/** The cadence values Stripe accepts for `recurring[interval]`. */
export type StripeRecurringInterval = "day" | "week" | "month" | "year";

export interface StripeRecurringParams {
  interval: StripeRecurringInterval;
  /** Stripe's `recurring[interval_count]`; 1 for plain cadences. */
  intervalCount: number;
}

/**
 * Map a plan interval to Stripe `recurring[interval]` (+ `interval_count`).
 * Stripe only accepts day/week/month/year, so:
 * - "quarter" is expressed as month x 3 (the canonical Stripe quarterly cadence),
 * - "once"/"one_time"/unknown fall back to monthly (a subscription has to recur
 *   on some cadence).
 * This keeps the Checkout Session's billing cadence in lockstep with the plan
 * instead of charging every plan monthly regardless of its real interval.
 */
export function stripeRecurringFor(
  interval: PlanInterval | null | undefined,
): StripeRecurringParams {
  if (interval === "quarter") return { interval: "month", intervalCount: 3 };
  if (interval === "day" || interval === "week" || interval === "month" || interval === "year") {
    return { interval, intervalCount: 1 };
  }
  return { interval: "month", intervalCount: 1 };
}

/**
 * Add calendar months without JS's month-end overflow (Jan 31 + 1 month must be
 * Feb 28/29, not Mar 3). Clamps the day to the last valid day of the target
 * month so a month-end signup doesn't over-grant a few days of access.
 */
function addMonthsClamped(d: Date, months: number): void {
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const lastDayOfTarget = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDayOfTarget));
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
    case "quarter":
      addMonthsClamped(d, 3);
      break;
    case "week":
      d.setDate(d.getDate() + 7);
      break;
    case "day":
      d.setDate(d.getDate() + 1);
      break;
    default:
      addMonthsClamped(d, 1);
  }
  return d;
}

type OrderKind = "subscription" | "one_time";
type EntityType = "post" | "page" | "media";

export interface OrderForGrant {
  kind: OrderKind;
  plan_id: string | null;
  entity_type: EntityType | null;
  entity_id: string | null;
}

export type Entitlement =
  | { type: "subscription"; planId: string; lifetime: boolean }
  | { type: "purchase"; entityType: EntityType; entityId: string }
  | { type: "none" };

/**
 * Decide what a paid order grants.
 * - subscription + plan -> recurring plan access (period end from interval).
 * - one_time + plan (no entity) -> LIFETIME plan access: a one-time purchase of
 *   a plan (e.g. a "lifetime"/"one-time" plan in the paywall admin) unlocks
 *   everything that plan gates, with no expiry. Without this branch such a plan
 *   was uncharge-/ungrantable (the checkout threw entity_required).
 * - one_time + entity -> single-article purchase.
 * Anything incomplete grants nothing (defensive - never throws during webhooks).
 */
export function entitlementForOrder(order: OrderForGrant): Entitlement {
  if (order.kind === "subscription" && order.plan_id) {
    return { type: "subscription", planId: order.plan_id, lifetime: false };
  }
  if (order.kind === "one_time" && order.plan_id && !order.entity_id) {
    return { type: "subscription", planId: order.plan_id, lifetime: true };
  }
  if (order.kind === "one_time" && order.entity_type && order.entity_id) {
    return { type: "purchase", entityType: order.entity_type, entityId: order.entity_id };
  }
  return { type: "none" };
}
