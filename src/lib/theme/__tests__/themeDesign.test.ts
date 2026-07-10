import { describe, it, expect } from "vitest";
import { themeDesignToCss, THEME_DESIGN_DEFAULTS } from "@/lib/theme/themeDesign";

describe("themeDesignToCss", () => {
  it("emits all token variables under the light scope pair", () => {
    const css = themeDesignToCss(THEME_DESIGN_DEFAULTS);
    // Konwencja trybów (patrz styles.css): jasne tokeny deklarowane na
    // ":root,.light", żeby wymuszony jasny canvas buildera pod ciemnym
    // adminem nadpisywał je przez bliskość DOM.
    expect(css.startsWith(":root,.light{")).toBe(true);
    expect(css).toContain("--td-bh-size");
    expect(css).toContain("--td-thumb-radius");
    expect(css).toContain("--td-rm-color");
    expect(css).toContain("--td-meta-size");
  });
});
