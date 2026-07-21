// Współdzielone typy i pomocnicze funkcje dla kuponów B2B - używane przez
// klienta (walidacja live), serwer (checkout) oraz panel admina.

export type CouponDiscountKind = "percent" | "fixed";

export interface B2bCouponRow {
  id: string;
  code: string;
  name: string | null;
  description: string | null;
  discount_kind: CouponDiscountKind;
  discount_percent: number | null;
  discount_cents: number | null;
  currency: string | null;
  active: boolean;
  max_redemptions: number | null;
  redemptions_count: number;
  valid_from: string | null;
  valid_until: string | null;
  plan_ids: string[];
  organization_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ValidateCouponResult {
  ok: boolean;
  error:
    | null
    | "empty_code"
    | "invalid_amount"
    | "not_found"
    | "inactive"
    | "not_yet_valid"
    | "expired"
    | "limit_reached"
    | "plan_not_eligible"
    | "currency_mismatch";
  coupon_id: string | null;
  discount_cents: number;
  final_cents: number;
  label: string | null;
  discount_kind: CouponDiscountKind | null;
  discount_percent: number | null;
}

/** Znormalizowany kod (upper, trim) - używamy go w kluczach cache i w wysyłce. */
export function normalizeCouponCode(input: string): string {
  return input.trim().toUpperCase();
}

/** Krótka etykieta rabatu do tooltipów: "-20%" lub "-50,00 PLN". */
export function formatDiscountLabel(
  kind: CouponDiscountKind | null,
  percent: number | null,
  cents: number | null,
  currency: string | null,
  locale: string,
): string {
  if (kind === "percent" && percent != null) return `-${percent}%`;
  if (kind === "fixed" && cents != null) {
    const value = cents / 100;
    const fmt = new Intl.NumberFormat(locale === "pl" ? "pl-PL" : "en-US", {
      style: "currency",
      currency: (currency || "PLN").toUpperCase(),
      maximumFractionDigits: 2,
    });
    return `-${fmt.format(value)}`;
  }
  return "";
}

export const COUPON_ERROR_I18N_KEY: Record<NonNullable<ValidateCouponResult["error"]>, string> = {
  empty_code: "coupon.error.emptyCode",
  invalid_amount: "coupon.error.invalidAmount",
  not_found: "coupon.error.notFound",
  inactive: "coupon.error.inactive",
  not_yet_valid: "coupon.error.notYetValid",
  expired: "coupon.error.expired",
  limit_reached: "coupon.error.limitReached",
  plan_not_eligible: "coupon.error.planNotEligible",
  currency_mismatch: "coupon.error.currencyMismatch",
};
