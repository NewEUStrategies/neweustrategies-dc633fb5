import { describe, it, expect } from "vitest";
import {
  VITAL_THRESHOLDS,
  VITAL_ORDER,
  isVitalName,
  rateVital,
  vitalUnit,
} from "./vitalsThresholds";

describe("isVitalName", () => {
  it("accepts known metric names", () => {
    for (const name of VITAL_ORDER) expect(isVitalName(name)).toBe(true);
  });
  it("rejects unknown names", () => {
    expect(isVitalName("BOGUS")).toBe(false);
    expect(isVitalName("")).toBe(false);
    expect(isVitalName("toString")).toBe(false); // not an own property
  });
});

describe("rateVital", () => {
  it("rates at and around the good/poor boundaries (LCP 2500/4000)", () => {
    expect(rateVital("LCP", 2500)).toBe("good"); // <= good
    expect(rateVital("LCP", 2501)).toBe("needs-improvement");
    expect(rateVital("LCP", 4000)).toBe("needs-improvement"); // <= poor
    expect(rateVital("LCP", 4001)).toBe("poor");
  });

  it("rates CLS on its unitless scale (0.1/0.25)", () => {
    expect(rateVital("CLS", 0.1)).toBe("good");
    expect(rateVital("CLS", 0.2)).toBe("needs-improvement");
    expect(rateVital("CLS", 0.3)).toBe("poor");
  });

  it("has thresholds for every metric in VITAL_ORDER", () => {
    for (const name of VITAL_ORDER) {
      const [good, poor] = VITAL_THRESHOLDS[name];
      expect(good).toBeLessThan(poor);
    }
  });
});

describe("vitalUnit", () => {
  it("returns no unit for CLS and ms for time metrics", () => {
    expect(vitalUnit("CLS")).toBe("");
    expect(vitalUnit("LCP")).toBe("ms");
    expect(vitalUnit("INP")).toBe("ms");
    expect(vitalUnit("TTFB")).toBe("ms");
  });
});
