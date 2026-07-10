import { describe, it, expect } from "vitest";
import { FONT_SIZES_DEFAULTS, HEADING_LEVELS, fontSizesToCss } from "@/lib/theme/fontSizes";

describe("fontSizes", () => {
  it("provides sensible defaults for every heading", () => {
    for (const level of HEADING_LEVELS) {
      const h = FONT_SIZES_DEFAULTS.headings[level];
      expect(h.desktop).toBeGreaterThanOrEqual(10);
      expect(h.desktop).toBeLessThanOrEqual(120);
      expect(h.mobile).toBeGreaterThanOrEqual(10);
      expect(h.mobile).toBeLessThanOrEqual(96);
      expect(h.weight).toBeGreaterThanOrEqual(100);
      expect(h.weight).toBeLessThanOrEqual(900);
    }
    expect(FONT_SIZES_DEFAULTS.body.size).toBe(16);
  });

  it("emits :root variables and a mobile media query for headings", () => {
    const css = fontSizesToCss(FONT_SIZES_DEFAULTS);
    expect(css).toContain(":root{");
    expect(css).toContain("--fs-body:16px;");
    expect(css).toContain("--fs-h1:");
    expect(css).toContain("--lh-h1:");
    expect(css).toContain("--ls-h1:");
    expect(css).toContain("--fw-h1:");
    expect(css).toContain("--tt-h1:");
    expect(css).toMatch(/@media \(max-width: \d+px\)\{:root\{[^}]*--fs-h1:/);
  });
});
