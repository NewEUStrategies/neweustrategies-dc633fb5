// Wypełnienie kraju na mapie: JEDNO miejsce, w którym rozstrzyga się, skąd
// bierze się kolor plamy. Moduł jest czysty (bez Reacta i bez DOM), bo to
// właśnie ta arytmetyka ma testy - komponent tylko ją wypisuje w atrybuty.
//
// KAŻDE WYPEŁNIENIE MA DWIE POSTACIE i nie jest to nadmiarowość:
//   `style` - docelowa, tokenowa albo `color-mix()`, liczona przez przeglądarkę
//             przy KAŻDEJ zmianie motywu, więc mapa nie musi się przerysować,
//             gdy czytelnik przełączy tryb ciemny;
//   `attr`  - awaryjna, policzona w JS na hexach, dla przeglądarek bez
//             `color-mix()`. Atrybut prezentacyjny SVG przegrywa ze `style`,
//             więc tam, gdzie `color-mix()` działa, awaryjna nigdy nie jest
//             widoczna - i dlatego tak łatwo o jej rozjazd z docelową.
//             Zgodności pilnuje bramka `mapFill.test.ts`.
import { CHART_PLATE, SEQ_RAMP } from "./palette";
import type { MapColorMode, MapDatum } from "./types";

export interface MapFill {
  /** Atrybut `fill` - hex policzony w JS (ścieżka awaryjna). */
  attr: string;
  /** `style.fill` - tokeny motywu albo `color-mix()` (ścieżka docelowa). */
  style: string;
}

/** Para kotwic rampy motywu - jasna albo ciemna. */
export type ThemeName = "light" | "dark";

/**
 * DOLNA KOTWICA RAMPY. Najmniejsza wartość nie schodzi do zera udziału, bo
 * wtedy kraj z najniższą wartością wyglądałby jak kraj BEZ DANYCH - a to dwie
 * różne wiadomości. 15% to najmniejszy udział, przy którym plama jest jeszcze
 * widocznie inna od tła na obu motywach.
 */
export const RAMP_FLOOR = 0.15;

/**
 * Udział barwy pełnej dla wartości w domenie [min, min+span].
 *
 * `span <= 0` (jeden kraj albo wszystkie wartości równe) daje samą kotwicę,
 * a nie dzielenie przez zero: legenda przy takiej domenie pokazuje jedną
 * liczbę i jedną próbkę, więc mapa musi pokazać dokładnie ten sam odcień.
 */
export function rampShare(value: number, min: number, span: number): number {
  // Strażnik na NIESKOŃCZONOŚĆ, nie na brak wartości: brak obsługuje
  // `countryFill` wyżej, a parsery odsiewają NaN i Infinity, zanim tu dojdą.
  // Zostaje, bo dzielenie przez `span` przy zatrutej domenie dałoby NaN
  // w atrybucie `fill`, czyli kraj bez wypełnienia i bez śladu w konsoli.
  if (!Number.isFinite(value)) return RAMP_FLOOR;
  const t = span > 0 ? (value - min) / span : 0;
  return RAMP_FLOOR + (1 - RAMP_FLOOR) * Math.min(1, Math.max(0, t));
}

/** Interpolacja dwóch hexów `#rrggbb` w przestrzeni sRGB. */
export function hexLerp(a: string, b: string, t: number): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  const mix = pa.map((v, i) => Math.round(v + (pb[i] - v) * t));
  return `#${mix.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Wypełnienie w trybie rampy.
 *
 * DWIE ŚCIEŻKI, bo barwa bazowa jest OPCJONALNA:
 *
 * `rampColor === ""` - mapa jedzie parą tokenów `--chart-seq-min/max`, czyli
 * dokładnie tak, jak jechała, zanim wybór barwy w ogóle istniał. Treść sprzed
 * tej zmiany nie zmienia wyglądu ani o odcień.
 *
 * `rampColor` ustawiony - mieszamy barwę autora z POWIERZCHNIĄ (`--card`),
 * a nie z bielą. W jasnym motywie to jest biel, więc „im mniej, tym bledsze"
 * znaczy dokładnie to, co miało znaczyć. W ciemnym mieszanie z bielą dałoby
 * plamy JAŚNIEJSZE od tła przy małych wartościach - czyli odwróciłoby
 * kierunek odczytu. Mieszanie z powierzchnią trzyma jedną regułę w obu
 * motywach: mniejsza wartość to mniejszy kontrast z tłem.
 */
export function rampFill(share: number, rampColor: string, theme: ThemeName): MapFill {
  const pct = Math.round(share * 100);
  if (rampColor === "") {
    const ramp = SEQ_RAMP[theme];
    return {
      attr: hexLerp(ramp.min, ramp.max, share),
      style: `color-mix(in oklab, var(--chart-seq-max) ${pct}%, var(--chart-seq-min))`,
    };
  }
  return {
    attr: hexLerp(CHART_PLATE[theme], rampColor, share),
    style: `color-mix(in oklab, ${rampColor} ${pct}%, var(--card))`,
  };
}

/**
 * Wypełnienie w trybie ręcznym.
 *
 * Kraj Z DANYMI, ale BEZ przypisanej barwy, dostaje dolną kotwicę rampy
 * motywu - nie `--secondary`, którym malowane są kraje bez danych. To są dwie
 * różne sytuacje („nie mam liczby" kontra „mam liczbę, nie należę do żadnej
 * grupy") i muszą wyglądać różnie, bo inaczej autor w pół drogi przez
 * kolorowanie widzi mapę, która twierdzi, że skasował sobie dane.
 */
export function manualFill(color: string | undefined, theme: ThemeName): MapFill {
  if (color === undefined) {
    return { attr: SEQ_RAMP[theme].min, style: "var(--chart-seq-min)" };
  }
  return { attr: color, style: color };
}

/**
 * Wypełnienie kraju - jedno wejście dla obu trybów.
 *
 * `colorMode` rozstrzyga WYŁĄCZNIE ten wybór i nic poza nim: wartości zostają
 * w treści w obu trybach (niosą je tooltip i tabela), barwy własne też. Dzięki
 * temu przełączenie trybu jest odwracalne bez utraty czegokolwiek, co autor
 * wpisał - a to jedyny sposób, żeby przełącznik był nieinwazyjny na tyle, by
 * dało się go bezpiecznie kliknąć w trakcie pracy.
 */
export function countryFill(
  datum: Pick<MapDatum, "value" | "color">,
  opts: { mode: MapColorMode; rampColor: string; min: number; span: number; theme: ThemeName },
): MapFill {
  if (opts.mode === "manual") return manualFill(datum.color, opts.theme);
  // WPIS BEZ WARTOŚCI W TRYBIE WIELKOŚCI nie ma czego zakodować. Nie schodzi
  // na dolną kotwicę rampy, bo ta znaczy „najmniejsza wartość" - a to byłaby
  // liczba, której autor nie podał. Dostaje ten sam wygląd, co kraj bez
  // przypisanej barwy w trybie ręcznym: „mam wpis, nie mam czym go zmierzyć".
  // Sytuacja powstaje po przełączeniu trybu na mapie politycznej i ma być
  // widoczna, a nie udawać danych.
  if (datum.value === null) return manualFill(undefined, opts.theme);
  return rampFill(rampShare(datum.value, opts.min, opts.span), opts.rampColor, opts.theme);
}

/**
 * Klucz legendy trybu ręcznego: barwy w kolejności PIERWSZEGO wystąpienia,
 * z listą krajów przy każdej.
 *
 * Kolejność pierwszego wystąpienia, a nie alfabetyczna po kodzie barwy:
 * autor koloruje w kolejności, w której myśli o grupach, więc legenda ułożona
 * tak samo daje się czytać razem z formą. Sortowanie po hexie ustawiałoby
 * grupy wg przypadkowej arytmetyki kanałów RGB.
 */
export function manualLegend(values: readonly MapDatum[]): Array<{ color: string; ids: string[] }> {
  const out: Array<{ color: string; ids: string[] }> = [];
  const index = new Map<string, number>();
  for (const v of values) {
    if (v.color === undefined) continue;
    const at = index.get(v.color);
    if (at === undefined) {
      index.set(v.color, out.length);
      out.push({ color: v.color, ids: [v.id] });
    } else {
      out[at].ids.push(v.id);
    }
  }
  return out;
}

/** Liczba RÓŻNYCH barw przypisanych ręcznie - wejście progu ostrzeżenia. */
export function manualColorCount(values: readonly MapDatum[]): number {
  return manualLegend(values).length;
}
