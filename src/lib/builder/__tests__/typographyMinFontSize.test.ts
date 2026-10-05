// Minimalny czytelny rozmiar (6 px) - ta sama reguła w OBU drogach typografii
// widgetu: szablonie HW-2 (`liveTypography.ts`) i generatorze reguł
// (`typographyCss.ts`, rozmiary spoza białej listy).
//
// Po co: w danych zostały rozmiary per urządzenie typu `1px` (przypadkowy klik
// w stepper), przez które etykieta na mobile była niewidoczna. Obie drogi muszą
// je pomijać identycznie, inaczej ten sam widget wyglądałby inaczej zależnie od
// tego, czy jego wartości trafiły do szablonu, czy do generatora.
import { describe, expect, it } from "vitest";
import { widgetTypographyTemplate } from "../liveTypography";
import { buildLegacyWidgetTypographyCss, buildWidgetTypographyCss } from "../typographyCss";

const id = "min-font";

describe("minimalny rozmiar czcionki", () => {
  it("generator schodzi po łańcuchu urządzeń przy nieczytelnej wartości", () => {
    const typography = { fontSize: { desktop: "18px", mobile: "1px" } };
    const mobile = buildWidgetTypographyCss(id, typography, "mobile");
    expect(mobile).toContain("font-size:18px !important");
    expect(mobile).not.toContain("1px !important");
  });

  it("szablon stosuje tę samą regułę dla każdego urządzenia", () => {
    const t = widgetTypographyTemplate({ fontSize: { desktop: "18px", mobile: "1px" } });
    expect(t.vars?.["--wt-fs-m"]).toBe("18px");
  });

  it("same nieczytelne wartości = brak rozmiaru w obu drogach", () => {
    const typography = { fontSize: { desktop: "2px", mobile: "1px" } };
    expect(widgetTypographyTemplate(typography).tokens).toBeUndefined();
    expect(buildWidgetTypographyCss(id, typography, "desktop")).not.toContain("font-size");
  });

  it("generator ramki emituje rozmiary tylko wtedy, gdy szablon ich nie przyjął", () => {
    // `clamp()` spoza białej listy: rozmiary generatorem, z tym samym
    // pominięciem nieczytelnej wartości mobilnej.
    const typography = { fontSize: { desktop: "clamp(1rem, 2vw, 2rem)", mobile: "1px" } };
    const css = buildLegacyWidgetTypographyCss({ widgetId: id, typography, device: "mobile" });
    expect(css).toContain("font-size:clamp(1rem, 2vw, 2rem) !important");
    expect(
      buildLegacyWidgetTypographyCss({
        widgetId: id,
        typography: { fontSize: { desktop: "18px" } },
        device: "desktop",
      }),
    ).toBe("");
  });
});
