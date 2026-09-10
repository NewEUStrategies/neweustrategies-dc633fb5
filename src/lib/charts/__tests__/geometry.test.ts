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
  BAR_GAP,
  BAR_MAX,
  CASCADE_STEP_DEFAULT_MS,
  CASCADE_STEP_MIN_MS,
  CASCADE_TOTAL_MAX_MS,
  CHART_RADIUS,
  DELICACY_TOKENS,
  DOTS_MAX_POINTS,
  FONT_AXIS,
  MIN_DOT_SPACING,
  PAD_BOTTOM,
  PAD_LEFT_MIN,
  PAD_SIDE,
  PAD_TOP,
  PAD_TOP_WITH_LABELS,
  SPACING,
  cascadeStepMs,
  clampRadius,
  effectiveSmoothing,
  shouldShowDots,
  snapSpacing,
  snapToGrid,
  valueTickTarget,
} from "@/lib/charts/geometry";
import { SMOOTHING_MIN_POINTS } from "@/lib/charts/smooth";

const css = readFileSync("src/styles.css", "utf8");
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
    for (const [name, block, expected] of cases) {
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

  it("KOREKTA IRRADIACJI istnieje: na ciemnym wszystko jest cieńsze", () => {
    // Jasny obiekt na ciemnym tle wydaje się większy niż ciemny na jasnym
    // o tych samych wymiarach. Bez tej korekty wykres na ciemnym wygląda
    // o klasę ciężej niż ten sam wykres na jasnym - i to jest jedyny powód,
    // dla którego te cztery tokeny w ogóle różnią się między motywami.
    const px = (v: string): number => Number.parseFloat(v);
    expect(px(DELICACY_TOKENS.dark.stroke)).toBeLessThan(px(DELICACY_TOKENS.light.stroke));
    expect(px(DELICACY_TOKENS.dark.dot)).toBeLessThan(px(DELICACY_TOKENS.light.dot));
    expect(px(DELICACY_TOKENS.dark.dotRing)).toBeLessThan(px(DELICACY_TOKENS.light.dotRing));
    expect(Number(DELICACY_TOKENS.dark.labelWeight)).toBeLessThan(
      Number(DELICACY_TOKENS.light.labelWeight),
    );
  });

  it("ŻADNE RUSZTOWANIE NIE JEST KRESKOWANE - ani token, ani reguła", () => {
    // ZMIANA REGUŁY, nie poprawka. Wcześniej prowadnica jechała kreskowaniem
    // 2 4 z tokena `--chart-guide-dash`; token zniknął, bo zniknęła reguła.
    // Trzy powody, wszystkie praktyczne: kreskowana obwódka czyta się
    // w konwencji interfejsu jako zaznaczenie do przeniesienia albo stan
    // nieukończony; kreska 1 px na współrzędnej niecałkowitej aliasuje i przy
    // innym DPR zamienia się w nierówny szereg plamek; a samo kreskowanie
    // wprowadza rytm konkurujący z rytmem danych - przy siedmiu i więcej
    // obserwacjach oko zaczyna czytać kreski jako trzeci szereg.
    expect(css).not.toContain("--chart-guide-dash");
    expect(() => token(LIGHT_BLOCK, "--chart-guide-dash")).toThrow();

    // Prowadnica, separator strefy prognozy i łączniki mostka - wszystkie
    // przez tę jedną klasę - są jawnie CIĄGŁE.
    const crosshair = css.slice(css.indexOf(".neh-chart .neh-crosshair {"));
    const rule = crosshair.slice(0, crosshair.indexOf("}"));
    expect(rule).toContain("stroke-dasharray: none");

    // Kreskowanie serii ZOSTAJE, bo nie jest rusztowaniem: to drugi nośnik
    // różnicy dla slotów poza zestawem bezpiecznym dla daltonizmu. Jedyna
    // dozwolona nieciągłość obok niego to tekstura strefy prognozy - a to nie
    // jest linia, tylko wypełnienie obszaru.
    expect(token(LIGHT_BLOCK, "--chart-series-dash")).toBe("7 4");
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
  it("wszystkie stałe layoutu leżą na skali 4 px", () => {
    // Jedna zmiana najbardziej podnosząca wrażenie precyzji: oko wyłapuje
    // 13 px obok 12 px szybciej niż jakąkolwiek różnicę koloru.
    for (const value of [PAD_TOP, PAD_TOP_WITH_LABELS, PAD_BOTTOM, PAD_SIDE, PAD_LEFT_MIN]) {
      expect(SPACING as readonly number[], `${value}`).toContain(value);
    }
    expect(SPACING as readonly number[]).toContain(BAR_MAX);
    expect(SPACING as readonly number[]).toContain(BAR_GAP * 2);
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

  it("kropki są OBOWIĄZKOWE przy wygładzeniu i opcjonalne przy łamanej", () => {
    expect(shouldShowDots(200, 0.55)).toBe(true);
    expect(shouldShowDots(DOTS_MAX_POINTS, 0)).toBe(true);
    expect(shouldShowDots(DOTS_MAX_POINTS + 1, 0)).toBe(false);
  });
});

describe("geometry - kaskada animacji", () => {
  it("kaskada NIGDY nie przekracza budżetu na całość", () => {
    // Przy czterdziestu słupkach 40 ms na element dałoby 1,6 s - czytelnik
    // czekałby na wykres dłużej niż na stronę.
    for (const count of [2, 5, 12, 25, 40, 60, 200]) {
      const total = cascadeStepMs(count) * (count - 1);
      expect(total, `${count} znaczników`).toBeLessThanOrEqual(CASCADE_TOTAL_MAX_MS);
    }
  });

  it("przy garstce znaczników krok zostaje na wartości domyślnej", () => {
    expect(cascadeStepMs(1)).toBe(CASCADE_STEP_DEFAULT_MS);
    expect(cascadeStepMs(2)).toBe(CASCADE_STEP_DEFAULT_MS);
  });

  it("krok nie schodzi poniżej podłogi - poniżej niej kaskada jest WYŁĄCZANA", () => {
    // Podłoga i budżet wykluczają się powyżej ~63 znaczników. Wygrywa budżet:
    // kaskada, której nie da się zobaczyć (krok pod 8 ms), jest samym
    // czekaniem, więc znaczniki wchodzą razem. Zero jest jedyną odpowiedzią,
    // która nie kłamie o tym, co użytkownik zobaczy.
    const graniczne = Math.floor(CASCADE_TOTAL_MAX_MS / CASCADE_STEP_MIN_MS) + 1;
    expect(cascadeStepMs(graniczne)).toBe(CASCADE_STEP_MIN_MS);
    expect(cascadeStepMs(graniczne + 1)).toBe(0);
    expect(cascadeStepMs(1000)).toBe(0);
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

  it("rozmiar etykiet osi jest jedną liczbą dla całego silnika", () => {
    expect(FONT_AXIS).toBe(11);
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
});
