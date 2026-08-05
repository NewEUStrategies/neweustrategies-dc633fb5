import { describe, expect, it } from "vitest";
import { buildPlanSwitchBoard, isKnownLookupKey } from "@/lib/billing/planSwitch";
import type { AccessPlan } from "@/lib/billing/types";

function plan(over: Partial<AccessPlan> & { id: string }): AccessPlan {
  return {
    tenant_id: "t1",
    name_pl: over.id,
    name_en: over.id,
    description_pl: null,
    description_en: null,
    price_cents: 1000,
    currency: "PLN",
    interval: "month",
    active: true,
    sort_order: 0,
    features_pl: [],
    features_en: [],
    badge_pl: null,
    badge_en: null,
    highlighted: false,
    trial_days: 0,
    tier_key: null,
    ...over,
  };
}

const plus = plan({ id: "p-plus", tier_key: "member", interval: "month" });
const pro = plan({ id: "p-pro", tier_key: "pro", interval: "month" });
const business = plan({ id: "p-biz", tier_key: "business", interval: "month" });

describe("buildPlanSwitchBoard", () => {
  it("dzieli plany na wyżej/niżej według rangi lookup_key", () => {
    const board = buildPlanSwitchBoard([plus, pro, business], pro);
    expect(board.currentLookupKey).toBe("pro_monthly");
    expect(board.upgrades.map((o) => o.lookupKey)).toContain("business_monthly");
    expect(board.downgrades.map((o) => o.lookupKey)).toContain("plus_monthly");
  });

  it("pomija bieżący plan", () => {
    const board = buildPlanSwitchBoard([plus, pro], pro);
    const keys = [...board.upgrades, ...board.downgrades].map((o) => o.lookupKey);
    expect(keys).not.toContain("pro_monthly");
  });

  it("bez subskrypcji traktuje wszystko jako wejście w górę", () => {
    const board = buildPlanSwitchBoard([plus, pro], null);
    expect(board.currentLookupKey).toBeNull();
    expect(board.downgrades).toHaveLength(0);
    expect(board.upgrades.length).toBeGreaterThan(0);
  });

  it("pomija plany nieaktywne i bez odpowiednika w katalogu", () => {
    const inactive = plan({ id: "p-off", tier_key: "member", active: false });
    const unknown = plan({ id: "p-unknown", tier_key: "nope" });
    const board = buildPlanSwitchBoard([inactive, unknown], pro);
    expect([...board.upgrades, ...board.downgrades]).toHaveLength(0);
  });

  it("waliduje znane lookup_key", () => {
    expect(isKnownLookupKey("pro_monthly")).toBe(true);
    expect(isKnownLookupKey("ghost_plan")).toBe(false);
  });
});
