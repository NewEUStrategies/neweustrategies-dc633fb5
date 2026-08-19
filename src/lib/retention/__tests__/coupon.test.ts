import { describe, expect, it } from "vitest";
import {
  couponSuffixFromBytes,
  couponValidUntil,
  retentionCouponCode,
} from "@/lib/retention/coupon";

describe("kupon retencyjny", () => {
  it("normalizuje procent i kod do zakresu obsługiwanego przez bazę", () => {
    expect(retentionCouponCode(29.6, "ab2cde")).toBe("SAVE30-AB2CDE");
    expect(retentionCouponCode(-10, "lower")).toBe("SAVE1-LOWER");
    expect(retentionCouponCode(120, "upper")).toBe("SAVE90-UPPER");
  });

  it("buduje deterministyczny sufiks bez mylących znaków", () => {
    const suffix = couponSuffixFromBytes(new Uint8Array([0, 1, 2, 3, 30, 31]), 6);

    expect(suffix).toHaveLength(6);
    expect(suffix).toMatch(/^[A-HJ-NP-Z2-9]+$/);
    expect(couponSuffixFromBytes(new Uint8Array(), 3)).toBe("AAA");
  });

  it("dodaje pełne doby i ogranicza ważność do 1-90 dni", () => {
    const now = new Date("2026-08-19T12:00:00.000Z");

    expect(couponValidUntil(now, 14).toISOString()).toBe("2026-09-02T12:00:00.000Z");
    expect(couponValidUntil(now, 0).toISOString()).toBe("2026-08-20T12:00:00.000Z");
    expect(couponValidUntil(now, 120).toISOString()).toBe("2026-11-17T12:00:00.000Z");
  });
});
