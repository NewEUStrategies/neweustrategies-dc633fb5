import { describe, it, expect } from "vitest";
import {
  DEFAULT_ACCENT,
  isHex6,
  safeAccent,
  relativeLuminance,
  readableTextColor,
  accentRgba,
} from "@/lib/programs/visual";

describe("program visual helpers", () => {
  it("validates #rrggbb hex", () => {
    expect(isHex6("#1e3a8a")).toBe(true);
    expect(isHex6("#FFF")).toBe(false);
    expect(isHex6("1e3a8a")).toBe(false);
    expect(isHex6(null)).toBe(false);
    expect(isHex6(undefined)).toBe(false);
    expect(isHex6("#zzzzzz")).toBe(false);
  });

  it("falls back to the default accent for invalid input", () => {
    expect(safeAccent("#0e7490")).toBe("#0e7490");
    expect(safeAccent(null)).toBe(DEFAULT_ACCENT);
    expect(safeAccent("nonsense")).toBe(DEFAULT_ACCENT);
  });

  it("computes luminance monotonically (black < mid < white)", () => {
    expect(relativeLuminance("#000000")).toBeCloseTo(0, 5);
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 5);
    expect(relativeLuminance("#808080")).toBeGreaterThan(0);
    expect(relativeLuminance("#808080")).toBeLessThan(1);
  });

  it("picks readable text: white on dark, dark on light", () => {
    expect(readableTextColor("#1e3a8a")).toBe("#ffffff"); // dark navy
    expect(readableTextColor("#9f1239")).toBe("#ffffff"); // dark crimson
    expect(readableTextColor("#ffffff")).toBe("#0b0b0d"); // white
    expect(readableTextColor("#facc15")).toBe("#0b0b0d"); // bright yellow
  });

  it("builds rgba with clamped alpha", () => {
    expect(accentRgba("#1e3a8a", 0.1)).toBe("rgba(30, 58, 138, 0.1)");
    expect(accentRgba("#1e3a8a", 5)).toBe("rgba(30, 58, 138, 1)");
    expect(accentRgba("#1e3a8a", -1)).toBe("rgba(30, 58, 138, 0)");
    expect(accentRgba(null, 0.5)).toBe("rgba(30, 58, 138, 0.5)");
  });
});
