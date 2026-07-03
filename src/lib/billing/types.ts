// Domain types for billing/checkout module. Strict - no any.

export type PlanInterval = "day" | "week" | "month" | "year" | "once";

export interface AccessPlan {
  id: string;
  tenant_id: string;
  name_pl: string;
  name_en: string;
  description_pl: string | null;
  description_en: string | null;
  price_cents: number;
  currency: string;
  interval: PlanInterval;
  active: boolean;
  sort_order: number;
  features_pl: string[];
  features_en: string[];
  badge_pl: string | null;
  badge_en: string | null;
  highlighted: boolean;
  trial_days: number;
}

export interface BillingProfile {
  id: string;
  user_id: string;
  tenant_id: string;
  full_name: string | null;
  company: string | null;
  tax_id: string | null;
  email: string | null;
  phone: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  postal_code: string | null;
  region: string | null;
  country_code: string;
  is_company: boolean;
  created_at: string;
  updated_at: string;
}

export interface BillingProfileInput {
  full_name: string | null;
  company: string | null;
  tax_id: string | null;
  email: string | null;
  phone: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  postal_code: string | null;
  region: string | null;
  country_code: string;
  is_company: boolean;
}

export type OrderKind = "subscription" | "one_time";
export type OrderStatus = "pending" | "processing" | "paid" | "failed" | "refunded" | "canceled";

export interface PaymentOrder {
  id: string;
  tenant_id: string;
  user_id: string;
  kind: OrderKind;
  status: OrderStatus;
  amount_cents: number;
  currency: string;
  plan_id: string | null;
  entity_type: "post" | "page" | null;
  entity_id: string | null;
  provider: string;
  provider_session_id: string | null;
  provider_intent_id: string | null;
  invoice_url: string | null;
  receipt_email: string | null;
  metadata: Record<string, unknown>;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserSubscriptionRow {
  id: string;
  user_id: string;
  plan_id: string;
  status: "active" | "expired" | "canceled" | "refunded";
  started_at: string;
  current_period_end: string | null;
  canceled_at: string | null;
  plan?: AccessPlan | null;
}

export function formatMoney(amountCents: number, currency: string, locale: string): string {
  try {
    return new Intl.NumberFormat(locale === "pl" ? "pl-PL" : "en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(amountCents / 100);
  } catch {
    return `${(amountCents / 100).toFixed(2)} ${currency}`;
  }
}

export function planName(plan: Pick<AccessPlan, "name_pl" | "name_en">, lang: string): string {
  return lang === "en" ? plan.name_en || plan.name_pl : plan.name_pl || plan.name_en;
}

export function planDescription(
  plan: Pick<AccessPlan, "description_pl" | "description_en">,
  lang: string,
): string {
  return (lang === "en" ? plan.description_en : plan.description_pl) ?? "";
}

export function planFeatures(
  plan: Pick<AccessPlan, "features_pl" | "features_en">,
  lang: string,
): string[] {
  const list = lang === "en" ? plan.features_en : plan.features_pl;
  return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : [];
}

export function planBadge(
  plan: Pick<AccessPlan, "badge_pl" | "badge_en">,
  lang: string,
): string | null {
  return (lang === "en" ? plan.badge_en : plan.badge_pl) ?? null;
}
