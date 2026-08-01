// Pure entitlement helpers shared by the payments webhook and the mock-mode
// finaliser. Kept side-effect free so the period maths is unit-testable.

/**
 * Dodanie miesięcy z docięciem dnia (31 stycznia + 1 miesiąc = 28/29 lutego),
 * żeby okres rozliczeniowy nie "przeskakiwał" na kolejny miesiąc.
 */
function addMonthsClamped(d: Date, months: number): void {
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDay));
}

export type PlanInterval =
  "day" | "week" | "two_weeks" | "month" | "quarter" | "year" | "one_time" | string;

export function periodEndFor(interval: PlanInterval | null | undefined, from: Date): Date {
  const d = new Date(from.getTime());
  switch (interval) {
    case "year":
      d.setFullYear(d.getFullYear() + 1);
      break;
    case "quarter":
      addMonthsClamped(d, 3);
      break;
    case "two_weeks":
      d.setDate(d.getDate() + 14);
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
