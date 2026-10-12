import { describe, expect, it } from "vitest";
import { catalogEntryByPriceId } from "@/lib/billing/catalog";
import {
  buildPlanSwitchBoard,
  catalogSwitchRefusal,
  isKnownLookupKey,
  paymentOutcomeMessageKey,
  planSwitchRefusal,
  switchEntryForPlan,
  switchTargets,
} from "@/lib/billing/planSwitch";
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

// ---------------------------------------------------------------------------
// Jedna reguła „na co wolno przełączyć" dla UI i serwera (SUB-14). Te same
// funkcje filtrują listę celów w trzech kartach i odrzucają cel w
// `planSwitch.server.ts` oraz w operacji u dostawcy - test pilnuje reguły,
// a nie żadnej z jej kopii (bo kopii już nie ma).
// ---------------------------------------------------------------------------
describe("planSwitchRefusal / switchTargets - wspólna reguła UI i serwera", () => {
  const plusEntry = catalogEntryByPriceId("plus_monthly");
  const teamEntry = catalogEntryByPriceId("team_monthly_seat");

  it("nieaktywny, jednorazowy i bez ŚCISŁEGO odpowiednika w katalogu - odmowa", () => {
    expect(planSwitchRefusal({ ...pro, active: false }, plusEntry)).toBe("plan_not_found");
    expect(planSwitchRefusal({ ...pro, interval: "one_time" }, plusEntry)).toBe(
      "plan_not_recurring",
    );
    expect(
      planSwitchRefusal(plan({ id: "dl", tier_key: "decision_lab", interval: "one_time" }), null),
    ).toBe("plan_not_recurring");
    // Fallback `catalogPriceForPlan` dałby `business_2w` - przełączenie musi
    // trafić w cenę TEGO cyklu albo w nic.
    expect(planSwitchRefusal({ ...business, interval: "year" }, plusEntry)).toBe(
      "plan_not_switchable",
    );
  });

  it("Zespół (za miejsce) <-> plan indywidualny to inny model rozliczenia", () => {
    const team = plan({ id: "p-team", tier_key: "team" });
    expect(planSwitchRefusal(team, plusEntry)).toBe("plan_kind_mismatch");
    expect(planSwitchRefusal(pro, teamEntry)).toBe("plan_kind_mismatch");
    expect(catalogSwitchRefusal(plusEntry!, teamEntry)).toBe("plan_kind_mismatch");
  });

  it("ten sam plan i pozycja jednorazowa na poziomie katalogu", () => {
    expect(catalogSwitchRefusal(plusEntry!, plusEntry)).toBe("same_plan");
    expect(catalogSwitchRefusal(plusEntry!, catalogEntryByPriceId("decision_lab_seat"))).toBe(
      "plan_not_switchable",
    );
    expect(catalogSwitchRefusal(plusEntry!, catalogEntryByPriceId("pro_monthly"))).toBeNull();
  });

  it("dwa plany najemcy na tę samą cenę dają JEDEN cel - pierwszy wg kolejności", () => {
    const proPromo = plan({ id: "p-pro-promo", tier_key: "pro", interval: "month" });
    const targets = switchTargets([pro, proPromo, plus], plusEntry);

    expect(targets.map((t) => [t.plan.id, t.lookupKey, t.direction])).toEqual([
      ["p-pro", "pro_monthly", "upgrade"],
    ]);
    expect(switchEntryForPlan(proPromo)?.priceId).toBe("pro_monthly");
  });

  it("tablica zmian pomija przejście między modelami rozliczenia", () => {
    const team = plan({ id: "p-team", tier_key: "team" });
    const board = buildPlanSwitchBoard([plus, pro, team], plus);
    const keys = [...board.upgrades, ...board.downgrades].map((o) => o.lookupKey);

    expect(keys).toContain("pro_monthly");
    expect(keys).not.toContain("team_monthly_seat");
  });
});

describe("paymentOutcomeMessageKey", () => {
  it("odmowa dopłaty dostaje własny komunikat, każdy inny kod - brak", () => {
    expect(paymentOutcomeMessageKey("payment_failed")).toBe("profile.subscription.payment.failed");
    expect(paymentOutcomeMessageKey("payment_requires_action")).toBe(
      "profile.subscription.payment.requiresAction",
    );
    expect(paymentOutcomeMessageKey("declined")).toBeNull();
    expect(paymentOutcomeMessageKey(null)).toBeNull();
  });
});
