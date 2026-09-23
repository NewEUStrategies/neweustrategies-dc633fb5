import { describe, expect, it } from "vitest";
import { groupCouponDiscount } from "@/lib/events/groupOrderPricing";

describe("groupCouponDiscount", () => {
  it("applies a fixed code to every seat, not once per order", () => {
    // 3 miejsca po 100 zł, kod -20 zł: baza policzyła 20 zł od 300 zł.
    expect(
      groupCouponDiscount({
        kind: "fixed",
        discountCents: 2000,
        finalCents: 28000,
        totalCents: 30000,
        seats: 3,
      }),
    ).toEqual({ discountCents: 6000, finalCents: 24000 });
  });

  it("caps a fixed code at the seat price", () => {
    // Kod -150 zł na bilet za 100 zł: każde miejsce schodzi do zera, nie niżej.
    expect(
      groupCouponDiscount({
        kind: "fixed",
        discountCents: 15000,
        finalCents: 15000,
        totalCents: 30000,
        seats: 3,
      }),
    ).toEqual({ discountCents: 30000, finalCents: 0 });
  });

  it("leaves percentage codes as computed by the database", () => {
    expect(
      groupCouponDiscount({
        kind: "percent",
        discountCents: 3000,
        finalCents: 27000,
        totalCents: 30000,
        seats: 3,
      }),
    ).toEqual({ discountCents: 3000, finalCents: 27000 });
  });

  it("leaves single-seat orders untouched", () => {
    expect(
      groupCouponDiscount({
        kind: "fixed",
        discountCents: 2000,
        finalCents: 8000,
        totalCents: 10000,
        seats: 1,
      }),
    ).toEqual({ discountCents: 2000, finalCents: 8000 });
  });

  it("treats a missing kind as the database result", () => {
    expect(
      groupCouponDiscount({
        kind: null,
        discountCents: 500,
        finalCents: 9500,
        totalCents: 10000,
        seats: 2,
      }),
    ).toEqual({ discountCents: 500, finalCents: 9500 });
  });
});
