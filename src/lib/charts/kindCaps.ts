// ZDOLNOŚCI RODZAJÓW WYKRESU - jedna tabela zamiast zgadywania w każdym
// edytorze i w każdej ramie, co który rodzaj naprawdę rysuje.
//
// PO CO. Przełącznik palety, pola pasma optimum i celu, podpowiedź „Jak
// czytać" i przełączanie serii w legendzie były oferowane każdemu rodzajowi,
// a rysował je tylko rysownik kartezjański. Autor ustawiał pasmo na tarczy,
// zapisywał blok i nie widział nic - bez słowa, dlaczego. Edytory (pola
// widoczne warunkowo), schemat widgetu (`visibleWhen`) i rama wykresu
// (`hasBand`/`hasTarget`, teksty pomocy) czytają TĘ tabelę, więc obietnica
// interfejsu i rysunek nie mogą się rozjechać.
//
// TABELA OPISUJE STAN FAKTYCZNY, NIE PLAN. Flaga przechodzi na `true` w tej
// samej zmianie, w której rysownik zaczyna daną rzecz rysować - bramka
// `__tests__/kindCaps.test.tsx` renderuje każdy rodzaj i sprawdza flagi
// w OBIE strony (flaga `true` bez rysunku i rysunek bez flagi oblewają ją
// tak samo).
import type { ChartKind } from "./types";

/**
 * Do czego należy kolor na rysunku:
 *   * `series` - każda seria ma swój kolor (linie, słupki, grupy rozkładu),
 *   * `category` - kolor ma kategoria, nie seria (wycinki tarczy),
 *   * `single` - rysunek ma jeden kolor (histogram, linia centralna wachlarza),
 *   * `encoded` - kolor koduje WARTOŚĆ albo ZNAK (mapa ciepła, tornado, mostek),
 *     więc wybór koloru przez autora nie ma tu sensu,
 *   * `panels` - jeden kolor na panel (małe panele).
 */
export type ColorTarget = "series" | "category" | "single" | "encoded" | "panels";

export interface KindCaps {
  /** Wybór palety `focus`/`categorical` zmienia rysunek. */
  palette: boolean;
  colorTarget: ColorTarget;
  /** Rysuje pasmo optimum (ze źródłem albo demonstracyjne). */
  band: boolean;
  /** Rysuje linię celu. */
  target: boolean;
  /** Pozycje legendy ukrywają i pokazują serie. */
  legendToggle: boolean;
  /** Tooltip pokazuje siatkę ocen (Zmiana, Status, Znaczenie, Poziom). */
  facts: boolean;
  /** Rodzina - steruje tekstami pomocy i grupowaniem w edytorze. */
  family: "cartesian" | "distribution" | "part" | "relation" | "sensitivity" | "panels";
}

/** Rodzaje rysowane przez `CartesianChart` z paletą ról i legendą przełączaną. */
const CARTESIAN_SERIES: KindCaps = {
  palette: true,
  colorTarget: "series",
  band: true,
  target: true,
  legendToggle: true,
  facts: true,
  family: "cartesian",
};

/** Rodzaj bez żadnej z cech systemu odniesień - punkt wyjścia dla reszty. */
const PLAIN = {
  palette: false,
  band: false,
  target: false,
  legendToggle: false,
  facts: false,
} as const;

export const KIND_CAPS: Record<ChartKind, KindCaps> = {
  line: CARTESIAN_SERIES,
  area: CARTESIAN_SERIES,
  bar: CARTESIAN_SERIES,
  "bar-horizontal": CARTESIAN_SERIES,
  // MOSTEK idzie przez ten sam rysownik, więc dostaje pasmo, cel i siatkę
  // ocen w tooltipie (Zmiana i Poziom kroku), ale kolor koduje ZNAK kroku
  // i paleta go nie dotyczy, a legenda jest kluczem znaku, nie listą serii.
  waterfall: {
    palette: false,
    colorTarget: "encoded",
    band: true,
    target: true,
    legendToggle: false,
    facts: true,
    family: "cartesian",
  },
  pie: { ...PLAIN, colorTarget: "category", family: "part" },
  donut: { ...PLAIN, colorTarget: "category", family: "part" },
  histogram: { ...PLAIN, colorTarget: "single", family: "distribution" },
  boxplot: { ...PLAIN, colorTarget: "series", family: "distribution" },
  beeswarm: { ...PLAIN, colorTarget: "series", family: "distribution" },
  scatter: { ...PLAIN, colorTarget: "series", family: "relation" },
  heatmap: { ...PLAIN, colorTarget: "encoded", family: "sensitivity" },
  tornado: { ...PLAIN, colorTarget: "encoded", family: "sensitivity" },
  // Wachlarz rysuje JEDNĄ linię centralną z pasmami - kolor ma ta linia.
  fan: { ...PLAIN, colorTarget: "single", family: "cartesian" },
  "index-base": { ...PLAIN, colorTarget: "series", family: "cartesian" },
  "percent-stacked": { ...PLAIN, colorTarget: "series", family: "part" },
  "small-multiples": { ...PLAIN, colorTarget: "panels", family: "panels" },
};
