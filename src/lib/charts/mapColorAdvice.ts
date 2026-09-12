// Ostrzeżenia o kolorze mapy - WYŁĄCZNIE dla edytorów.
//
// DLACZEGO OSOBNY MODUŁ, A NIE `mapFill.ts`. Tamten jedzie do czytelnika razem
// z rendererem; tutaj siedzi symulacja daltonizmu i mieszanie w oklab, których
// strona publiczna nie potrzebuje ani razu. Rozdział jest tu decyzją o tym, co
// ląduje w bundlu, a nie porządkowaniem plików.
//
// CZEGO TE FUNKCJE NIE ROBIĄ: nie blokują zapisu. Reguły doboru barw mają
// wyjątki, których kod nie zna (mapa polityczna bywa związana barwami partii),
// a zablokowany autor obchodzi walidację zamiast przeczytać powód.
import { CVD_FLOOR, CVD_KINDS, CHART_PLATE, cvdDistance, deltaE76, type CvdKind } from "./palette";
import { RAMP_FLOOR } from "./mapFill";
import type { MapDatum } from "./types";
import { MAP_MANUAL_COLOR_WARN_AT } from "./types";

/** Kolor krajów BEZ danych - `--secondary` z arkusza, per motyw. */
const NO_DATA: Record<"light" | "dark", string> = {
  light: "#f3f1ee",
  dark: "#1f1f1f",
};

/**
 * Próg „widać różnicę na dużej plamie". ΔE76 5 to mniej, niż wymaga podłoga
 * kategorii (`CVD_FLOOR.extended` = 10-12), i słusznie: tam chodzi o
 * ODRÓŻNIENIE DWÓCH SERII od siebie, tu o to, żeby kraj z najniższą wartością
 * nie wyglądał jak kraj bez danych. Punkt odniesienia jest zmierzony:
 * kotwica rampy motywu wobec `--secondary` daje ΔE 7,6 (jasny) i 10,3
 * (ciemny), a osiem z dwudziestu siedmiu barw palety zmieszanych w 15%
 * z powierzchnią schodzi poniżej 5.
 */
export const NO_DATA_MIN_DELTA = 5;

// --- oklab: TO SAMO MIESZANIE, CO ROBI `color-mix(in oklab, ...)` -----------
// Ostrzeżenie ma mówić o kolorze, który zobaczy czytelnik, więc musi liczyć
// tak jak przeglądarka, a nie tak jak awaryjny `hexLerp` w sRGB.

const srgb = (hex: string): number[] =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const lin = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const unlin = (c: number): number => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

function toOklab(hex: string): number[] {
  const [r, g, b] = srgb(hex).map(lin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function fromOklab([L, a, b]: number[]): string {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const ch = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return `#${ch
    .map((c) => Math.max(0, Math.min(255, Math.round(unlin(Math.max(0, Math.min(1, c))) * 255))))
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("")}`;
}

/** `color-mix(in oklab, color pct%, surface)` policzone w JS. */
export function mixOklab(color: string, surface: string, share: number): string {
  const a = toOklab(color);
  const b = toOklab(surface);
  return fromOklab([0, 1, 2].map((i) => b[i] + (a[i] - b[i]) * share));
}

/**
 * Motywy, w których NAJNIŻSZA wartość zleje się z krajem bez danych.
 *
 * Podłoga rampy (`RAMP_FLOOR`) była kalibrowana dla pary tokenów motywu, gdzie
 * `--chart-seq-min` jest osobną, ustaloną barwą. Przy barwie WŁASNEJ dolny
 * koniec to 15-procentowe rozcieńczenie jej powierzchnią - a dla barw bliskich
 * neutralnej strony to rozcieńczenie ląduje dokładnie tam, gdzie siedzi
 * `--secondary`. Podniesienie podłogi tego nie naprawia: te barwy przechodzą
 * na drugą stronę zamiast się oddalać. Jedyne, co pomaga, to inna barwa
 * bazowa - czyli decyzja autora, nie stała w kodzie.
 *
 * Pusty wynik znaczy „w obu motywach widać różnicę".
 */
export function rampColorClashesWithNoData(rampColor: string): Array<"light" | "dark"> {
  if (rampColor === "") return [];
  const zle: Array<"light" | "dark"> = [];
  for (const theme of ["light", "dark"] as const) {
    const podloga = mixOklab(rampColor, CHART_PLATE[theme], RAMP_FLOOR);
    if (deltaE76(podloga, NO_DATA[theme]) < NO_DATA_MIN_DELTA) zle.push(theme);
  }
  return zle;
}

export interface ManualColorAdvice {
  /** Liczba RÓŻNYCH barw, gdy sięgnęła progu; inaczej `null`. */
  tooMany: number | null;
  /** Pary barw, które przy którejś wadzie widzenia zlewają się w jedną. */
  cvdPairs: Array<{ a: string; b: string; kind: CvdKind; distance: number }>;
}

/**
 * Ostrzeżenia dla trybu ręcznego.
 *
 * DWA RÓŻNE PYTANIA, DWA OSOBNE OSTRZEŻENIA - i to jest tu istota. Licznik
 * mówi „jest ich dużo", ale liczba 8 pochodzi z palety WYSZUKANEJ I
 * ZWALIDOWANEJ (`CATEGORICAL_EXTENDED_MAX`), a autor mapy wybiera dowolnie.
 * Dwie barwy, które widzący autor uzna za wyraźnie różne, potrafią zlać się
 * w jedną przy deuteranopii - i wtedy sam licznik milczy, bo barw jest tylko
 * dwie. Dlatego liczymy też ODLEGŁOŚĆ PAR po symulacji, tym samym narzędziem,
 * którym repozytorium waliduje własną paletę.
 */
export function manualColorAdvice(values: readonly MapDatum[]): ManualColorAdvice {
  const barwy = [
    ...new Set(values.map((v) => v.color).filter((c): c is string => c !== undefined)),
  ];
  const cvdPairs: ManualColorAdvice["cvdPairs"] = [];
  for (let i = 0; i < barwy.length; i += 1) {
    for (let j = i + 1; j < barwy.length; j += 1) {
      for (const kind of CVD_KINDS) {
        const distance = cvdDistance(barwy[i], barwy[j], kind);
        if (distance < CVD_FLOOR.extended[kind]) {
          cvdPairs.push({ a: barwy[i], b: barwy[j], kind, distance });
          break; // jedna wada wystarczy, żeby para była problemem
        }
      }
    }
  }
  return {
    tooMany: barwy.length >= MAP_MANUAL_COLOR_WARN_AT ? barwy.length : null,
    cvdPairs,
  };
}
