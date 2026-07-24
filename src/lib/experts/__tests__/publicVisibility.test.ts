import { describe, it, expect } from "vitest";
import {
  isIndexableProfile,
  profileRobots,
  type ProfileIndexSignals,
} from "@/lib/experts/publicVisibility";

const NONE: ProfileIndexSignals = {
  isExpert: false,
  materialCount: 0,
  programCount: 0,
  areaCount: 0,
  mediaMentionCount: 0,
};

describe("isIndexableProfile", () => {
  it("noindex for a bare member with no public presence", () => {
    expect(isIndexableProfile(NONE)).toBe(false);
  });

  it("indexes an expert even with no other content", () => {
    expect(isIndexableProfile({ ...NONE, isExpert: true })).toBe(true);
  });

  it("indexes on any curated-presence signal", () => {
    expect(isIndexableProfile({ ...NONE, materialCount: 1 })).toBe(true);
    expect(isIndexableProfile({ ...NONE, programCount: 1 })).toBe(true);
    expect(isIndexableProfile({ ...NONE, areaCount: 1 })).toBe(true);
    expect(isIndexableProfile({ ...NONE, mediaMentionCount: 1 })).toBe(true);
  });
});

describe("profileRobots", () => {
  it("emits AI-overview hints only when indexable", () => {
    expect(profileRobots(true)).toBe("index, follow, max-image-preview:large, max-snippet:-1");
    expect(profileRobots(false)).toBe("noindex, nofollow");
  });
});
