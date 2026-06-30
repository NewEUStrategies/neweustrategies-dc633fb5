import { describe, it, expect } from "vitest";
import { stripeRecurringInterval } from "@/lib/billing/entitlement";

describe("stripeRecurringInterval", () => {
  it("passes through the Stripe-accepted cadences unchanged", () => {
    expect(stripeRecurringInterval("day")).toBe("day");
    expect(stripeRecurringInterval("week")).toBe("week");
    expect(stripeRecurringInterval("month")).toBe("month");
    expect(stripeRecurringInterval("year")).toBe("year");
  });

  it("maps non-recurring / unknown intervals to month (a subscription must recur)", () => {
    expect(stripeRecurringInterval("once")).toBe("month");
    expect(stripeRecurringInterval("one_time")).toBe("month");
    expect(stripeRecurringInterval("quarterly")).toBe("month");
    expect(stripeRecurringInterval("")).toBe("month");
    expect(stripeRecurringInterval(null)).toBe("month");
    expect(stripeRecurringInterval(undefined)).toBe("month");
  });

  it("bills a yearly plan yearly (regression: was hardcoded to month)", () => {
    // The checkout function reads plan.interval via String(...) before passing in.
    expect(stripeRecurringInterval(String("year"))).toBe("year");
  });
});
