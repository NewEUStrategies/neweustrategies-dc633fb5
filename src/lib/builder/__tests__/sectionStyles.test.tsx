// Style sekcji: układ, tło, nakładka, obramowanie, przerywniki kształtu
// i typografia zakresowa. Ten sam moduł zasila KANWĘ buildera i publiczny
// `BuilderRenderer`, więc każda rozbieżność tutaj to „w edytorze wyglądało
// inaczej niż na stronie". Startował z 6,0% linii i 0 z 13 funkcji.
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  sectionWrapperStyle,
  sectionContainerStyle,
  columnsRowStyle,
  backgroundLayerStyle,
  overlayLayerStyle,
  borderStyle,
  ShapeDivider,
  typographyCss,
  typographyAlign,
  INNER_SECTION_SAFE_AREA_PX,
  COLUMN_SAFE_AREA_PX,
} from "../sectionStyles";
import type {
  SectionNode,
  BackgroundSettings,
  OverlaySettings,
  BorderSettings,
  ShapeDividerSettings,
  TypographySettings,
} from "../types";

function section(over: Record<string, unknown> = {}): SectionNode {
  return { id: "s1", kind: "section", children: [], ...over } as unknown as SectionNode;
}

describe("stałe bezpiecznego marginesu", () => {
  it("są dodatnimi liczbami pikseli", () => {
    expect(INNER_SECTION_SAFE_AREA_PX).toBeGreaterThan(0);
    expect(COLUMN_SAFE_AREA_PX).toBeGreaterThan(0);
  });
});

describe("sectionWrapperStyle", () => {
  it("sekcja bez ustawień dostaje bazę pozycjonowania i zerowe marginesy", () => {
    const css = sectionWrapperStyle(section());
    expect(css.position).toBe("relative");
    expect(css.width).toBe("100%");
    expect(css.maxWidth).toBe("100%");
    expect(css.boxSizing).toBe("border-box");
    expect(css.marginTop).toBe("0px");
    expect(css.marginBottom).toBe("0px");
    // „default" = brak min-height: sekcja jest dokładnie tak wysoka jak treść.
    expect(css.minHeight).toBeUndefined();
    expect(css.height).toBeUndefined();
  });

  it("`stretch` wypycha sekcję na całą szerokość okna", () => {
    // Ujemne marginesy `calc(50% - 50vw)` wyrywają sekcję z kontenera - bez
    // zdjęcia `maxWidth` nie zadziałałyby.
    const css = sectionWrapperStyle(section({ layout: { stretch: true } }));
    expect(css.width).toBe("100vw");
    expect(css.maxWidth).toBeUndefined();
    expect(css.marginLeft).toBe("calc(50% - 50vw)");
    expect(css.marginRight).toBe("calc(50% - 50vw)");
  });

  it("`overflow: hidden` jest przenoszone, inne wartości nie", () => {
    expect(sectionWrapperStyle(section({ layout: { overflow: "hidden" } })).overflow).toBe(
      "hidden",
    );
    expect(
      sectionWrapperStyle(section({ layout: { overflow: "visible" } })).overflow,
    ).toBeUndefined();
  });

  it("`fit-screen` liczy wysokość w vh (domyślnie 100)", () => {
    expect(sectionWrapperStyle(section({ layout: { height: "fit-screen" } })).minHeight).toBe(
      "100vh",
    );
    expect(
      sectionWrapperStyle(section({ layout: { height: "fit-screen", heightValue: 60 } })).minHeight,
    ).toBe("60vh");
  });

  it("`min-height` liczy w px (domyślnie 40)", () => {
    expect(sectionWrapperStyle(section({ layout: { height: "min-height" } })).minHeight).toBe(
      "40px",
    );
    expect(
      sectionWrapperStyle(section({ layout: { height: "min-height", heightValue: 250 } }))
        .minHeight,
    ).toBe("250px");
  });

  it("`fixed` ustawia height ORAZ minHeight tą samą wartością", () => {
    // Sam `height` przegrywałby z treścią wyższą niż zadana - stąd oba.
    const css = sectionWrapperStyle(section({ layout: { height: "fixed" } }));
    expect(css.height).toBe("400px");
    expect(css.minHeight).toBe("400px");
    const own = sectionWrapperStyle(section({ layout: { height: "fixed", heightValue: 720 } }));
    expect(own.height).toBe("720px");
    expect(own.minHeight).toBe("720px");
  });

  it("marginesy przechodzą tylko jako LICZBY", () => {
    expect(
      sectionWrapperStyle(section({ layout: { marginTop: 24, marginBottom: 8 } })).marginTop,
    ).toBe("24px");
    // Wartość nieliczbowa z bazy degraduje do 0, a nie do „NaNpx".
    const bad = sectionWrapperStyle(section({ layout: { marginTop: "24px" } as unknown }));
    expect(bad.marginTop).toBe("0px");
  });
});

describe("sectionContainerStyle - szerokość treści", () => {
  it("domyślnie `boxed` z limitem 1140 px i wyśrodkowaniem", () => {
    const css = sectionContainerStyle(section());
    expect(css.maxWidth).toBe("1140px");
    expect(css.marginLeft).toBe("auto");
    expect(css.marginRight).toBe("auto");
  });

  it("`boxed` respektuje własną szerokość", () => {
    const css = sectionContainerStyle(section({ layout: { contentWidth: "boxed", width: 1400 } }));
    expect(css.maxWidth).toBe("1400px");
  });

  it("szerokość 0 lub ujemna spada na 1140 px", () => {
    // Zapis z bazy może mieć 0 po nieudanej edycji - bez tego strażnika
    // kontener zwężałby się do zera i sekcja znikała.
    expect(sectionContainerStyle(section({ layout: { width: 0 } })).maxWidth).toBe("1140px");
    expect(sectionContainerStyle(section({ layout: { width: -5 } })).maxWidth).toBe("1140px");
  });

  it("szerokość nieliczbowa też spada na domyślną", () => {
    expect(
      sectionContainerStyle(section({ layout: { width: "1200px" } as unknown })).maxWidth,
    ).toBe("1140px");
  });

  it("`full` rozciąga treść i NIE centruje", () => {
    const css = sectionContainerStyle(section({ layout: { contentWidth: "full" } }));
    expect(css.maxWidth).toBe("100%");
    expect(css.marginLeft).toBeUndefined();
  });

  it("zawsze zostawia bezpieczny padding boczny", () => {
    // Bez tego na ekranie węższym niż maxWidth treść dotyka krawędzi sekcji.
    for (const mode of ["boxed", "full"] as const) {
      const css = sectionContainerStyle(section({ layout: { contentWidth: mode } }));
      expect(css.paddingLeft).toBe("8px");
      expect(css.paddingRight).toBe("8px");
    }
  });
});

describe("columnsRowStyle - siatka kolumn", () => {
  it("buduje siatkę o liczbie ścieżek równej sumie spanów", () => {
    const css = columnsRowStyle(section(), 12);
    expect(css.display).toBe("grid");
    expect(css.gridTemplateColumns).toBe("repeat(12, minmax(0, 1fr))");
  });

  it("domyślna przerwa to 20 px i jest publikowana jako zmienna CSS", () => {
    // Zmienną czytają kolumny, żeby policzyć własną szerokość - musi zgadzać
    // się z `gap` co do piksela.
    const css = columnsRowStyle(section(), 2) as Record<string, unknown>;
    expect(css.gap).toBe("20px");
    expect(css["--builder-col-gap"]).toBe("20px");
  });

  it("mapuje nazwane presety przerw", () => {
    const cases: Array<[string, string]> = [
      ["no", "0px"],
      ["narrow", "10px"],
      ["extended", "15px"],
      ["wide", "30px"],
      ["wider", "40px"],
    ];
    for (const [preset, expected] of cases) {
      const css = columnsRowStyle(section({ layout: { columnsGap: preset } }), 2);
      expect(css.gap).toBe(expected);
    }
  });

  it("`custom` bierze wartość własną, a bez niej wraca do 20 px", () => {
    expect(
      columnsRowStyle(section({ layout: { columnsGap: "custom", columnsGapCustom: 7 } }), 2).gap,
    ).toBe("7px");
    expect(columnsRowStyle(section({ layout: { columnsGap: "custom" } }), 2).gap).toBe("20px");
  });

  it("wyrównanie `default` nie dokłada żadnych własności flex", () => {
    const css = columnsRowStyle(section({ layout: { verticalAlign: "default" } }), 2);
    expect(css.alignItems).toBeUndefined();
    expect(css.justifyContent).toBeUndefined();
  });

  it("mapuje wyrównania pionowe na alignItems / justifyContent", () => {
    expect(columnsRowStyle(section({ layout: { verticalAlign: "top" } }), 2).alignItems).toBe(
      "flex-start",
    );
    expect(columnsRowStyle(section({ layout: { verticalAlign: "middle" } }), 2).alignItems).toBe(
      "center",
    );
    expect(columnsRowStyle(section({ layout: { verticalAlign: "bottom" } }), 2).alignItems).toBe(
      "flex-end",
    );
    const between = columnsRowStyle(section({ layout: { verticalAlign: "space-between" } }), 2);
    expect(between.alignItems).toBe("stretch");
    expect(between.justifyContent).toBe("space-between");
  });

  it("nieznane wyrównanie nie wysypuje stylu", () => {
    const css = columnsRowStyle(section({ layout: { verticalAlign: "kosmiczne" } }), 2);
    expect(css.display).toBe("grid");
  });
});

describe("backgroundLayerStyle", () => {
  const bg = (o: Record<string, unknown>) => o as unknown as BackgroundSettings;

  it("brak tła daje pusty styl", () => {
    expect(backgroundLayerStyle(undefined)).toEqual({});
  });

  it("`classic` z kolorem ustawia backgroundColor", () => {
    expect(backgroundLayerStyle(bg({ type: "classic", color: "#abcdef" }))).toMatchObject({
      backgroundColor: "#abcdef",
    });
  });

  it("`classic` z obrazem ustawia komplet własności i domyślne wartości", () => {
    const css = backgroundLayerStyle(
      bg({ type: "classic", imageUrl: "https://example.test/a.jpg" }),
    );
    expect(css.backgroundImage).toContain("https://example.test/a.jpg");
    expect(css.backgroundPosition).toBe("center center");
    expect(css.backgroundRepeat).toBe("no-repeat");
    expect(css.backgroundSize).toBe("cover");
    expect(css.backgroundAttachment).toBe("scroll");
  });

  it("adres obrazu jest CYTOWANY w `url(...)`", () => {
    // Bez cudzysłowów adres ze spacją albo nawiasem rozwalałby deklarację.
    const css = backgroundLayerStyle(
      bg({ type: "classic", imageUrl: "https://example.test/a b.jpg" }),
    );
    expect(css.backgroundImage).toMatch(/^url\(".*"\)$/);
  });

  it("NIEBEZPIECZNY adres obrazu jest odrzucany, nie wstrzykiwany", () => {
    // `safeImageUrl` z sanitizePure - `javascript:` nie ma prawa dojechać do CSS.
    const css = backgroundLayerStyle(bg({ type: "classic", imageUrl: "javascript:alert(1)" }));
    expect(css.backgroundImage).toBeUndefined();
  });

  it("`gradient` liniowy używa kąta i lokalizacji", () => {
    const css = backgroundLayerStyle(
      bg({
        type: "gradient",
        gradientColor: "#111",
        gradientColor2: "#222",
        gradientAngle: 45,
        gradientLocation: 10,
        gradientLocation2: 90,
      }),
    );
    expect(css.backgroundImage).toBe("linear-gradient(45deg, #111 10%, #222 90%)");
  });

  it("`gradient` radialny ma inną funkcję CSS", () => {
    const css = backgroundLayerStyle(bg({ type: "gradient", gradientType: "radial" }));
    expect(css.backgroundImage).toContain("radial-gradient(circle,");
  });

  it("gradient bez ustawień ma sensowne domyślne", () => {
    const css = backgroundLayerStyle(bg({ type: "gradient" }));
    expect(css.backgroundImage).toBe("linear-gradient(180deg, #3a8bff 0%, transparent 100%)");
  });

  it("`video` i `slideshow` biorą tylko kolor podkładu", () => {
    for (const type of ["video", "slideshow"] as const) {
      const css = backgroundLayerStyle(
        bg({ type, color: "#000", imageUrl: "https://x.test/a.jpg" }),
      );
      expect(css.backgroundColor).toBe("#000");
      expect(css.backgroundImage).toBeUndefined();
    }
  });

  it("nieznany typ tła nadal honoruje kolor", () => {
    expect(backgroundLayerStyle(bg({ type: "cosnowego", color: "#fff" }))).toMatchObject({
      backgroundColor: "#fff",
    });
  });
});

describe("overlayLayerStyle", () => {
  const ov = (o: Record<string, unknown>) => o as unknown as OverlaySettings;

  it("brak nakładki lub typ `none` całkowicie ją ukrywa", () => {
    expect(overlayLayerStyle(undefined)).toEqual({ display: "none" });
    expect(overlayLayerStyle(ov({ type: "none" }))).toEqual({ display: "none" });
    expect(overlayLayerStyle(ov({}))).toEqual({ display: "none" });
  });

  it("nakładka leży nad tłem, pod treścią i nie łapie kliknięć", () => {
    const css = overlayLayerStyle(ov({ type: "classic", color: "#000" }));
    expect(css.position).toBe("absolute");
    expect(css.inset).toBe(0);
    expect(css.pointerEvents).toBe("none");
  });

  it("domyślna przezroczystość to 0.5, a tryb mieszania `normal`", () => {
    const css = overlayLayerStyle(ov({ type: "classic" }));
    expect(css.opacity).toBe(0.5);
    expect(css.mixBlendMode).toBe("normal");
  });

  it("przezroczystość 0 jest respektowana (nie zamieniana na 0.5)", () => {
    expect(overlayLayerStyle(ov({ type: "classic", opacity: 0 })).opacity).toBe(0);
  });

  it("nakładka korzysta z tych samych reguł tła", () => {
    const css = overlayLayerStyle(ov({ type: "gradient", gradientColor: "#f00" }));
    expect(css.backgroundImage).toContain("linear-gradient(180deg, #f00");
  });
});

describe("borderStyle", () => {
  const b = (o: Record<string, unknown>) => o as unknown as BorderSettings;

  it("brak obramowania lub styl `none` daje pusty styl", () => {
    expect(borderStyle(undefined)).toEqual({});
    expect(borderStyle(b({ style: "none" }))).toEqual({});
    expect(borderStyle(b({}))).toEqual({});
  });

  it("styl bez szerokości nie emituje borderWidth", () => {
    expect(borderStyle(b({ style: "solid" }))).toEqual({ borderStyle: "solid" });
  });

  it("szerokość rozpisuje cztery boki w px", () => {
    const css = borderStyle(b({ style: "solid", width: { top: 1, right: 2, bottom: 3, left: 4 } }));
    expect(css.borderWidth).toBe("1px 2px 3px 4px");
  });

  it("brakujące boki są zerowane", () => {
    expect(borderStyle(b({ style: "solid", width: { top: 5 } })).borderWidth).toBe(
      "5px 0px 0px 0px",
    );
  });

  it("wszystkie boki równe zero traktuje jak brak szerokości", () => {
    // Emisja `border-width: 0 0 0 0` przy zadanym stylu dawałaby niewidoczne
    // obramowanie, ale i tak zajmowałaby miejsce w kaskadzie.
    const css = borderStyle(b({ style: "solid", width: { top: 0, right: 0, bottom: 0, left: 0 } }));
    expect(css.borderWidth).toBeUndefined();
  });

  it("przenosi kolor, promień i cień", () => {
    const css = borderStyle(
      b({
        style: "dashed",
        color: "#123456",
        radius: { top: 6, right: 6, bottom: 6, left: 6 },
        boxShadow: "0 1px 2px #000",
      }),
    );
    expect(css.borderColor).toBe("#123456");
    expect(css.borderRadius).toBe("6px 6px 6px 6px");
    expect(css.boxShadow).toBe("0 1px 2px #000");
  });
});

describe("ShapeDivider", () => {
  const s = (o: Record<string, unknown>) => o as unknown as ShapeDividerSettings;
  const html = (node: ShapeDividerSettings | undefined, position: "top" | "bottom" = "top") =>
    renderToStaticMarkup(<ShapeDivider s={node as ShapeDividerSettings} position={position} />);

  it("nie renderuje nic bez ustawień, dla typu `none` i dla typu NIEZNANEGO", () => {
    expect(html(undefined)).toBe("");
    expect(html(s({ type: "none" }))).toBe("");
    expect(html(s({}))).toBe("");
    // Nieznany preset: brak ścieżki w katalogu - lepiej pustka niż puste <svg>.
    expect(html(s({ type: "kosmiczny-kształt" }))).toBe("");
  });

  it("renderuje svg ze ścieżką dla znanego presetu", () => {
    const out = html(s({ type: "mountains" }));
    expect(out).toContain("<svg");
    expect(out).toContain("<path");
    expect(out).toContain('viewBox="0 0 1000 100"');
    expect(out).toContain("aria-hidden");
  });

  it("domyślna wysokość 60 px i szerokość 100%", () => {
    const out = html(s({ type: "drops" }));
    expect(out).toContain("height:60px");
    expect(out).toContain("width:100%");
  });

  it("szerokość nigdy nie spada poniżej 100%", () => {
    // Węższy przerywnik odsłoniłby tło sekcji po bokach - stąd twardy minimum.
    expect(html(s({ type: "drops", width: 40 }))).toContain("width:100%");
    expect(html(s({ type: "drops", width: 150 }))).toContain("width:150%");
  });

  it("pozycja `top` przykleja do góry, `bottom` do dołu", () => {
    expect(html(s({ type: "drops" }), "top")).toContain("top:0");
    expect(html(s({ type: "drops" }), "bottom")).toContain("bottom:0");
  });

  it("odbicia składają się w JEDNĄ deklarację transform", () => {
    const out = html(s({ type: "drops", flipH: true, flipV: true }));
    expect(out).toContain("scaleX(-1) scaleY(-1)");
    expect(out.match(/transform:/g)).toHaveLength(1);
  });

  it("`bringToFront` podnosi przerywnik nad treść", () => {
    expect(html(s({ type: "drops", bringToFront: true }))).toContain("z-index:2");
    expect(html(s({ type: "drops" }))).toContain("z-index:0");
  });

  it("kolor domyślny to `currentColor`", () => {
    const out = html(s({ type: "drops" }));
    expect(out).toContain("currentColor");
  });
});

describe("typographyCss", () => {
  const t = (o: Record<string, unknown>) => o as unknown as TypographySettings;

  it("brak typografii daje pusty CSS", () => {
    expect(typographyCss("s1", undefined)).toBe("");
  });

  it("ustawienia bez ANI JEDNEGO koloru też dają pustkę", () => {
    expect(typographyCss("s1", t({}))).toBe("");
  });

  it("zakresuje każdą regułę do identyfikatora sekcji", () => {
    // Brak zakresu przelałby kolory na całą stronę - to był realny defekt klasy
    // „sekcja przemalowała cudzy nagłówek".
    const css = typographyCss("abc", t({ textColor: "#111" }));
    expect(css).toContain('[data-sec-id="abc"]{color:#111;}');
  });

  it("mapuje nagłówki, tekst, link i link pod kursorem", () => {
    const css = typographyCss(
      "s1",
      t({
        headingColor: "#1",
        textColor: "#2",
        linkColor: "#3",
        linkHoverColor: "#4",
      }),
    );
    expect(css).toContain(":is(h1,h2,h3,h4,h5,h6){color:#1;}");
    expect(css).toContain('[data-sec-id="s1"]{color:#2;}');
    expect(css).toContain("a{color:#3;}");
    expect(css).toContain("a:hover{color:#4;}");
  });
});

describe("typographyAlign", () => {
  const t = (o: Record<string, unknown>) => o as unknown as TypographySettings;

  it("brak wyrównania daje pusty styl", () => {
    expect(typographyAlign(undefined, "desktop")).toEqual({});
    expect(typographyAlign(t({}), "desktop")).toEqual({});
  });

  it("bierze wartość dla żądanego urządzenia", () => {
    const ty = t({ align: { desktop: "left", tablet: "center", mobile: "right" } });
    expect(typographyAlign(ty, "desktop")).toEqual({ textAlign: "left" });
    expect(typographyAlign(ty, "tablet")).toEqual({ textAlign: "center" });
    expect(typographyAlign(ty, "mobile")).toEqual({ textAlign: "right" });
  });

  it("spada na desktop, potem tablet, potem mobile", () => {
    expect(typographyAlign(t({ align: { desktop: "center" } }), "mobile")).toEqual({
      textAlign: "center",
    });
    expect(typographyAlign(t({ align: { tablet: "right" } }), "desktop")).toEqual({
      textAlign: "right",
    });
    expect(typographyAlign(t({ align: { mobile: "left" } }), "desktop")).toEqual({
      textAlign: "left",
    });
  });
});
