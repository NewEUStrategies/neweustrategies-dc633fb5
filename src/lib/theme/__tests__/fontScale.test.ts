import { describe, expect, it } from "vitest";
import {
  FONT_SCALE_TOKENS,
  effectiveFontSize,
  fontScaleToCss,
  normalizeFontScale,
} from "@/lib/theme/fontScale";

describe("fontScale", () => {
  it("has unique keys and CSS variables", () => {
    const keys = new Set(FONT_SCALE_TOKENS.map((t) => t.key));
    const vars = new Set(FONT_SCALE_TOKENS.map((t) => t.cssVar));
    expect(keys.size).toBe(FONT_SCALE_TOKENS.length);
    expect(vars.size).toBe(FONT_SCALE_TOKENS.length);
  });

  it("drops unknown keys and clamps out-of-range values", () => {
    expect(normalizeFontScale({ label: 999, nope: 12 })).toEqual({ label: 18 });
    expect(normalizeFontScale({ label: 1 })).toEqual({ label: 9 });
    expect(normalizeFontScale(null)).toEqual({});
  });

  it("falls back to catalog defaults", () => {
    expect(effectiveFontSize({}, "button")).toBe(12);
    expect(effectiveFontSize({ button: 14 }, "button")).toBe(14);
  });

  it("emits CSS only for overrides", () => {
    expect(fontScaleToCss({})).toBe("");
    expect(fontScaleToCss({ button: 13 })).toBe(":root{--fs-button:13px;}");
  });
});
