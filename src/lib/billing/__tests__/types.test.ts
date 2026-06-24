import { describe, expect, it } from "vitest";
import { formatMoney, planBadge, planFeatures, planName } from "../types";

describe("billing/types helpers", () => {
  it("formatMoney formats PLN in PL locale", () => {
    const out = formatMoney(2999, "PLN", "pl");
    expect(out).toMatch(/29[,.]99/);
    expect(out).toMatch(/PLN|zł/);
  });

  it("formatMoney formats USD in EN locale", () => {
    const out = formatMoney(1500, "USD", "en");
    expect(out).toMatch(/\$15\.00/);
  });

  it("formatMoney falls back gracefully on bad currency", () => {
    const out = formatMoney(100, "ZZZ", "pl");
    expect(out).toMatch(/1[.,]00/);
  });

  it("planName picks the right localised name with fallback", () => {
    expect(planName({ name_pl: "Pro", name_en: "Pro EN" }, "pl")).toBe("Pro");
    expect(planName({ name_pl: "Pro", name_en: "Pro EN" }, "en")).toBe("Pro EN");
    expect(planName({ name_pl: "", name_en: "Only EN" }, "pl")).toBe("Only EN");
  });

  it("planFeatures returns string[] and ignores garbage", () => {
    const out = planFeatures(
      { features_pl: ["a", "b"] as unknown as string[], features_en: [] },
      "pl",
    );
    expect(out).toEqual(["a", "b"]);
  });

  it("planBadge returns null when missing", () => {
    expect(planBadge({ badge_pl: null, badge_en: null }, "pl")).toBeNull();
    expect(planBadge({ badge_pl: "Hit", badge_en: "Hit EN" }, "en")).toBe("Hit EN");
  });
});
