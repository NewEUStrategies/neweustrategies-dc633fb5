import { describe, expect, it } from "vitest";
import { buildJoinUsSizeCss } from "@/lib/interests/joinUsSizeCss";

/** Specyficzność selektora w formie (a,b,c) - liczymy tylko to, czego używamy
 *  w tym arkuszu: atrybuty/klasy (b) i selektory typu (c).
 *  `:is(li,span,…)` liczy się jak NAJBARDZIEJ specyficzny argument, a u nas
 *  argumentami są wyłącznie selektory typu, czyli (0,0,1). */
function specificity(selector: string): { b: number; c: number } {
  const isGroups = selector.match(/:is\([^)]*\)/g)?.length ?? 0;
  const flat = selector.replace(/:is\([^)]*\)/g, " ");
  const attrs = flat.match(/\[[^\]]+\]/g)?.length ?? 0;
  const classes = flat.match(/\.[a-zA-Z_-][\w-]*/g)?.length ?? 0;
  const types = flat.match(/(^|[\s>+~,])([a-zA-Z][\w-]*)/g)?.length ?? 0;
  return { b: attrs + classes, c: types + isGroups };
}

describe("buildJoinUsSizeCss", () => {
  it("zwraca pusty string bez ustawionych rozmiarów", () => {
    expect(buildJoinUsSizeCss("jus-1", {})).toBe("");
    expect(buildJoinUsSizeCss("", { titleSize: 20 })).toBe("");
  });

  it("scopuje reguły po data-jus-id i wymusza !important", () => {
    const css = buildJoinUsSizeCss("jus-1", { titleSize: 17 });
    expect(css).toContain('[data-jus-id="jus-1"]');
    expect(css).toContain('[data-edit-target="titleSize"]');
    expect(css).toContain("font-size:17px !important");
  });

  // Regresja: bez podbitej specyficzności per-elementowe rozmiary przegrywały
  // z `buildWidgetTypographyCss()` (`[data-w-id]×3 p:not(…)×4` → (0,7,1)),
  // więc zmiana w tooltipie/panelu nie robiła NIC ani w podglądzie, ani na
  // stronie publicznej.
  it("bije specyficznością reguły typografii widgetu (0,7,1)", () => {
    const css = buildJoinUsSizeCss("jus-1", {
      titleSize: 20,
      perkSize: 16,
      labelSize: 12,
      placeholderSize: 18,
    });
    const selectors = css
      .split("}")
      .map((chunk) => chunk.split("{")[0])
      .map((s) => s.replace(/^@media[^{]*/, "").trim())
      .filter(Boolean);
    expect(selectors.length).toBeGreaterThan(0);
    for (const sel of selectors) {
      const { b, c } = specificity(sel);
      expect(b, `selektor o zbyt niskiej specyficzności: ${sel}`).toBeGreaterThan(7);
      expect(c).toBeLessThanOrEqual(1);
    }
  });

  it("propaguje rozmiar bulletpointów na potomne li/span/svg", () => {
    const css = buildJoinUsSizeCss("jus-1", { perkSize: 16 });
    expect(css).toContain('[data-edit-target="perkSize"] :is(li,span,p,a,strong,em,svg)');
    expect(css).toContain("font-size:inherit !important");
  });

  it("wiąże placeholder i input bez nadpisywania osobnego rozmiaru etykiety", () => {
    const css = buildJoinUsSizeCss("jus-1", { placeholderSize: 18 });
    expect(css).toContain('[data-edit-target="placeholderSize"]::placeholder');
    expect(css).not.toContain(".user-label{font-size:18px !important;}");
    expect(css).not.toContain("@media");
  });

  it("stosuje rozmiar etykiet do nagłówka zainteresowań i floating labels", () => {
    const css = buildJoinUsSizeCss("jus-1", { labelSize: 15 });
    expect(css).toContain('[data-edit-target="labelSize"]{font-size:15px !important;}');
    expect(css).toContain(".user-label{font-size:15px !important;}");
  });

  it("chroni iOS przed auto-zoomem przy małych polach", () => {
    const css = buildJoinUsSizeCss("jus-1", { placeholderSize: 13 });
    expect(css).toContain("@media (max-width:767px)");
    expect(css).toContain("font-size:16px !important");
  });

  it("przypina bok ikon, gdy operator ustawił iconSize", () => {
    expect(buildJoinUsSizeCss("jus-1", {})).not.toContain("data-jus-icon");
    const css = buildJoinUsSizeCss("jus-1", { iconSize: 22 });
    expect(css).toContain("[data-jus-icon]");
    expect(css).toContain("width:22px !important");
    expect(css).toContain("height:22px !important");
  });

  it("normalizuje wartości spoza zakresu i ignoruje niepoprawne", () => {
    expect(buildJoinUsSizeCss("a", { titleSize: 999 })).toContain("96px");
    expect(buildJoinUsSizeCss("a", { titleSize: 2 })).toContain("8px");
    expect(buildJoinUsSizeCss("a", { titleSize: Number.NaN })).toBe("");
  });
});
