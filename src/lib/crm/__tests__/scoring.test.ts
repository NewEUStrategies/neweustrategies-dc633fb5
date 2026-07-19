import { describe, it, expect } from "vitest";
import {
  parseScoreBreakdown,
  bandFromScore,
  mergedWeights,
  parseScoringSettings,
  DEFAULT_SCORING_WEIGHTS,
  DEFAULT_SCORING_SETTINGS,
  SCORE_SIGNAL_KEYS,
  SCORE_SIGNAL_LABELS,
  SCORE_BAND_LABELS,
} from "../scoring";

describe("parseScoreBreakdown", () => {
  it("keeps valid entries and sorts by points desc", () => {
    const out = parseScoreBreakdown([
      { key: "email_open", count: 3, points: 6 },
      { key: "purchase", count: 1, points: 40 },
    ]);
    expect(out.map((e) => e.key)).toEqual(["purchase", "email_open"]);
  });

  it("drops malformed entries without throwing", () => {
    const out = parseScoreBreakdown([
      { key: "email_open", count: 3, points: 6 },
      { key: "x" }, // missing count/points
      { count: 2, points: 4 }, // missing key
      null,
      "nope",
      { key: "comment", count: "2", points: 4 }, // wrong count type
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].key).toBe("email_open");
  });

  it("returns [] for non-array input", () => {
    expect(parseScoreBreakdown(null)).toEqual([]);
    expect(parseScoreBreakdown({})).toEqual([]);
    expect(parseScoreBreakdown(undefined)).toEqual([]);
  });
});

describe("bandFromScore", () => {
  const t = { hot_threshold: 80, warm_threshold: 45, cool_threshold: 20 };
  it("maps score to band at thresholds (inclusive lower bound)", () => {
    expect(bandFromScore(80, t)).toBe("hot");
    expect(bandFromScore(79, t)).toBe("warm");
    expect(bandFromScore(45, t)).toBe("warm");
    expect(bandFromScore(44, t)).toBe("cool");
    expect(bandFromScore(20, t)).toBe("cool");
    expect(bandFromScore(19, t)).toBe("cold");
    expect(bandFromScore(0, t)).toBe("cold");
  });
});

describe("mergedWeights", () => {
  it("returns defaults when no overrides", () => {
    const w = mergedWeights({});
    expect(w.email_click).toEqual(DEFAULT_SCORING_WEIGHTS.email_click);
    expect(Object.keys(w).sort()).toEqual([...SCORE_SIGNAL_KEYS].sort());
  });

  it("merges partial overrides over defaults and clamps", () => {
    const w = mergedWeights({
      email_click: { points: 10 },
      purchase: { points: 5000, cap: -3 },
    });
    expect(w.email_click.points).toBe(10);
    expect(w.email_click.cap).toBe(DEFAULT_SCORING_WEIGHTS.email_click.cap);
    expect(w.purchase.points).toBe(1000); // clamped to max
    expect(w.purchase.cap).toBe(0); // clamped to min
  });

  it("ignores non-finite override values", () => {
    const w = mergedWeights({ comment: { points: NaN } });
    expect(w.comment.points).toBe(DEFAULT_SCORING_WEIGHTS.comment.points);
  });
});

describe("parseScoringSettings", () => {
  it("returns defaults for junk input", () => {
    expect(parseScoringSettings(null)).toEqual(DEFAULT_SCORING_SETTINGS);
    expect(parseScoringSettings("x")).toEqual(DEFAULT_SCORING_SETTINGS);
  });

  it("parses a valid row", () => {
    const s = parseScoringSettings({
      enabled: false,
      half_life_days: 14,
      horizon_days: 90,
      hot_threshold: 100,
      warm_threshold: 50,
      cool_threshold: 25,
      weights: { email_open: { points: 3 } },
    });
    expect(s.enabled).toBe(false);
    expect(s.half_life_days).toBe(14);
    expect(s.hot_threshold).toBe(100);
    expect(s.weights.email_open?.points).toBe(3);
  });

  it("falls back to default thresholds when they do not descend", () => {
    const s = parseScoringSettings({
      hot_threshold: 10,
      warm_threshold: 50, // warm > hot => invalid
      cool_threshold: 5,
    });
    expect(s.hot_threshold).toBe(DEFAULT_SCORING_SETTINGS.hot_threshold);
    expect(s.warm_threshold).toBe(DEFAULT_SCORING_SETTINGS.warm_threshold);
    expect(s.cool_threshold).toBe(DEFAULT_SCORING_SETTINGS.cool_threshold);
  });

  it("clamps out-of-range numbers into the allowed window", () => {
    const s = parseScoringSettings({ half_life_days: 9999, horizon_days: 1 });
    expect(s.half_life_days).toBe(365);
    expect(s.horizon_days).toBe(7);
  });
});

describe("label parity", () => {
  it("every signal key has PL and EN labels", () => {
    for (const key of SCORE_SIGNAL_KEYS) {
      expect(SCORE_SIGNAL_LABELS.pl[key]).toBeTruthy();
      expect(SCORE_SIGNAL_LABELS.en[key]).toBeTruthy();
    }
  });

  it("every band has PL and EN labels", () => {
    for (const band of ["hot", "warm", "cool", "cold"] as const) {
      expect(SCORE_BAND_LABELS.pl[band]).toBeTruthy();
      expect(SCORE_BAND_LABELS.en[band]).toBeTruthy();
    }
  });
});
