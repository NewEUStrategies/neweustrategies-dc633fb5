import { describe, it, expect } from "vitest";
import { periodEndFor, stripeRecurringFor } from "@/lib/billing/entitlement";

describe("stripeRecurringFor", () => {
  it("passes through the Stripe-accepted cadences unchanged (count 1)", () => {
    expect(stripeRecurringFor("day")).toEqual({ interval: "day", intervalCount: 1 });
    expect(stripeRecurringFor("week")).toEqual({ interval: "week", intervalCount: 1 });
    expect(stripeRecurringFor("month")).toEqual({ interval: "month", intervalCount: 1 });
    expect(stripeRecurringFor("year")).toEqual({ interval: "year", intervalCount: 1 });
  });

  it("expresses a quarter as month x 3 (canonical Stripe quarterly cadence)", () => {
    expect(stripeRecurringFor("quarter")).toEqual({ interval: "month", intervalCount: 3 });
  });

  it("maps non-recurring / unknown intervals to month (a subscription must recur)", () => {
    expect(stripeRecurringFor("once")).toEqual({ interval: "month", intervalCount: 1 });
    expect(stripeRecurringFor("one_time")).toEqual({ interval: "month", intervalCount: 1 });
    expect(stripeRecurringFor("quarterly")).toEqual({ interval: "month", intervalCount: 1 });
    expect(stripeRecurringFor("")).toEqual({ interval: "month", intervalCount: 1 });
    expect(stripeRecurringFor(null)).toEqual({ interval: "month", intervalCount: 1 });
    expect(stripeRecurringFor(undefined)).toEqual({ interval: "month", intervalCount: 1 });
  });

  it("bills a yearly plan yearly (regression: was hardcoded to month)", () => {
    // The checkout function reads plan.interval via String(...) before passing in.
    expect(stripeRecurringFor(String("year")).interval).toBe("year");
  });
});

describe("periodEndFor (quarter)", () => {
  it("adds three calendar months", () => {
    const end = periodEndFor("quarter", new Date("2026-01-15T12:00:00Z"));
    expect(end.getFullYear()).toBe(2026);
    expect(end.getMonth()).toBe(3); // kwiecień
    expect(end.getDate()).toBe(15);
  });

  it("clamps a month-end start to the last valid day of the target month", () => {
    // 30 XI + 3 miesiące = 28/29 II (nie 1/2 III) - bez over-grantu dostępu.
    const end = periodEndFor("quarter", new Date("2026-11-30T12:00:00Z"));
    expect(end.getFullYear()).toBe(2027);
    expect(end.getMonth()).toBe(1); // luty
    expect(end.getDate()).toBe(28);
  });
});
