import { describe, expect, it } from "vitest";
import { buildJoinUsSizeCss } from "@/lib/interests/joinUsSizeCss";

describe("buildJoinUsSizeCss", () => {
  it("zwraca pusty string bez ustawionych rozmiarów", () => {
    expect(buildJoinUsSizeCss("jus-1", {})).toBe("");
    expect(buildJoinUsSizeCss("", { titleSize: 20 })).toBe("");
  });

  it("scopuje reguły po data-jus-id i wymusza !important", () => {
    const css = buildJoinUsSizeCss("jus-1", { titleSize: 17 });
    expect(css).toContain('[data-jus-id="jus-1"] [data-edit-target="titleSize"]');
    expect(css).toContain("font-size:17px !important");
  });

  it("propaguje rozmiar bulletpointów na potomne li/span", () => {
    const css = buildJoinUsSizeCss("jus-1", { perkSize: 16 });
    expect(css).toContain('[data-edit-target="perkSize"] :is(li,span,p,a,strong,em)');
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

  it("normalizuje wartości spoza zakresu i ignoruje niepoprawne", () => {
    expect(buildJoinUsSizeCss("a", { titleSize: 999 })).toContain("96px");
    expect(buildJoinUsSizeCss("a", { titleSize: 2 })).toContain("8px");
    expect(buildJoinUsSizeCss("a", { titleSize: Number.NaN })).toBe("");
  });
});
