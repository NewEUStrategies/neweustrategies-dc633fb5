import { describe, it, expect } from "vitest";
import { normalizeFeatured } from "../MegaMenu";

describe("normalizeFeatured (legacy fallback)", () => {
  it("returns defaults when input is null / undefined / empty", () => {
    expect(normalizeFeatured(null)).toMatchObject({ focalX: 50, focalY: 50, aspectRatio: "16/10" });
    expect(normalizeFeatured(undefined)).toMatchObject({ focalX: 50, focalY: 50, aspectRatio: "16/10" });
    expect(normalizeFeatured({})).toMatchObject({ focalX: 50, focalY: 50, aspectRatio: "16/10" });
  });

  it("coerces numeric strings", () => {
    const r = normalizeFeatured({ focalX: "30" as unknown as number, focalY: "70" as unknown as number });
    expect(r.focalX).toBe(30);
    expect(r.focalY).toBe(70);
  });

  it("clamps out-of-range and NaN", () => {
    expect(normalizeFeatured({ focalX: -10, focalY: 999 })).toMatchObject({ focalX: 0, focalY: 100 });
    expect(normalizeFeatured({ focalX: Number.NaN })).toMatchObject({ focalX: 50 });
  });

  it("rejects invalid aspectRatio and falls back to 16/10", () => {
    const r = normalizeFeatured({ aspectRatio: "21/9" as unknown as never });
    expect(r.aspectRatio).toBe("16/10");
  });

  it("preserves valid aspectRatio and placeholderColor", () => {
    const r = normalizeFeatured({ aspectRatio: "4/3", placeholderColor: "#abc" });
    expect(r.aspectRatio).toBe("4/3");
    expect(r.placeholderColor).toBe("#abc");
  });

  it("drops empty placeholderColor", () => {
    expect(normalizeFeatured({ placeholderColor: "   " }).placeholderColor).toBeUndefined();
  });
});
