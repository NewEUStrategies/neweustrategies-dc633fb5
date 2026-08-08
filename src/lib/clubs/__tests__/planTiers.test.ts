import { describe, expect, it } from "vitest";
import {
  CLUB_PLAN_TIERS,
  DEFAULT_CLUB_PLAN_TIER,
  planTierFromRank,
  rankFromPlanTier,
} from "../planTiers";

describe("planTiers", () => {
  it("domyślnym progiem klubu jest pro", () => {
    expect(DEFAULT_CLUB_PLAN_TIER).toBe("pro");
    expect(rankFromPlanTier(DEFAULT_CLUB_PLAN_TIER)).toBe(20);
  });

  it("mapuje rangi dokładne na plany", () => {
    expect(planTierFromRank(0)).toBe("free");
    expect(planTierFromRank(10)).toBe("plus");
    expect(planTierFromRank(20)).toBe("pro");
    expect(planTierFromRank(25)).toBe("vip");
  });

  it("degraduje rangę spoza słownika do najbliższego niższego progu", () => {
    expect(planTierFromRank(5)).toBe("free");
    expect(planTierFromRank(28)).toBe("vip");
    expect(planTierFromRank(Number.NaN)).toBe("free");
  });

  it("każdy plan ma odwracalną rangę", () => {
    for (const tier of CLUB_PLAN_TIERS) {
      expect(planTierFromRank(rankFromPlanTier(tier))).toBe(tier);
    }
  });
});
