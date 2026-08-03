import { describe, expect, it } from "vitest";
import {
  BADGE_DEFINITIONS,
  badgeLabel,
  normalizeProfileBadges,
  PROFILE_BADGE_KINDS,
} from "@/lib/profile/badgeCatalog";

describe("profile badge catalog", () => {
  it("contains exactly the four database-backed badge kinds", () => {
    expect(PROFILE_BADGE_KINDS).toEqual(["verified", "expert", "staff", "contributor"]);
    expect(new Set(PROFILE_BADGE_KINDS).size).toBe(4);
    expect(BADGE_DEFINITIONS.map((definition) => definition.key)).toEqual(PROFILE_BADGE_KINDS);
  });

  it("keeps trust badges manual and allows only contributor automation", () => {
    expect(
      BADGE_DEFINITIONS.filter((definition) => definition.grantMode === "hybrid").map(
        (definition) => definition.key,
      ),
    ).toEqual(["contributor"]);
  });

  it("filters unknown database values, removes duplicates and applies canonical order", () => {
    expect(
      normalizeProfileBadges(["contributor", "invalid", "staff", "contributor", null]),
    ).toEqual(["staff", "contributor"]);
  });

  it("localizes labels for English variants and falls back to Polish", () => {
    expect(badgeLabel("verified", "en-GB")).toBe("Verified");
    expect(badgeLabel("verified", "pl-PL")).toBe("Zweryfikowany");
    expect(badgeLabel("verified", "de-DE")).toBe("Zweryfikowany");
  });
});
