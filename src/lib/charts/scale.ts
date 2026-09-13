// Czysta matematyka skal wykresów: domeny, "ładne" podziałki (1-2-5),
// skala liniowa i kumulacja serii (stacked). Zero zależności, 100% testowalne.

import type { ChartSeries } from "./types";

export interface NiceScale {
  min: number;
  max: number;
  ticks: number[];
}

/**
 * Twardy sufit liczby podziałek. Bezpiecznik pętli, nie decyzja estetyczna -
 * realny `targetTicks` liczy `valueTickTarget` i mieści się w 3..~20, więc
 * ten limit nie dotyka żadnej osi rysowanej z danych.
 */
const MAX_TICKS = 1000;

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
    // Samo rozsunięcie o 20% wypycha krawędź poza zakres double, gdy płaska
    // seria stoi na liczbie rzędu 1e308 - i od tego miejsca cała reszta
    // liczyłaby już na Infinity.
    if (!Number.isFinite(min)) min = -Number.MAX_VALUE;
    if (!Number.isFinite(max)) max = Number.MAX_VALUE;
  }

  const divisor = Math.max(2, targetTicks);
  const span = max - min;
  // `max - min` PRZEPEŁNIA SIĘ do Infinity, gdy domena obejmuje większość
  // zakresu double (np. -MAX_VALUE..MAX_VALUE), a `niceStep(Infinity)` cofa
  // wtedy krok do 1 - czyli do dokładania podziałek po jednej przez 1e308.
  // Dzielenie PRZED odjęciem trzyma iloraz w zakresie, więc krok wychodzi
  // z PRAWDZIWEJ rozpiętości. Dla rozpiętości skończonej wynik jest ten sam,
  // więc żadna istniejąca oś nie zmienia podziałek.
  const step = niceStep(Number.isFinite(span) ? span / divisor : max / divisor - min / divisor);

  let niceMin = Math.floor(min / step) * step;
  let niceMax = Math.ceil(max / step) * step;
  // Zaokrąglenie NA ZEWNĄTRZ potrafi wypchnąć krawędź poza zakres double.
  // Przy `niceMax === Infinity` warunek pętli nigdy nie gaśnie, bo `v` też
  // dobija do Infinity i tam zostaje.
  if (!Number.isFinite(niceMin)) niceMin = min;
  if (!Number.isFinite(niceMax)) niceMax = max;

  const ticks: number[] = [];
  // Epsilon guards float drift (0.1+0.2 style) so the last tick always lands.
  // Przy `niceMax` rzędu MAX_VALUE sam epsilon przepełnia sumę do Infinity,
  // a wtedy warunek przepuszcza podziałkę o wartości Infinity - oś z nieliczbą
  // na końcu rysuje się jako pusta. Bez epsilonu granica jest po prostu ostra.
  const limit = niceMax + step * 1e-6;
  const safeLimit = Number.isFinite(limit) ? limit : niceMax;
  for (let v = niceMin; v <= safeLimit; ) {
    ticks.push(roundToStep(v, step));
    const next = v + step;
    // Sama arytmetyka NIE GWARANTUJE postępu: przy |v| rzędu 1e308 krok
    // mniejszy od ULP-a znika w zaokrągleniu i `v + step === v`. Pętla
    // akumulacyjna nie miała wtedy żadnego warunku stopu i rosła aż do
    // RangeError na długości tablicy - zmierzone 13,8 s dla
    // niceScale(0, MAX_VALUE) i 45,4 s dla niceScale(-MAX_VALUE, MAX_VALUE),
    // za każdym razem na wątku renderującym, również w SSR.
    // MAX_TICKS domyka drugi przypadek: absurdalnie wysoki `targetTicks`.
    if (!(next > v) || ticks.length >= MAX_TICKS) break;
    v = next;
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
  const step = mult * base;
  // Na obu krańcach zakresu double zaokrąglenie w górę wypada POZA liczby:
  //  * `mult * base` przepełnia się do Infinity, gdy base === 1e308,
  //  * `Math.pow(10, -324)` daje 0, bo 10^-324 nie ma reprezentacji.
  // Krok zerowy albo nieskończony zamienia `min / step` w NaN i oś przestaje
  // być liczbą, więc cofamy się do najbliższego kroku, który jeszcze nią jest:
  // do samej potęgi dziesiątki, a gdy i ta wypadła z zakresu - do rozpiętości.
  if (step > 0 && Number.isFinite(step)) return step;
  return base > 0 && Number.isFinite(base) ? base : safe;
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

/**
 * Rozszerzenie zakresu o PASMO NIEPEWNOŚCI prognozy.
 *
 * Pasmo jest rysowane wokół wartości prognozowanych, więc jego krawędzie są
 * pikselami tak samo jak sama linia - a skala policzona bez nich pozwala
 * pasmu wyjść ponad najwyższą podziałkę i zostać przyciętym krawędzią
 * rysunku. Przycięte pasmo niepewności jest gorsze od braku pasma: sugeruje,
 * że niepewność KOŃCZY SIĘ tam, gdzie kończy się obszar kreślenia.
 *
 * Punkt granicy (`splitAt - 1`) jest pomijany, bo tam pasmo ma szerokość zero
 * (ostatnia obserwacja jest pomiarem, nie prognozą), więc już mieści się
 * w zakresie samych danych.
 *
 * Zwraca `null`, gdy nie ma czego rozszerzać - żeby wywołujący nie musiał
 * odróżniać "brak prognozy" od "zakres [Infinity, -Infinity]".
 */
export function forecastBandExtent(
  series: readonly ChartSeries[],
  splitAt: number | null,
  bandPct: number,
): SeriesExtent | null {
  if (splitAt === null || !(bandPct > 0)) return null;
  const factor = bandPct / 100;
  let min = Infinity;
  let max = -Infinity;
  for (const s of series) {
    for (let i = Math.max(0, splitAt); i < s.values.length; i++) {
      const v = s.values[i];
      if (v === null || v === undefined || !Number.isFinite(v)) continue;
      const spread = Math.abs(v) * factor;
      if (v - spread < min) min = v - spread;
      if (v + spread > max) max = v + spread;
    }
  }
  if (min === Infinity) return null;
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
