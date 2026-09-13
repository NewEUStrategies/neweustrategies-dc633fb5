// Czysta matematyka skal wykresów: domeny, "ładne" podziałki (1-2-5),
// skala liniowa i kumulacja serii (stacked). Zero zależności, 100% testowalne.

import type { ChartSeries } from "./types";

export interface NiceScale {
  min: number;
  max: number;
  ticks: number[];
}

/**
 * TWARDY SUFIT LICZBY PODZIAŁEK.
 *
 * Oś wykresu nie potrzebuje więcej niż kilkunastu podziałek (`valueTickTarget`
 * z `./geometry` zamawia najwyżej 9, `SMALL_MULTIPLES_TARGET_TICKS` - trzy),
 * a bez sufitu pętla podziałek była JEDYNYM miejscem w silniku, którego czas
 * wykonania zależał od DANYCH, a nie od geometrii. Sufit stoi tu po to, żeby
 * wyjście z pętli NIE ZALEŻAŁO od arytmetyki zmiennoprzecinkowej.
 */
const MAX_TICKS = 1000;

/**
 * Czy podziałki rosną ŚCIŚLE. Dwie sąsiednie podziałki równe jako `double`
 * znaczą, że krok wypadł poniżej rozdzielczości przy tej magnitudzie - oś
 * pokazywałaby wtedy tę samą liczbę kilka razy i kłamałaby rozstawem.
 */
function scisleRosnie(ticks: readonly number[]): boolean {
  for (let i = 1; i < ticks.length; i++) {
    if (!(ticks[i] > ticks[i - 1])) return false;
  }
  return true;
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

  // `targetTicks` przychodzi od wywołującego i NIE jest pilnowany przez typ:
  // nieliczba dawała krok NaN, a wielka liczba - krok mikroskopijny.
  const cel = Number.isFinite(targetTicks)
    ? Math.min(MAX_TICKS, Math.max(2, Math.floor(targetTicks)))
    : 5;

  // Dwa podejścia. Drugie wchodzi tylko wtedy, gdy pierwsze dało domenę,
  // której NIE DA SIĘ pokryć podziałkami (patrz `zdegenerowana`).
  for (let podejscie = 0; podejscie < 2; podejscie++) {
    // Rozstęp DWÓCH skończonych liczb sam bywa nieskończony (np. -1e308
    // do 1e308). Wtedy liczymy krok z połówek - matematycznie to ten sam
    // iloraz, tylko bez przepełnienia. Dla rozstępu skończonego bierzemy
    // gałąź pierwszą, więc wynik jest identyczny CO DO BITU z poprzednią
    // wersją i skale istniejących wykresów się nie ruszają.
    const rozstep = max - min;
    const zgrubny = Number.isFinite(rozstep)
      ? rozstep / cel
      : max / 2 / (cel / 2) - min / 2 / (cel / 2);
    let step = niceStep(zgrubny);
    if (!(step > 0) || !Number.isFinite(step)) step = 1;

    // Pracujemy INDEKSAMI SIATKI, a nie wartościami: `i0`/`i1` to numery
    // podziałek, a nie liczby z domeny. Dzięki temu ani mnożenie, ani
    // różnica poniżej nie przepełniają się przy krańcach rzędu 1e308.
    let i0 = Math.floor(min / step);
    let i1 = Math.ceil(max / step);
    let niceMin = i0 * step;
    let niceMax = i1 * step;
    // Dociągnięcie do ładnej krawędzi potrafi WYJŚĆ POZA zakres liczb
    // (np. `Math.ceil(MAX_VALUE / 5e307) * 5e307`). Wtedy zawracamy do
    // krawędzi o jeden krok bliżej zera: lepiej przyciąć skrajny punkt
    // o ułamek kroku niż oddać oś sięgającą nieskończoności.
    if (!Number.isFinite(niceMin)) {
      i0 = Math.ceil(min / step);
      niceMin = i0 * step;
    }
    if (!Number.isFinite(niceMax)) {
      i1 = Math.floor(max / step);
      niceMax = i1 * step;
    }

    // KOLIZJA SIATKI. Gdy sąsiednie podziałki są tą samą liczbą double,
    // krok jest poniżej rozdzielczości przy tej magnitudzie - i DOKŁADNIE
    // to zawieszało pętlę akumulującą (`v += step` nie przesuwało `v`).
    //
    // Bramka sprawdza CAŁĄ siatkę, a nie dwie skrajne pary. Para skrajna
    // potrafi się różnić, gdy pary ŚRODKOWE już się zlewają - wtedy oś
    // wracała ze zdublowanymi podziałkami (np. `niceScale(1, 1 + 1 ULP, 3)`
    // dawało pięć podziałek o trzech różnych wartościach). Liczymy dokładnie
    // te iloczyny, które trafią do tablicy, więc bramka nie może rozminąć się
    // z wynikiem.
    const rozpietosc = i1 - i0;
    const ile = Number.isFinite(rozpietosc)
      ? Math.min(MAX_TICKS, Math.max(1, Math.round(rozpietosc)))
      : 1;
    const ticks: number[] = [];
    for (let i = 0; i <= ile; i++) ticks.push(roundToStep((i0 + i) * step, step));

    const zdegenerowana =
      min === max ||
      !(niceMax > niceMin) ||
      !Number.isFinite(niceMin) ||
      !Number.isFinite(niceMax) ||
      !scisleRosnie(ticks);

    if (zdegenerowana) {
      if (podejscie === 0) {
        // Taka oś nie jest do uratowania krokiem - trzeba rozsunąć domenę,
        // dokładnie tak jak dla serii PŁASKIEJ (dwie wartości, których oś
        // nie umie rozróżnić, to z punktu widzenia rysunku jedna wartość).
        const rozsuniecie =
          Math.abs(min) * 0.2 > 0 && Number.isFinite(Math.abs(min) * 0.2) ? Math.abs(min) * 0.2 : 1;
        min -= rozsuniecie;
        max += rozsuniecie;
        if (!Number.isFinite(min) || !Number.isFinite(max)) {
          min = -1;
          max = 1;
        }
        continue;
      }
      // Siatka bezpieczeństwa: na żadnym zmierzonym wejściu (siatka wartości
      // skrajnych + 300 000 losowań) tu nie wchodzimy, ale funkcja MUSI mieć
      // wyjście niezależne od arytmetyki.
      return { min: -1, max: 1, ticks: [-1, -0.5, 0, 0.5, 1] };
    }

    // ITERACJA PO INDEKSIE, NIE PO AKUMULACJI (patrz wyżej): ostatnia
    // podziałka wypada z `i1 - i0`, a nie z tolerancji, więc epsilon
    // w warunku pętli przestaje być potrzebny.
    return { min: niceMin, max: niceMax, ticks };
  }

  // Nieosiągalne (pętla zwraca w obu podejściach), ale TypeScript tego nie wie.
  return { min: 0, max: 1, ticks: [0, 0.5, 1] };
}

/** Najbliższy krok z progresji 1-2-5 (0.1, 0.2, 0.5, 1, 2, 5, 10, ...). */
export function niceStep(rough: number): number {
  const safe = Math.abs(rough) > 0 && Number.isFinite(rough) ? Math.abs(rough) : 1;
  const power = Math.floor(Math.log10(safe));
  // `Number("1e" + power)`, a NIE `Math.pow(10, power)`. `Math.pow` jest
  // w ECMA-262 zależne od implementacji i potrafi różnić się o JEDEN ULP
  // między silnikami: `Math.pow(10, -17)` daje 9.999999999999999e-18 na
  // Node 22 i 1e-17 na Node 24. Ten jeden bit zmieniał krok, a przez to
  // rozstaw siatki - test przechodził lokalnie i padał na runnerze CI.
  // Konwersja literału dziesiętnego jest poprawnie zaokrąglana przez
  // specyfikację, więc wynik jest ten sam wszędzie.
  const base = Number(`1e${power}`);
  // Dla argumentu subnormalnego (np. 5e-324) `power` wychodzi -324, a
  // `Math.pow(10, -324)` PODPŁYWA DO ZERA: `fraction` robi się
  // nieskończonością, a krok - zerem. Zero kroku dawało `Math.floor(min / 0)`,
  // czyli NaN w obu krańcach domeny i cicho pusty wykres.
  if (!(base > 0) || !Number.isFinite(base)) return 1;
  const fraction = safe / base;
  const mult = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  const wynik = mult * base;
  // Przy `base` rzędu 1e308 samo domnożenie mnożnika WYCHODZI POZA zakres
  // liczb. Nieskończony krok jest gorszy od kroku o rząd za małego, bo
  // z nieskończonością nie da się policzyć ani jednej podziałki.
  return Number.isFinite(wynik) ? wynik : base;
}

/**
 * Zaokrąglenie podziałki do siatki kroku. Jest KOSMETYKĄ - ma zdjąć szum
 * zmiennoprzecinkowy (0,6000000000000001), a nie zmienić wartość podziałki.
 *
 * Sufit 10 miejsc po przecinku (poprzednia wersja) robił dokładnie to drugie:
 * przy kroku 1e-11 `toFixed(10)` sprowadzał WSZYSTKIE podziałki do zera, więc
 * oś twierdziła, że cała seria leży w zerze, a linie siatki lądowały jedna na
 * drugiej. `toFixed` przyjmuje najwyżej 100 miejsc (powyżej rzuca RangeError),
 * stąd nowy sufit - a strażnik poniżej domyka resztę: jeśli zaokrąglenie
 * przesunęłoby podziałkę o więcej niż pół kroku, zwracamy wartość surową.
 */
function roundToStep(value: number, step: number): number {
  if (!Number.isFinite(value) || !(step > 0) || !Number.isFinite(step)) return value;
  const decimals = Math.max(0, -Math.floor(Math.log10(step)) + 1);
  const zaokraglona = Number(value.toFixed(Math.min(100, decimals + 1)));
  return Math.abs(zaokraglona - value) <= step / 2 ? zaokraglona : value;
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
      // `neg` jest sumą składników niedodatnich, więc zawsze <= 0 i już przy
      // PIERWSZEJ kategorii sprowadza `min` poniżej zera - stos zawsze obejmuje
      // zero i nie trzeba tego dociągać osobnym warunkiem. (Poprzednia linia
      // `if (pos < min) ...` była martwa: `pos >= 0`, `min <= 0`.)
      if (neg < min) min = neg;
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
