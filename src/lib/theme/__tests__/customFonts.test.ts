import { describe, it, expect } from "vitest";
import {
  fontFaceCss,
  customFontsCss,
  slugifyFontName,
  type CustomFont,
} from "@/lib/theme/customFonts";

describe("customFonts", () => {
  it("slugifies non-ascii names safely", () => {
    expect(slugifyFontName("Brąd Serif!")).toBe("brad-serif");
    expect(slugifyFontName("   ")).toBe("font");
  });

  it("emits a valid @font-face rule", () => {
    const f: CustomFont = {
      id: "brand-serif", label: "Brand Serif",
      url: "https://cdn.test/x.woff2", weight: "700",
    };
    const css = fontFaceCss(f);
    expect(css).toContain("@font-face");
    expect(css).toContain('font-family:"brand-serif"');
    expect(css).toContain('format("woff2")');
    expect(css).toContain("font-weight:700");
  });

  it("skips invalid ids", () => {
    expect(fontFaceCss({ id: "BAD!", label: "", url: "x" })).toBe("");
    expect(fontFaceCss({ id: "ok", label: "", url: "" })).toBe("");
  });

  it("concatenates multiple fonts", () => {
    const out = customFontsCss([
      { id: "a", label: "", url: "https://x/a.woff2" },
      { id: "b", label: "", url: "https://x/b.ttf" },
    ]);
    expect(out.match(/@font-face/g)?.length).toBe(2);
    expect(out).toContain('format("woff2")');
    expect(out).toContain('format("truetype")');
  });
});
