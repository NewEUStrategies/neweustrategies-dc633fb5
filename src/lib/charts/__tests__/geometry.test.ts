// Geometria silnika wykresów. Dwa rodzaje asercji:
//
//   1. REGUŁY, których nie widać w renderze - przycięcie promienia, warunek
//      uczciwości wygładzenia, budżet kaskady;
//   2. BRAMKA ZGODNOŚCI tokenów delikatności z arkuszem. Promień słupka jest
//      liczbą w JS (wchodzi do atrybutu `d`), a grubość kreski i rozmiar
//      kropki są tokenami CSS - te dwa zapisy MUSZĄ mówić to samo, inaczej
//      wykres ma jeden promień w ścieżce i inny na karcie.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BAR_MAX,
  BAR_MAX_STACKED,
  BAR_RADIUS,
  BAR_SERIES_GAP,
  CHART_RADIUS,
  COMPACT_WIDTH,
  DELICACY_TOKENS,
  DOT_RADIUS,
  DOT_RING,
  DOTS_MAX_POINTS,
  ENTRY_EASE,
  ENTRY_MS,
  FONT_AXIS,
  FONT_AXIS_COMPACT,
  MIN_DOT_SPACING,
  PAD_BOTTOM,
  PAD_LEFT_EDGE,
  PAD_LEFT_MIN,
  PAD_RIGHT,
  PAD_RIGHT_COMPACT,
  PAD_SIDE,
  PAD_TOP,
  PAD_TOP_WITH_LABELS,
  SLIDER_HEIGHT,
  SPACING,
  UPDATE_MS,
  ZOOM_MIN_POINTS,
  axisFontSize,
  barLayout,
  cascadeStepMs,
  clampBarRadius,
  clampRadius,
  effectiveSmoothing,
  padRightFor,
  shouldShowDots,
  snapSpacing,
  snapToGrid,
  valueTickTarget,
} from "@/lib/charts/geometry";
import { SMOOTHING_MIN_POINTS } from "@/lib/charts/smooth";

const css = ["src/styles.css", "src/components/charts/charts.css"]
  .map((path) => readFileSync(path, "utf8"))
  .join("\n");
const LIGHT_BLOCK = css.slice(css.indexOf(":root,"), css.indexOf(".dark {"));
const DARK_BLOCK = css.slice(css.indexOf(".dark {"), css.indexOf("@layer base"));

function token(block: string, name: string): string {
  const m = block.match(new RegExp(`${name}:\\s*([^;]+);`));
  if (!m) throw new Error(`brak tokenu ${name}`);
  return m[1].trim();
}

describe("geometry - promień", () => {
  it("JEDEN promień, przycięty do połowy krótszego boku", () => {
    // Bez przycięcia niski słupek zamienia się w owal i jego wysokość
    // przestaje być czytelna - czyli zaokrąglenie zaczyna ZNIEKSZTAŁCAĆ DANE.
    expect(clampRadius(24, 100)).toBe(CHART_RADIUS);
    expect(clampRadius(24, 8)).toBe(4);
    expect(clampRadius(6, 100)).toBe(3);
    expect(clampRadius(0, 100)).toBe(0);
    expect(clampRadius(-5, 100)).toBe(0);
  });

  it("promień w arkuszu jest TEN SAM co promień w ścieżce", () => {
    // Ta asercja jest cała treścią rozdzielenia CSS i JS: karta bierze
    // promień z tokena, a ścieżka słupka z liczby, i gdyby te dwie wartości
    // się rozjechały, wykres miałby dwa różne zaokrąglenia obok siebie.
    expect(token(LIGHT_BLOCK, "--chart-radius")).toBe(`${CHART_RADIUS}px`);
  });
});

describe("geometry - tokeny delikatności zgadzają się z arkuszem", () => {
  const cases = [
    ["jasny", LIGHT_BLOCK, DELICACY_TOKENS.light] as const,
    ["ciemny", DARK_BLOCK, DELICACY_TOKENS.dark] as const,
  ];

  it("grubość kreski, kropka, obwódka i TRZY stopnie wagi są identyczne", () => {
    // Blok ciemny ich nie redefiniuje (patrz test niżej), więc porównujemy
    // arkusz jasny - z niego oba motywy dziedziczą.
    for (const [name, block, expected] of cases.slice(0, 1)) {
      expect(token(block, "--chart-stroke"), `${name} kreska`).toBe(expected.stroke);
      expect(token(block, "--chart-dot"), `${name} kropka`).toBe(expected.dot);
      expect(token(block, "--chart-dot-ring"), `${name} obwódka`).toBe(expected.dotRing);
      expect(token(block, "--chart-label-weight"), `${name} waga`).toBe(expected.labelWeight);
      expect(token(block, "--chart-label-weight-strong"), `${name} waga mocna`).toBe(
        expected.labelWeightStrong,
      );
      expect(token(block, "--chart-label-weight-total"), `${name} waga sumy`).toBe(
        expected.labelWeightTotal,
      );
    }
  });

  it("trzy stopnie wagi są UPORZĄDKOWANE - inaczej emfaza przestaje działać", () => {
    // Blankietowa reguła CSS na `text` zdejmowała emfazę z sumy pierścienia
    // i z etykiet wartości, bo CSS wygrywa z atrybutem prezentacyjnym SVG.
    // Trzy tokeny zamiast jednego są odpowiedzią na to - i muszą rosnąć.
    for (const [name, , expected] of cases) {
      const base = Number(expected.labelWeight);
      const strong = Number(expected.labelWeightStrong);
      const total = Number(expected.labelWeightTotal);
      expect(base, `${name}`).toBeLessThan(strong);
      expect(strong, `${name}`).toBeLessThan(total);
    }
  });

  it("GEOMETRIA NIE ZALEŻY OD MOTYWU - przełączenie zmienia kolory, nie układ", () => {
    // Specyfikacja systemu wykresów: wykres wygląda i zachowuje się tak samo
    // w obu motywach, a zasada repozytorium mówi, że typografia, wymiary
    // i grubości są wspólne. Arkusz ciemny ich NIE redefiniuje.
    expect(DELICACY_TOKENS.dark).toEqual(DELICACY_TOKENS.light);
    for (const name of [
      "--chart-stroke",
      "--chart-dot",
      "--chart-dot-ring",
      "--chart-label-weight",
      "--chart-label-weight-strong",
      "--chart-label-weight-total",
    ]) {
      expect(DARK_BLOCK, name).not.toMatch(new RegExp(`\\s${name}:`));
    }
  });

  it("punkt ma 7 px średnicy i obwódkę 1,5 px - w JS i w arkuszu", () => {
    expect(DOT_RADIUS * 2).toBe(7);
    expect(DOT_RING).toBe(1.5);
    expect(token(LIGHT_BLOCK, "--chart-dot")).toBe(`${DOT_RADIUS}px`);
    expect(token(LIGHT_BLOCK, "--chart-dot-ring")).toBe(`${DOT_RING}px`);
    expect(token(LIGHT_BLOCK, "--chart-stroke")).toBe("2px");
  });

  it("RUSZTOWANIE JEST CIĄGŁE, a przerywane są tylko odniesienia i trzecia seria", () => {
    // Siatka, osie, separator prognozy i łączniki mostka są ciągłe - to tło.
    // Przerywane są wyłącznie elementy, które czytelnik ma ODRÓŻNIĆ od danych:
    // prowadnica pod kursorem (4 4), linia celu (5 4) i trzecia oraz dalsze
    // serie (6 4), gdzie przerywanie jest drugim nośnikiem różnicy obok koloru.
    expect(css).not.toContain("--chart-guide-dash");
    const rule = (selector: string): string => {
      const from = css.slice(css.indexOf(selector));
      return from.slice(0, from.indexOf("}"));
    };
    expect(rule(".neh-chart .neh-crosshair {")).toContain("stroke-dasharray: 4 4");
    expect(rule(".neh-chart .neh-crosshair {")).toContain("var(--chart-ink3)");
    expect(rule(".neh-chart .neh-target-line {")).toContain("stroke-dasharray: 5 4");
    expect(rule(".neh-chart .neh-connector {")).not.toContain("dasharray");
    expect(rule(".neh-chart .neh-forecast-divider {")).not.toContain("dasharray");
    expect(token(LIGHT_BLOCK, "--chart-series-dash")).toBe("6 4");
  });

  it("cień jest DWUWARSTWOWY na jasnym i NIE ISTNIEJE na ciemnym", () => {
    // Cień symuluje przesłonięcie światła; na ciemnym tle nie ma czego
    // przesłaniać, więc wysokość koduje jaśniejsza powierzchnia plus
    // obramowanie, a nie box-shadow.
    const light = token(LIGHT_BLOCK, "--chart-shadow");
    expect(light.match(/rgb/g)).toHaveLength(2);
    expect(token(DARK_BLOCK, "--chart-shadow")).toBe("none");
  });
});

describe("geometry - skala odstępów", () => {
  it("marginesy i wymiary są z SPECYFIKACJI, a odstępy layoutu na skali 4 px", () => {
    // Siatka wykresu: lewy 6, prawy 24 (14 w układzie zwartym), górny 30.
    expect(PAD_LEFT_EDGE).toBe(6);
    expect(PAD_RIGHT).toBe(24);
    expect(PAD_RIGHT_COMPACT).toBe(14);
    expect(PAD_TOP).toBe(30);
    expect(PAD_TOP_WITH_LABELS).toBe(30);
    for (const value of [PAD_BOTTOM, PAD_SIDE, PAD_LEFT_MIN]) {
      expect(SPACING as readonly number[], `${value}`).toContain(value);
    }
    expect(padRightFor(COMPACT_WIDTH - 1)).toBe(PAD_RIGHT_COMPACT);
    expect(padRightFor(COMPACT_WIDTH)).toBe(PAD_RIGHT);
  });

  it("słupek: najwyżej 22 px (34 px w stosie), odstęp serii 25%, koniec danych 4 px", () => {
    expect(BAR_MAX).toBe(22);
    expect(BAR_MAX_STACKED).toBe(34);
    expect(BAR_SERIES_GAP).toBe(0.25);
    expect(BAR_RADIUS).toBe(4);
    // Szerokie pasmo: sufit; wąskie: grupa wypełnia 80% pasma.
    expect(barLayout(200, 1, false).width).toBe(BAR_MAX);
    expect(barLayout(200, 1, true).width).toBe(BAR_MAX_STACKED);
    const trzy = barLayout(40, 3, false);
    expect(trzy.gap).toBeCloseTo(trzy.width * BAR_SERIES_GAP);
    expect(3 * trzy.width + 2 * trzy.gap).toBeCloseTo(40 * 0.8);
    // Promień przycięty do połowy długości przy słupku bez obwódki - niski
    // słupek nie staje się kopułką.
    expect(clampBarRadius(20, 4, { bordered: false, inset: 0 })).toBe(2);
    expect(clampBarRadius(20, 100, { bordered: false, inset: 0 })).toBe(BAR_RADIUS);
  });

  it("snapSpacing wchodzi na szczebel w GÓRĘ i nie przekracza ostatniego", () => {
    expect(snapSpacing(1)).toBe(4);
    expect(snapSpacing(4)).toBe(4);
    expect(snapSpacing(5)).toBe(8);
    expect(snapSpacing(1000)).toBe(64);
  });

  it("snapToGrid zaokrągla w górę do wielokrotności 4 także POWYŻEJ skali", () => {
    // Obrócone etykiety potrafią potrzebować ponad 64 px, a `snapSpacing`
    // przestaje wtedy mieć co zwrócić.
    expect(snapToGrid(0)).toBe(0);
    expect(snapToGrid(1)).toBe(4);
    expect(snapToGrid(64)).toBe(64);
    expect(snapToGrid(97)).toBe(100);
    expect(snapToGrid(-10)).toBe(0);
  });
});

describe("geometry - warunek uczciwości wygładzenia", () => {
  it("wygładzenie MILCZY, gdy punktów jest za mało", () => {
    expect(effectiveSmoothing(3, 0.55, 50, SMOOTHING_MIN_POINTS)).toBe(0);
    expect(effectiveSmoothing(SMOOTHING_MIN_POINTS, 0.55, 50, SMOOTHING_MIN_POINTS)).toBe(0.55);
  });

  it("wygładzenie WYŁĄCZA SIĘ, gdy kropki obserwacji by się zlały", () => {
    // Skoro nie da się pokazać, gdzie zmierzono, nie wolno rysować krzywej
    // między pomiarami - zostaje łamana, na której wierzchołek JEST pomiarem.
    expect(effectiveSmoothing(40, 0.55, MIN_DOT_SPACING - 0.1, SMOOTHING_MIN_POINTS)).toBe(0);
    expect(effectiveSmoothing(40, 0.55, MIN_DOT_SPACING, SMOOTHING_MIN_POINTS)).toBe(0.55);
  });

  it("zero i wartości nieliczbowe nie włączają wygładzania", () => {
    expect(effectiveSmoothing(40, 0, 50, SMOOTHING_MIN_POINTS)).toBe(0);
    expect(effectiveSmoothing(40, Number.NaN, 50, SMOOTHING_MIN_POINTS)).toBe(0);
  });

  it("siła powyżej 1 jest przycinana", () => {
    expect(effectiveSmoothing(40, 5, 50, SMOOTHING_MIN_POINTS)).toBe(1);
  });

  it("punkty na stałe do 20 punktów, powyżej tylko pod kursorem", () => {
    expect(DOTS_MAX_POINTS).toBe(20);
    expect(shouldShowDots(DOTS_MAX_POINTS)).toBe(true);
    expect(shouldShowDots(DOTS_MAX_POINTS + 1)).toBe(false);
  });
});

describe("geometry - animacja", () => {
  it("wejście 400 ms z krzywą cubicOut, aktualizacja 300 ms - w JS i w arkuszu", () => {
    expect(ENTRY_MS).toBe(400);
    expect(UPDATE_MS).toBe(300);
    expect(css).toContain(`--neh-anim-ms: ${ENTRY_MS}ms`);
    expect(css).toContain(`--neh-state-ms: ${UPDATE_MS}ms`);
    expect(css).toContain(`--neh-anim-ease: ${ENTRY_EASE}`);
  });

  it("BEZ wejścia elementów jeden po drugim - krok kaskady zawsze zero", () => {
    for (const count of [1, 2, 5, 40, 1000]) expect(cascadeStepMs(count)).toBe(0);
    expect(css).toContain("--neh-step: 0ms");
  });

  it("tooltip pojawia się od razu", () => {
    expect(css).toContain("--neh-tip-ms: 0ms");
    const rule = css.slice(css.indexOf(".neh-tooltip {"));
    expect(rule.slice(0, rule.indexOf("}"))).not.toContain("animation");
  });
});

describe("geometry - zakres osi", () => {
  it("suwak i przybliżanie wchodzą powyżej 30 punktów, suwak ma 18 px", () => {
    expect(ZOOM_MIN_POINTS).toBe(30);
    expect(SLIDER_HEIGHT).toBe(18);
  });
});

describe("geometry - podziałki osi wartości", () => {
  it("gęstość podziałek rośnie z wysokością, a poziomo jest stała", () => {
    expect(valueTickTarget(160, false)).toBeLessThan(valueTickTarget(640, false));
    expect(valueTickTarget(160, true)).toBe(valueTickTarget(640, true));
  });

  it("nigdy mniej niż trzy podziałki - dwie nie robią skali", () => {
    expect(valueTickTarget(1, false)).toBeGreaterThanOrEqual(3);
  });

  it("etykiety osi: 11,5 px, a w panelu węższym niż 600 px - 10,5 px", () => {
    expect(FONT_AXIS).toBe(11.5);
    expect(FONT_AXIS_COMPACT).toBe(10.5);
    expect(axisFontSize(COMPACT_WIDTH)).toBe(FONT_AXIS);
    expect(axisFontSize(COMPACT_WIDTH - 1)).toBe(FONT_AXIS_COMPACT);
  });
});

describe("arkusz druku - wykres na papierze pokazuje DANE, nie stan wejścia", () => {
  // Wejście wykresu jest uzbrajane klasą `.neh-armed` dla elementów POZA
  // widokiem i odpalane obserwatorem przy wejściu w widok. Na papierze
  // obserwator nie odpala nigdy - drukarka nie przewija strony. Wykres
  // stojący niżej na stronie wychodził więc z drukarki jako pusta karta
  // z osiami: linia miała `stroke-dasharray: 1` (czyli była niewidoczna),
  // słupki `scaleY(0)`, etykiety `opacity: 0`. Blok druku musi wymuszać stan
  // KOŃCOWY, tak samo jak blok `prefers-reduced-motion`.
  //
  // Arkusz ma KILKA bloków `@media print` (druk wpisu, druk panelu, druk
  // wykresu), więc bierzemy ten, który mówi o wykresie, i wycinamy go
  // dopasowaniem nawiasów - `indexOf` trafiłby w pierwszy z listy,
  // a `lastIndexOf` w ostatni, i żaden z nich nie jest tym właściwym.
  const balanced = (start: number): string => {
    let depth = 0;
    for (let i = css.indexOf("{", start); i < css.length; i++) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}" && --depth === 0) return css.slice(start, i + 1);
    }
    throw new Error("niedomknięty blok CSS");
  };
  const PRINT_START = css.lastIndexOf("@media print", css.indexOf(".dark .neh-chart,"));
  const PRINT_BLOCK = balanced(PRINT_START);
  const ARMED_LINE = css.indexOf(".neh-armed .neh-line {");

  it("blok druku rozbraja wejście linii, słupków i etykiet", () => {
    expect(PRINT_BLOCK).toContain(".neh-armed .neh-line");
    expect(PRINT_BLOCK).toContain(".neh-armed .neh-bar");
    expect(PRINT_BLOCK).toContain(".neh-armed .neh-fade");
    expect(PRINT_BLOCK).toContain(".neh-armed .neh-pie-group");
    expect(PRINT_BLOCK).toContain("stroke-dasharray: none");
  });

  it("reguły druku stoją PO regułach uzbrajających - inaczej nie wygrałyby kaskady", () => {
    // Media query nie dodaje specyficzności, więc o wyniku decyduje wyłącznie
    // kolejność w pliku. Reguła druku umieszczona wyżej byłaby martwa.
    expect(ARMED_LINE).toBeGreaterThan(0);
    expect(PRINT_START).toBeGreaterThan(ARMED_LINE);
  });

  it("kreskowanie serii poza zestawem bezpiecznym ZOSTAJE - to nośnik różnicy, nie animacja", () => {
    // Rozbrojenie `stroke-dasharray` bez tego wyjątku odebrałoby seriom 7-8
    // drugi nośnik różnicy dokładnie tam, gdzie kolor ginie najbardziej -
    // na wydruku czarno-białym.
    expect(PRINT_BLOCK).toContain(".neh-armed .neh-line-pattern");
    expect(PRINT_BLOCK).toContain("--chart-series-dash");
  });

  it("tabela danych trafia na papier, a przełącznik i tooltip nie", () => {
    // Tabela jest jedynym artefaktem, który przeżywa utratę koloru w druku,
    // a jako `hidden` nie trafiała na papier wcale.
    expect(PRINT_BLOCK).toContain("[data-chart-table][hidden]");
    expect(PRINT_BLOCK).toContain("[data-chart-table-toggle]");
  });

  it("w druku łuki tarczy wracają do wariantu SOLIDNEGO, a słupki są pełne zawsze", () => {
    // Wariant blady łuku stoi na kontraście wnętrza 1,20-1,28:1 do płyty, który
    // na papierze znika. Słupki są pełne także na ekranie, więc nie potrzebują
    // reguły druku - i nie mogą jej mieć, bo nadpisałaby czerwień ujemnej
    // wartości kolorem serii.
    expect(PRINT_BLOCK).toContain("fill: var(--neh-arc-token)");
    expect(PRINT_BLOCK).toContain('.neh-slice[data-active="true"]');
    expect(PRINT_BLOCK).not.toContain('.neh-bar[data-style="pale"]');
    expect(PRINT_BLOCK).toContain(".neh-arc-label");
    expect(PRINT_BLOCK).toContain("fill: var(--neh-arc-ink)");
  });

  it("słupek nie zmienia wypełnienia pod kursorem - nic, co niesie wartość", () => {
    expect(css).not.toContain('.neh-bar[data-style="pale"][data-active="true"]');
    const unified = css.slice(css.indexOf('[data-role="waterfall-step"]'));
    expect(unified.slice(0, unified.indexOf("}"))).toContain(
      "fill: var(--neh-bar-fill, var(--neh-bar-token))",
    );
  });

  it("strefa prognozy zamienia płaski tint na KRESKOWANIE - i tylko w druku", () => {
    // Tint 2,2% szarości nie ma na papierze czym się odbić od bieli, więc
    // prognoza traciła jeden z TRZECH nośników odróżnienia od historii.
    // Kreskowanie zostaje, bo linia ma krawędź - i to jedyne miejsce
    // w silniku, gdzie tekstura jest uzasadniona.
    expect(PRINT_BLOCK).toContain(".neh-zone-tint");
    expect(PRINT_BLOCK).toContain(".neh-zone-hatch");
    // Na EKRANIE jest odwrotnie: kreskowanie schowane, widoczny tint.
    // Reguła ekranowa musi stać PRZED blokiem druku, inaczej nie ustąpiłaby
    // kaskadzie (media query nie dodaje specyficzności).
    const screenHatch = css.indexOf(".neh-chart .neh-zone-hatch {");
    expect(screenHatch).toBeGreaterThan(0);
    expect(screenHatch).toBeLessThan(PRINT_START);
  });
});
