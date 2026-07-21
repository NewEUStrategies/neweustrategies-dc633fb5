// Testy progów poziomów reputacji (granice, monotoniczność, postęp).
import { describe, expect, it } from "vitest";
import { REPUTATION_LEVELS, levelForPoints, nextLevelFor, progressToNextLevel } from "./reputation";

describe("levelForPoints", () => {
  it("assigns the base level at 0 points", () => {
    expect(levelForPoints(0).key).toBe("observer");
  });

  it("switches exactly at each threshold", () => {
    expect(levelForPoints(49).key).toBe("observer");
    expect(levelForPoints(50).key).toBe("participant");
    expect(levelForPoints(149).key).toBe("participant");
    expect(levelForPoints(150).key).toBe("voice");
    expect(levelForPoints(399).key).toBe("voice");
    expect(levelForPoints(400).key).toBe("expert");
    expect(levelForPoints(999).key).toBe("expert");
    expect(levelForPoints(1000).key).toBe("pillar");
    expect(levelForPoints(5000).key).toBe("pillar");
  });

  it("treats invalid input as 0 points", () => {
    expect(levelForPoints(Number.NaN).key).toBe("observer");
    expect(levelForPoints(-10).key).toBe("observer");
  });
});

describe("nextLevelFor", () => {
  it("points to the next threshold", () => {
    expect(nextLevelFor(0)?.key).toBe("participant");
    expect(nextLevelFor(50)?.key).toBe("voice");
  });

  it("returns null at the top level", () => {
    expect(nextLevelFor(1000)).toBeNull();
  });
});

describe("progressToNextLevel", () => {
  it("is 0 right after reaching a level and approaches 1 near the next", () => {
    expect(progressToNextLevel(50)).toBe(0);
    expect(progressToNextLevel(100)).toBeCloseTo(0.5);
    expect(progressToNextLevel(149)).toBeCloseTo(0.99);
  });

  it("caps at 1 for the top level", () => {
    expect(progressToNextLevel(1000)).toBe(1);
    expect(progressToNextLevel(999999)).toBe(1);
  });
});

describe("REPUTATION_LEVELS", () => {
  it("has strictly increasing thresholds starting at 0 and PL/EN names", () => {
    expect(REPUTATION_LEVELS[0].min).toBe(0);
    for (let i = 1; i < REPUTATION_LEVELS.length; i++) {
      expect(REPUTATION_LEVELS[i].min).toBeGreaterThan(REPUTATION_LEVELS[i - 1].min);
    }
    for (const level of REPUTATION_LEVELS) {
      expect(level.pl.length).toBeGreaterThan(0);
      expect(level.en.length).toBeGreaterThan(0);
    }
  });
});
