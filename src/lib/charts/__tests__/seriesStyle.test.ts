// WYGLĄD SERII I KATEGORII - ranga serii wyróżnionej i stopnie neutralne
// tarczy.
//
// Dwie rzeczy pilnowane tutaj nie są widoczne w żadnym teście renderującym:
//   1. przy `accentSeries = 0` ranga JEST indeksem, więc wykresy zapisane
//      przed wprowadzeniem pola wyglądają co do atrybutu tak samo;
//   2. każdy stopień neutralny, jaki `categoryPaint` może wydać, ma na płycie
//      co najmniej 3:1 (wypełnienie) i 4,5:1 (napis) w OBU motywach - liczone
//      z wyrażenia, które naprawdę trafia do arkusza (`color-mix(in oklab,
//      ...)`), rozwiązanego na wartościach tokenów, a nie z obietnicy
//      w komentarzu.
import { describe, expect, it } from "vitest";
import { MAX_SERIES, PIE_MAX_SLICES } from "@/lib/charts/types";
import {
  CHART_PLATE,
  CONTRAST_MIN,
  colorMixOklab,
  contrastRatio,
  relativeLuminance,
  slotForSeries,
  type ChartThemeName,
} from "@/lib/charts/palette";
import { ROLE, ROLE_TOKEN_VALUES } from "@/lib/charts/roles";
import {
  CHART_PALETTES,
  categoryPaint,
  seriesPaint,
  seriesRank,
  SERIES_MARKERS,
} from "@/lib/charts/seriesStyle";

/** `var(--token)` -> hex wartości z kopii arkusza dla danego motywu. */
function resolveVar(expr: string, theme: ChartThemeName): string {
  const m = /^var\((--[a-z0-9-]+)\)$/.exec(expr.trim());
  if (!m) throw new Error(`nie jest tokenem: ${expr}`);
  const values = ROLE_TOKEN_VALUES[theme] as Record<string, string>;
  const hex = values[m[1]];
  if (!hex) throw new Error(`brak wartości tokenu ${m[1]} w ROLE_TOKEN_VALUES`);
  return hex;
}

/**
 * Rozwiązuje wyrażenie koloru dokładnie tak, jak zrobi to przeglądarka:
 * `var(...)` z arkusza albo `color-mix(in oklab, A p%, B)` liczone w OKLab.
 */
function resolveColor(expr: string, theme: ChartThemeName): string {
  const mix = /^color-mix\(in oklab, (var\([^)]+\)) (\d+(?:\.\d+)?)%, (var\([^)]+\))\)$/.exec(expr);
  if (mix) {
    return colorMixOklab(resolveVar(mix[1], theme), Number(mix[2]), resolveVar(mix[3], theme));
  }
  return resolveVar(expr, theme);
}

describe("seriesRank - seria wyróżniona dostaje rangę 0", () => {
  it("akcent 0: ranga = indeks, czyli wygląd sprzed pola", () => {
    for (let i = 0; i < MAX_SERIES; i += 1) expect(seriesRank(i, 0)).toBe(i);
  });

  it("akcent w środku: poprzedniki przesuwają się o jedno miejsce, następniki zostają", () => {
    expect([0, 1, 2, 3].map((i) => seriesRank(i, 2))).toEqual([1, 2, 0, 3]);
    expect([0, 1, 2, 3].map((i) => seriesRank(i, 3))).toEqual([1, 2, 3, 0]);
    expect([0, 1, 2, 3].map((i) => seriesRank(i, 1))).toEqual([1, 0, 2, 3]);
  });

  it("rangi są permutacją pozycji - żadne dwie serie nie dzielą wyglądu", () => {
    for (let accent = 0; accent < MAX_SERIES; accent += 1) {
      const ranks = Array.from({ length: MAX_SERIES }, (_, i) => seriesRank(i, accent));
      expect([...ranks].sort((a, b) => a - b)).toEqual(
        Array.from({ length: MAX_SERIES }, (_, i) => i),
      );
    }
  });

  it("akcent ujemny albo niecałkowity z configu zbudowanego w kodzie działa jak 0", () => {
    for (const accent of [-1, 1.5, Number.NaN]) {
      expect([0, 1, 2].map((i) => seriesRank(i, accent))).toEqual([0, 1, 2]);
    }
  });
});

describe("seriesPaint - wygląd idzie za RANGĄ", () => {
  it("przy akcencie 0 wynik jest IDENTYCZNY z wywołaniem po indeksie", () => {
    for (const palette of CHART_PALETTES) {
      for (let i = 0; i < MAX_SERIES; i += 1) {
        const slot = slotForSeries(i);
        expect(seriesPaint(slot, seriesRank(i, 0), palette)).toEqual(seriesPaint(slot, i, palette));
      }
    }
  });

  it("seria wyróżniona dostaje akcent, koło i pole główne - niezależnie od pozycji", () => {
    const paint = seriesPaint(slotForSeries(2), seriesRank(2, 2), "focus");
    expect(paint.color).toBe(ROLE.acc);
    expect(paint.textColor).toBe(ROLE.accText);
    expect(paint.marker).toBe(SERIES_MARKERS[0]);
    expect(paint.primary).toBe(true);
    expect(paint.dashed).toBe(false);
    // Dawna seria pierwsza przechodzi na rolę drugą - łupek główny, romb.
    const first = seriesPaint(slotForSeries(0), seriesRank(0, 2), "focus");
    expect(first.color).toBe(ROLE.sMain);
    expect(first.marker).toBe(SERIES_MARKERS[1]);
    expect(first.primary).toBe(false);
  });

  it("paleta kategorialna zostawia kolor slotu - ranga zmienia tylko kształt i kreskę", () => {
    const paint = seriesPaint(8, seriesRank(2, 2), "categorical");
    expect(paint.color).toBe("var(--chart-8)");
    expect(paint.primary).toBe(true);
  });
});

describe("categoryPaint - kolor wycinka tarczy", () => {
  it("paleta kategorialna: slot kategorii, jak dotąd", () => {
    expect(categoryPaint(0, 4, "categorical", 14)).toEqual({
      color: "var(--chart-14)",
      textColor: "var(--chart-14t)",
    });
    expect(categoryPaint(3, 4, "categorical", 3).color).toBe("var(--chart-3)");
  });

  it("paleta ról: ranga 0 w akcencie, reszta od łupka głównego do łupka drugiego", () => {
    expect(categoryPaint(0, 5, "focus", 3)).toEqual({ color: ROLE.acc, textColor: ROLE.accText });
    expect(categoryPaint(1, 5, "focus", 3)).toEqual({ color: ROLE.sMain, textColor: ROLE.sMain });
    expect(categoryPaint(4, 5, "focus", 3)).toEqual({ color: ROLE.sAlt, textColor: ROLE.sAltText });
    expect(categoryPaint(2, 5, "focus", 3).color).toBe(
      `color-mix(in oklab, ${ROLE.sAlt} 33%, ${ROLE.sMain})`,
    );
    expect(categoryPaint(3, 5, "focus", 3).color).toBe(
      `color-mix(in oklab, ${ROLE.sAlt} 67%, ${ROLE.sMain})`,
    );
    // Dwie kategorie: jedna wyróżniona, druga w łupku głównym.
    expect(categoryPaint(1, 2, "focus", 3).color).toBe(ROLE.sMain);
  });

  it("kod rysujący dostaje wyłącznie tokeny i mieszaniny tokenów - nigdy hex", () => {
    for (let count = 1; count <= MAX_SERIES; count += 1) {
      for (let rank = 0; rank < count; rank += 1) {
        const { color, textColor } = categoryPaint(rank, count, "focus", 3);
        for (const expr of [color, textColor]) expect(expr).not.toMatch(/#[0-9a-f]{3,6}/i);
      }
    }
  });

  // BRAMKA STOPNI NEUTRALNYCH. Liczba kategorii sięga dalej niż limit tarczy
  // (PIE_MAX_SLICES + wycinek zbiorczy), bo `categoryPaint` nie zna limitu
  // i bramka ma obejmować każdy stopień, jaki funkcja potrafi wydać.
  for (const theme of ["light", "dark"] as const) {
    it(`motyw ${theme}: każdy stopień neutralny >= 3:1, każdy napis >= 4,5:1 na płycie`, () => {
      const plate = CHART_PLATE[theme];
      for (let count = 2; count <= Math.max(MAX_SERIES, PIE_MAX_SLICES + 1); count += 1) {
        for (let rank = 1; rank < count; rank += 1) {
          const paint = categoryPaint(rank, count, "focus", 3);
          const fill = resolveColor(paint.color, theme);
          const text = resolveColor(paint.textColor, theme);
          const ctx = `${count} kategorii, ranga ${rank}: ${paint.color}`;
          expect(contrastRatio(fill, plate), ctx).toBeGreaterThanOrEqual(CONTRAST_MIN.graphic);
          expect(contrastRatio(text, plate), ctx).toBeGreaterThanOrEqual(CONTRAST_MIN.text);
        }
      }
    });

    it(`motyw ${theme}: stopnie są uporządkowane - kolejny wycinek tła jest bliżej płyty`, () => {
      // Łupek główny jest mocniejszy od łupka drugiego (bramka ról), więc
      // stopnie mają iść monotonicznie: wycinek o wyższej randze jest
      // słabszy, a dwa sąsiednie nie mają tej samej luminancji.
      const plate = CHART_PLATE[theme];
      for (let count = 3; count <= PIE_MAX_SLICES + 1; count += 1) {
        const contrasts = Array.from({ length: count - 1 }, (_, i) =>
          contrastRatio(resolveColor(categoryPaint(i + 1, count, "focus", 3).color, theme), plate),
        );
        for (let i = 1; i < contrasts.length; i += 1) {
          expect(contrasts[i], `${count} kategorii, krok ${i}`).toBeLessThan(contrasts[i - 1]);
        }
      }
      // Kotwica: krańce stopni to dokładnie tokeny ról.
      expect(relativeLuminance(resolveColor(ROLE.sMain, theme))).toBeCloseTo(
        relativeLuminance(ROLE_TOKEN_VALUES[theme]["--chart-s-main"]),
        6,
      );
    });
  }
});
