// ZAKRES OSI KATEGORII - przewijanie i przybliżanie wykresu o ponad
// `ZOOM_MIN_POINTS` punktach. Czysta arytmetyka na indeksach, bez pikseli:
// suwak, kółko myszy i klawiatura liczą tę samą rzecz, więc liczą ją tutaj.
//
// Zakres jest DOMKNIĘTY z obu stron (`start` i `end` to indeksy kategorii,
// które są widoczne). Okno nie schodzi poniżej `ZOOM_MIN_SPAN` kategorii -
// wykres z dwoma punktami na całej szerokości nie pokazuje już kształtu,
// tylko odcinek.
import type { ChartConfig } from "./types";

export interface ZoomRange {
  start: number;
  end: number;
}

export const ZOOM_MIN_SPAN = 5;

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

/** Zakres poprawny dla `total` kategorii: w granicach, rosnący, nie węższy niż minimum. */
export function clampZoom(range: ZoomRange, total: number): ZoomRange {
  if (total <= 1) return { start: 0, end: Math.max(0, total - 1) };
  const last = total - 1;
  const minSpan = Math.min(ZOOM_MIN_SPAN, total) - 1;
  let start = clampInt(Math.min(range.start, range.end), 0, last);
  let end = clampInt(Math.max(range.start, range.end), 0, last);
  if (end - start < minSpan) {
    end = Math.min(last, start + minSpan);
    start = Math.max(0, end - minSpan);
  }
  return { start, end };
}

/**
 * Przybliżenie wokół punktu kotwicy. `anchor` to położenie kursora w oknie
 * (0 = lewa krawędź, 1 = prawa), `factor` < 1 przybliża, > 1 oddala. Kategoria
 * pod kursorem zostaje pod kursorem - inaczej każdy obrót kółka przesuwałby
 * oglądany fragment poza ekran.
 */
export function zoomAround(
  range: ZoomRange,
  total: number,
  anchor: number,
  factor: number,
): ZoomRange {
  const span = range.end - range.start;
  const a = Math.max(0, Math.min(1, anchor));
  const pivot = range.start + span * a;
  const next = Math.max(1, span * factor);
  return clampZoom({ start: pivot - next * a, end: pivot + next * (1 - a) }, total);
}

/** Przesunięcie okna o `delta` kategorii bez zmiany jego szerokości. */
export function panBy(range: ZoomRange, total: number, delta: number): ZoomRange {
  const span = range.end - range.start;
  const start = Math.max(0, Math.min(total - 1 - span, range.start + Math.round(delta)));
  return { start, end: start + span };
}

/**
 * Wycinek konfiguracji dla okna. Granica prognozy przesuwa się razem
 * z oknem; gdy okno zaczyna się już w prognozie, granica ląduje na zerze
 * (cały widok jest prognozą), a gdy kończy się przed nią - znika.
 */
export function sliceConfig(config: ChartConfig, start: number, end: number): ChartConfig {
  const from = config.forecastFrom;
  const shifted = from === null ? null : from - start;
  const length = end - start + 1;
  return {
    ...config,
    categories: config.categories.slice(start, end + 1),
    series: config.series.map((s) => ({ ...s, values: s.values.slice(start, end + 1) })),
    forecastFrom: shifted === null || shifted >= length ? null : Math.max(0, shifted),
  };
}
