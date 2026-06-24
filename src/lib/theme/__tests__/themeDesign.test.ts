import { describe, it, expect } from "vitest";
import { themeDesignToCss, THEME_DESIGN_DEFAULTS } from "@/lib/theme/themeDesign";

describe("themeDesignToCss", () => {
  it("emits all token variables under :root", () => {
    const css = themeDesignToCss(THEME_DESIGN_DEFAULTS);
    expect(css.startsWith(":root{")).toBe(true);
    expect(css).toContain("--td-bh-size");
    expect(css).toContain("--td-thumb-radius");
    expect(css).toContain("--td-rm-color");
    expect(css).toContain("--td-meta-size");
  });
});
