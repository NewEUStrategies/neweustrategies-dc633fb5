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

describe("fontSizesToCss - odstępy treści", () => {
  it("emituje zmienne odstępów i reguły dla frontu oraz canvasa buildera", () => {
    const css = fontSizesToCss({
      ...FONT_SIZES_DEFAULTS,
      spacing: {
        headingTopRem: 2.5,
        headingBottomRem: 0.5,
        listRem: 1.25,
        blockquoteRem: 2,
      },
    });
    expect(css).toContain("--sp-heading-top:2.5rem;");
    expect(css).toContain("--sp-heading-bottom:0.5rem;");
    expect(css).toContain("--sp-list:1.25rem;");
    expect(css).toContain("--sp-blockquote:2rem;");
    expect(css).toContain('[data-builder-renderer] > [data-block-type="heading"]');
    expect(css).toContain(".single-post-content.single-post-content blockquote");
  });

  it("ma domyślne odstępy po parsowaniu pustej konfiguracji", () => {
    expect(FONT_SIZES_DEFAULTS.spacing.headingTopRem).toBeGreaterThan(0);
  });

  it("emituje interlinię akapitów i nagłówków dla frontu i canvasa buildera", () => {
    const css = fontSizesToCss({
      ...FONT_SIZES_DEFAULTS,
      body: { size: 16, lineHeight: 1.8 },
    });
    expect(css).toContain("--lh-body:1.8;");
    expect(css).toContain('[data-builder-renderer] > [data-block-type="paragraph"],');
    expect(css).toContain("{line-height:var(--lh-body);}");
    expect(css).toContain("[data-builder-renderer] h2{line-height:var(--lh-h2);}");
    expect(css).toContain("{line-height:var(--lh-blockquote);}");
    expect(css).toContain(".blocks-content.blocks-content :is(p,li),");
  });
});
