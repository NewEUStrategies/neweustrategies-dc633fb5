import { describe, expect, it } from "vitest";
import { formatPlanMoney, planDisplayCurrency } from "../planMoney";

describe("plan billing currency", () => {
  it("keeps PLN plan amounts in PLN in English", () => {
    expect(planDisplayCurrency("pln")).toBe("PLN");
    expect(formatPlanMoney(9900, "PLN", "en")).toMatch(/99[.,]00/);
    expect(formatPlanMoney(9900, "PLN", "en")).toContain("PLN");
    expect(formatPlanMoney(9900, "PLN", "en")).not.toContain("€");
  });

  it("preserves EUR plans rather than converting them to PLN", () => {
    expect(planDisplayCurrency("eur")).toBe("EUR");
    expect(formatPlanMoney(2475, "EUR", "pl")).toContain("24,75");
    expect(formatPlanMoney(2475, "EUR", "pl")).not.toContain("zł");
  });
});
