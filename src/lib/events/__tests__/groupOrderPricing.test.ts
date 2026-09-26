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
    ).toEqual({ discountCents: 6000, finalCents: 24000, perSeatCents: 2000 });
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
    ).toEqual({ discountCents: 30000, finalCents: 0, perSeatCents: 10000 });
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
    ).toEqual({ discountCents: 3000, finalCents: 27000, perSeatCents: null });
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
    ).toEqual({ discountCents: 2000, finalCents: 8000, perSeatCents: 2000 });
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
    ).toEqual({ discountCents: 500, finalCents: 9500, perSeatCents: null });
  });

  // BENEFIT PLANU: miejsce prowadzącego (członka) jest tańsze od miejsc gości.
  it("lead included in the plan: the code comes off the guests only", () => {
    // Prowadzący 0 zł (bilet z puli) + 2 goście po 100 zł, kod -80 zł od
    // miejsca: średnia 66,67 zł zaniżałaby rabat gości - schodzi 2 × 80 zł.
    expect(
      groupCouponDiscount({
        kind: "fixed",
        discountCents: 8000,
        finalCents: 12000,
        totalCents: 20000,
        seats: 3,
        leadCents: 0,
      }),
    ).toEqual({ discountCents: 16000, finalCents: 4000, perSeatCents: null });
  });

  it("discounted lead cheaper than the code: the lead seat stops at zero", () => {
    // Prowadzący 50 zł (ulga -50%) + gość 100 zł, kod -60 zł: 50 zł z miejsca
    // prowadzącego, 60 zł z gościa.
    expect(
      groupCouponDiscount({
        kind: "fixed",
        discountCents: 6000,
        finalCents: 9000,
        totalCents: 15000,
        seats: 2,
        leadCents: 5000,
      }),
    ).toEqual({ discountCents: 11000, finalCents: 4000, perSeatCents: null });
  });

  it("discounted lead above the code: every seat gets the same code, shown per seat", () => {
    expect(
      groupCouponDiscount({
        kind: "fixed",
        discountCents: 2000,
        finalCents: 23000,
        totalCents: 25000,
        seats: 3,
        leadCents: 5000,
      }),
    ).toEqual({ discountCents: 6000, finalCents: 19000, perSeatCents: 2000 });
  });

  it("clamps a lead price outside the order total", () => {
    // Nieczytelna cena prowadzącego nie może wypchnąć rabatu poza zamówienie.
    expect(
      groupCouponDiscount({
        kind: "fixed",
        discountCents: 1000,
        finalCents: 9000,
        totalCents: 10000,
        seats: 2,
        leadCents: 99999,
      }),
    ).toEqual({ discountCents: 1000, finalCents: 9000, perSeatCents: null });
    expect(
      groupCouponDiscount({
        kind: "fixed",
        discountCents: 1000,
        finalCents: 9000,
        totalCents: 10000,
        seats: 2,
        leadCents: -500,
      }),
      // Ujemna cena to prowadzący za zero: kod schodzi tylko z gościa.
    ).toEqual({ discountCents: 1000, finalCents: 9000, perSeatCents: null });
  });
});
