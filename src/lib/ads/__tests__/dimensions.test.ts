import { describe, it, expect } from "vitest";
import { reserveStyle, DEFAULT_RESERVE_HEIGHT } from "@/lib/ads/dimensions";

describe("reserveStyle", () => {
  it("reserves a responsive box via aspect-ratio when width and height are known", () => {
    expect(reserveStyle({ width: 728, height: 90 })).toEqual({
      width: "100%",
      maxWidth: 728,
      aspectRatio: "728 / 90",
    });
  });

  it("reserves a min-height floor when only height is known", () => {
    expect(reserveStyle({ width: null, height: 250 })).toEqual({
      width: "100%",
      maxWidth: undefined,
      minHeight: 250,
    });
  });

  it("uses the per-position fallback when no dimensions are declared", () => {
    expect(reserveStyle({ width: null, height: null }, "header_banner")).toEqual({
      width: "100%",
      minHeight: DEFAULT_RESERVE_HEIGHT.header_banner,
    });
  });

  it("returns a width-only box when there is nothing to reserve height from", () => {
    expect(reserveStyle({ width: null, height: null })).toEqual({ width: "100%" });
  });

  it("treats non-positive or non-finite dimensions as missing", () => {
    expect(reserveStyle({ width: 0, height: -5 }, "sidebar")).toEqual({
      width: "100%",
      minHeight: DEFAULT_RESERVE_HEIGHT.sidebar,
    });
    expect(reserveStyle({ width: Number.NaN, height: Number.NaN })).toEqual({ width: "100%" });
  });

  it("defines a positive fallback height for every ad position", () => {
    for (const height of Object.values(DEFAULT_RESERVE_HEIGHT)) {
      expect(height).toBeGreaterThan(0);
    }
  });
});
