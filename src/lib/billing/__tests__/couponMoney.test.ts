import { describe, expect, it } from "vitest";
import {
  couponDiscountCents,
  couponPaidCents,
  sumCouponTotals,
  type CouponRedemptionAmounts,
} from "@/lib/billing/couponMoney";

// Plan 100 PLN z kuponem -20%: rabat 20 PLN, zaplacone 80 PLN.
const twentyPercent: CouponRedemptionAmounts = { original_cents: 10_000, applied_cents: 2_000 };
// Kupon kwotowy -15 PLN od 50 PLN.
const flat: CouponRedemptionAmounts = { original_cents: 5_000, applied_cents: 1_500 };

describe("couponMoney", () => {
  it("reads applied_cents as the discount, not the amount paid", () => {
    expect(couponDiscountCents(twentyPercent)).toBe(2_000);
    expect(couponPaidCents(twentyPercent)).toBe(8_000);
  });

  it("keeps the original = discount + paid invariant", () => {
    for (const row of [twentyPercent, flat]) {
      expect(couponDiscountCents(row) + couponPaidCents(row)).toBe(row.original_cents);
    }
  });

  it("never reports a negative net revenue for inconsistent rows", () => {
    // Rabat wyzszy niz kwota bazowa nie moze zanizac sumy przychodu.
    expect(couponPaidCents({ original_cents: 1_000, applied_cents: 4_000 })).toBe(0);
  });

  it("reports a full discount as zero revenue", () => {
    expect(couponPaidCents({ original_cents: 9_900, applied_cents: 9_900 })).toBe(0);
    expect(couponDiscountCents({ original_cents: 9_900, applied_cents: 9_900 })).toBe(9_900);
  });

  it("aggregates a list without swapping revenue and discount", () => {
    const totals = sumCouponTotals([twentyPercent, flat]);
    expect(totals).toEqual({
      count: 2,
      originalCents: 15_000,
      discountCents: 3_500,
      revenueCents: 11_500,
    });
    // Regresja inwersji: przychod MUSI byc wyzszy od rabatu przy rabacie < 50%.
    expect(totals.revenueCents).toBeGreaterThan(totals.discountCents);
  });

  it("returns zeroed totals for an empty range", () => {
    expect(sumCouponTotals([])).toEqual({
      count: 0,
      originalCents: 0,
      discountCents: 0,
      revenueCents: 0,
    });
  });
});
