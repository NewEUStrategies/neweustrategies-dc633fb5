// FARBA KARTOGRAMU - czyste funkcje między skalą mapy (`kinds/mapScale.ts`)
// a rysunkiem (`ChoroplethMap.tsx`, `MapLegend.tsx`). Bez Reacta i bez DOM,
// więc bramki liczą je wprost.
//
// DWIE DROGI KOLORU, i to jest decyzja, nie dublowanie.
//   * WYGLĄD OPUBLIKOWANY: schemat `blue` bez klas (klucze nieobecne w treści,
//     czyli każda mapa sprzed wyboru schematu). Rysuje DOKŁADNIE te napisy
//     stylu, które mapa rysowała przed modelem skali: `color-mix()` na
//     `--chart-seq-max` / `--chart-seq-min` z udziałem `0.15 + 0.85 * t`,
//     a atrybut awaryjny to ten sam hex interpolowany w sRGB. Tokeny
//     `--chart-map-blue-*` mają te same hexy, ale inny NAPIS stylu byłby
//     zmianą opublikowanej treści, której nikt nie zamawiał - bramka
//     `mapPublishedLook.test.tsx` porównuje napisy znak w znak.
//   * KAŻDY INNY SCHEMAT I KLASY: kolor z `MapScale.colorOf` (wyrażenie CSS
//     na tokenach `--chart-map-*`), a atrybut awaryjny z kotwic hex
//     `MapScale.stopOf` zmieszanych w OKLab tą samą arytmetyką, którą
//     przeglądarka liczy `color-mix(in oklab, ...)`.
//
// Żadnego literału hex w tym pliku: kotwice idą z modułu palety (SEQ_RAMP,
// MAP_RAMPS, MAP_NEUTRALS), tak jak każda inna liczba koloru w silniku.
import {
  colorMixOklab,
  MAP_NEUTRALS,
  MAP_RAMPS,
  SEQ_RAMP,
  type ChartThemeName,
} from "@/lib/charts/palette";
import type { MapScale } from "@/lib/charts/kinds/mapScale";
import type { MapDatum, MapMethod, MapScheme } from "@/lib/charts/types";
import { formatChartValue, type ChartLang } from "@/lib/charts/format";

/** Wypełnienie kraju: wyrażenie CSS (styl) i hex awaryjny (atrybut `fill`). */
export interface MapPaint {
  style: string;
  fill: string;
}

/**
 * Czy mapa rysuje się WYGLĄDEM OPUBLIKOWANYM (patrz nagłówek). Tylko `blue`
 * w skali ciągłej - nowe mapy z klasami i każdy inny schemat idą przez model.
 */
export function usesPublishedRamp(scheme: MapScheme, scale: Pick<MapScale, "kind">): boolean {
  return scheme === "blue" && scale.kind === "continuous";
}

/** Interpolacja hex w sRGB - fallback mapy sprzed modelu, przepisany bez zmian. */
export function hexLerp(a: string, b: string, t: number): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  const mix = pa.map((v, i) => Math.round(v + (pb[i] - v) * t));
  return `#${mix.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Farba wartości. `theme` decyduje WYŁĄCZNIE o hexie awaryjnym - napis stylu
 * jest ten sam w obu motywach, bo motyw przełącza tokeny, nie wyrażenie.
 */
export function mapPaintOf(
  scale: MapScale,
  scheme: MapScheme,
  value: number,
  theme: ChartThemeName,
): MapPaint {
  if (usesPublishedRamp(scheme, scale)) {
    // Wzór mapy sprzed modelu, ZNAK W ZNAK (z literałem 0.85, nie
    // `1 - 0.15`): inna kolejność działań potrafi przesunąć udział o jeden
    // ulp, a `Math.round` na granicy połówki zmienia wtedy procent.
    const [lo, hi] = scale.domain;
    const span = hi - lo;
    const share = 0.15 + 0.85 * (span > 0 ? (value - lo) / span : 0);
    const pct = Math.round(share * 100);
    return {
      style: `color-mix(in oklab, var(--chart-seq-max) ${pct}%, var(--chart-seq-min))`,
      fill: hexLerp(SEQ_RAMP[theme].min, SEQ_RAMP[theme].max, share),
    };
  }
  const stop = scale.stopOf(value, theme);
  return {
    style: scale.colorOf(value),
    fill:
      stop === null
        ? MAP_RAMPS[scheme][theme].min
        : colorMixOklab(stop.to, Math.round(stop.t * 100), stop.from),
  };
}

/**
 * KRESKOWANIE „BRAK DANYCH" - geometria w pikselach CSS, nie w jednostkach
 * viewBoxu. Zasób geometrii ma szerokość 960, a widget bywa wąski jak 320 px:
 * wzór w jednostkach viewBoxu kurczyłby się razem z mapą do 1/3 i przy 320 px
 * zlewał w szarą plamę nie do odróżnienia od pierwszej klasy. `patternTransform`
 * mnoży wzór przez `viewBox / szerokość`, więc odstęp linii jest TEN SAM przy
 * każdej szerokości i w obu motywach.
 */
export const MAP_HATCH = {
  /** Odstęp linii kreskowania (px CSS) - próg bramki to 4 px przy 320 px. */
  spacingPx: 5,
  /** Grubość linii (px CSS). */
  linePx: 1,
  /** Kąt linii. */
  angle: 45,
  /**
   * Odstęp w PRÓBCE legendy i tooltipa (px CSS). Próbka ma 10 px, więc
   * odstęp mapy zostawiłby w niej jedną, dwie linie - za mało, żeby czytać
   * się jak kreskowanie.
   */
  swatchSpacingPx: 3,
} as const;

/** Szerokość viewBoxu zasobu (`"0 0 960 825"` -> 960); 0 przy zapisie nieczytelnym. */
export function viewBoxWidth(viewBox: string): number {
  const parts = viewBox
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  const w = parts[2];
  return Number.isFinite(w) && w > 0 ? w : 0;
}

/**
 * `patternTransform` kreskowania: obrót i skala `viewBox / szerokość` -
 * jednostka wzoru staje się pikselem CSS. Szerokość zerowa (przed pomiarem)
 * nie może dać nieskończonej skali, więc wtedy skala jest jednostkowa.
 */
export function hatchTransform(vbWidth: number, drawWidth: number): string {
  const k = vbWidth > 0 && drawWidth > 0 ? vbWidth / drawWidth : 1;
  return `rotate(${MAP_HATCH.angle}) scale(${Number(k.toFixed(4))})`;
}

/**
 * Próbka „brak danych" dla legendy HTML i tooltipa - ten sam wzór co na
 * mapie, z tokenów. W SVG kreskowanie jest wzorem (`<pattern>`), w HTML
 * gradientem powtarzalnym.
 */
export const MAP_NODATA_SWATCH = `repeating-linear-gradient(${MAP_HATCH.angle}deg, var(--chart-map-nodata-hatch) 0 ${MAP_HATCH.linePx}px, var(--chart-map-nodata) ${MAP_HATCH.linePx}px ${MAP_HATCH.swatchSpacingPx}px)`;

/** Hexy kreskowania dla atrybutów awaryjnych wzoru SVG. */
export function nodataHex(theme: ChartThemeName): { fill: string; hatch: string } {
  return { fill: MAP_NEUTRALS[theme].nodata, hatch: MAP_NEUTRALS[theme].nodataHatch };
}

/**
 * Pozycja wartości w rankingu malejącym (1 = najwyższa). Remis dostaje tę
 * samą pozycję („1, 1, 3"), bo dwa kraje o tej samej wartości nie są jeden
 * przed drugim.
 */
export function rankById(values: readonly MapDatum[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const v of values) {
    let above = 0;
    for (const other of values) if (other.value > v.value) above += 1;
    out.set(v.id, above + 1);
  }
  return out;
}

/** `t` nakładki mapy - z prefiksem `chartsMap` i językiem strony. */
export type MapT = (key: string, values?: Record<string, string | number>) => string;

/**
 * Klucze nakładki (bez prefiksu `chartsMap`) wołane z funkcji, które dostają
 * `t` z zewnątrz. W mapie, nie w literałach wywołań: bramka rozjazdu
 * kod-słownik czyta literał w pliku bez haka `useTranslation` jako klucz
 * GLOBALNY (ten sam wzorzec co `FACT_KEYS` w `chartFacts.ts`).
 */
export const MAP_PAINT_KEYS = {
  range: "range",
} as const;

/** Nazwy schematów - kanoniczne, te same co w edytorze mapy (`mapEditor.schemes`). */
export const MAP_SCHEME_KEYS: Record<MapScheme, string> = {
  blue: "schemes.blue",
  slate: "schemes.slate",
  accent: "schemes.accent",
  diverging: "schemes.diverging",
};

/** Nazwy metod podziału - kanoniczne, te same co w edytorze mapy (`mapEditor.methods`). */
export const MAP_METHOD_KEYS: Record<MapMethod, string> = {
  quantile: "methods.quantile",
  equal: "methods.equal",
};

/**
 * Podpis przedziału klasy w formacie jednostki: „od 10 do 20 mld EUR".
 * Jednostka stoi raz, przy górnej granicy; przedział zerowej szerokości
 * (jedna wartość) to jedna liczba.
 */
export function classRangeLabel(
  t: MapT,
  from: number,
  to: number,
  lang: ChartLang,
  unit: string,
): string {
  if (from === to) return formatChartValue(from, lang, unit);
  return t(MAP_PAINT_KEYS.range, {
    from: formatChartValue(from, lang),
    to: formatChartValue(to, lang, unit),
  });
}
