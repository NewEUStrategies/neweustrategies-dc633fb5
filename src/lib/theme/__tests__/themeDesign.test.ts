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

  it("defers meta size to the theme --fs-small token while at the schema default", () => {
    // Regresja: sam fakt posiadania wiersza theme_design nie może odcinać
    // globalnych rozmiarów czcionek (Admin -> Opcje motywu). Domyślne 13px
    // = dziedziczenie tokenu --fs-small.
    const css = themeDesignToCss(THEME_DESIGN_DEFAULTS);
    expect(css).toContain("--td-meta-size:var(--fs-small, 13px);");
    expect(css).not.toContain("--td-meta-size:13px;");
  });

  it("pins an explicitly customized meta size in px", () => {
    const css = themeDesignToCss({
      ...THEME_DESIGN_DEFAULTS,
      metaInfo: { ...THEME_DESIGN_DEFAULTS.metaInfo, fontSize: "15px" },
    });
    expect(css).toContain("--td-meta-size:15px;");
  });
});
