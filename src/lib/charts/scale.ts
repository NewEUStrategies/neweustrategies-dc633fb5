// Czysta matematyka skal wykresów: domeny, "ładne" podziałki (1-2-5),
// skala liniowa i kumulacja serii (stacked). Zero zależności, 100% testowalne.

import type { ChartSeries } from "./types";

export interface NiceScale {
  min: number;
  max: number;
  ticks: number[];
}

/**
 * "Ładna" skala osi wartości: rozszerza [min, max] do wielokrotności kroku
 * z progresji 1-2-5 i zwraca równe podziałki. Zawsze obejmuje 0 dla wykresów
 * słupkowych/pól (słupki rosną od zera - inaczej kłamią wysokością).
 */
export function niceScale(rawMin: number, rawMax: number, targetTicks = 5): NiceScale {
  let min = Math.min(rawMin, rawMax);
  let max = Math.max(rawMin, rawMax);
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    min = 0;
    max = 1;
  }
  if (min === max) {
    // Płaska seria - rozsuń symetrycznie, żeby linia nie leżała na krawędzi.
    const pad = Math.abs(min) > 0 ? Math.abs(min) * 0.2 : 1;
    min -= pad;
    max += pad;
  }

  const span = max - min;
  const step = niceStep(span / Math.max(2, targetTicks));
  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;

  const ticks: number[] = [];
  // Epsilon guards float drift (0.1+0.2 style) so the last tick always lands.
  for (let v = niceMin; v <= niceMax + step * 1e-6; v += step) {
    ticks.push(roundToStep(v, step));
  }
  return { min: niceMin, max: niceMax, ticks };
}

/** Najbliższy krok z progresji 1-2-5 (0.1, 0.2, 0.5, 1, 2, 5, 10, ...). */
export function niceStep(rough: number): number {
  const safe = Math.abs(rough) > 0 && Number.isFinite(rough) ? Math.abs(rough) : 1;
  const power = Math.floor(Math.log10(safe));
  const base = Math.pow(10, power);
  const fraction = safe / base;
  const mult = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return mult * base;
}

function roundToStep(value: number, step: number): number {
  const decimals = Math.max(0, -Math.floor(Math.log10(step)) + 1);
  return Number(value.toFixed(Math.min(10, decimals + 1)));
}

/** Mapowanie wartości domeny na piksele (odwracalne dla osi Y w SVG). */
export function linearScale(
  domainMin: number,
  domainMax: number,
  rangeMin: number,
  rangeMax: number,
): (v: number) => number {
  const d = domainMax - domainMin || 1;
  return (v: number) => rangeMin + ((v - domainMin) / d) * (rangeMax - rangeMin);
}

export interface SeriesExtent {
  min: number;
  max: number;
}

/**
 * Zakres wartości serii. Dla `stacked` liczy sumy dodatnie/ujemne per
 * kategoria (kolumny skumulowane sięgają sumy, nie maksimum pojedynczej
 * serii). `includeZero` wymusza 0 w domenie (słupki, pola).
 */
export function seriesExtent(
  series: readonly ChartSeries[],
  categoriesCount: number,
  opts: { stacked: boolean; includeZero: boolean },
): SeriesExtent {
  let min = Infinity;
  let max = -Infinity;
  if (opts.stacked) {
    for (let i = 0; i < categoriesCount; i++) {
      let pos = 0;
      let neg = 0;
      for (const s of series) {
        const v = s.values[i];
        if (v === null || v === undefined || !Number.isFinite(v)) continue;
        if (v >= 0) pos += v;
        else neg += v;
      }
      if (pos > max) max = pos;
      if (neg < min) min = neg;
      if (pos < min) min = Math.min(min, 0);
    }
    if (max === -Infinity) max = 0;
    if (min === Infinity) min = 0;
  } else {
    for (const s of series) {
      for (let i = 0; i < categoriesCount; i++) {
        const v = s.values[i];
        if (v === null || v === undefined || !Number.isFinite(v)) continue;
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    if (min === Infinity) {
      min = 0;
      max = 1;
    }
  }
  if (opts.includeZero) {
    min = Math.min(min, 0);
    max = Math.max(max, 0);
  }
  return { min, max };
}

export interface StackedCell {
  /** Początek segmentu (wartość skumulowana przed tą serią). */
  from: number;
  /** Koniec segmentu. */
  to: number;
  value: number | null;
}

/**
 * Kumulacja serii per kategoria (dodatnie w górę, ujemne w dół - jak w
 * każdym poważnym silniku wykresów). Zwraca macierz [seria][kategoria].
 */
export function stackSeries(
  series: readonly ChartSeries[],
  categoriesCount: number,
): StackedCell[][] {
  const posCursor = new Array<number>(categoriesCount).fill(0);
  const negCursor = new Array<number>(categoriesCount).fill(0);
  return series.map((s) =>
    Array.from({ length: categoriesCount }, (_, i) => {
      const raw = s.values[i];
      const v = raw === null || raw === undefined || !Number.isFinite(raw) ? null : raw;
      if (v === null || v === 0) {
        const base = v === 0 ? posCursor[i] : 0;
        return { from: base, to: base, value: v };
      }
      if (v > 0) {
        const from = posCursor[i];
        posCursor[i] += v;
        return { from, to: posCursor[i], value: v };
      }
      const from = negCursor[i];
      negCursor[i] += v;
      return { from, to: negCursor[i], value: v };
    }),
  );
}
