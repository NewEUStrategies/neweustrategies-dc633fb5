// ZAKRESY CZASÓW ANIMACJI BLOKÓW - jedno źródło dla widoku i edytora.
//
// Edytor bloku pilnuje pola, ale dane z importu, API albo starego zapisu
// omijają edytor i trafiają prosto do widoku publicznego. Widok domykał je
// tylko od DOŁU, więc:
//  * `stats-counter.duration: 1e9` - licznik stał przy 0 na zawsze,
//  * `image-carousel.interval` ponad 2^31-1 ms - przeglądarka odpala
//    `setInterval` z takim opóźnieniem NATYCHMIAST (przepełnienie 32-bitowe),
//    czyli karuzela przeskakiwała w pętli co klatkę,
//  * `NaN`/`Infinity` (`Math.max(…, NaN)` to `NaN`) - autoplay bez rytmu.
//
// Widok (`StatsCounterView`, `ImageCarouselView`) i edytor
// (`StatsCounterBlock`, `ImageCarouselBlock`) czytają TE SAME stałe, więc pole
// panelu pokazuje dokładnie ten czas, którym animuje strona.

/** Zakres czasu w ms: wartość spoza niego jest docinana, nie-liczba to `fallback`. */
export interface AnimationRange {
  readonly min: number;
  readonly max: number;
  readonly fallback: number;
}

/** Czas wejścia licznika statystyk (`stats-counter.duration`), ms. */
export const STATS_COUNTER_DURATION_RANGE: AnimationRange = {
  min: 100,
  max: 5000,
  fallback: 1500,
};

/** Odstęp autoodtwarzania karuzeli obrazów (`image-carousel.interval`), ms. */
export const CAROUSEL_INTERVAL_RANGE: AnimationRange = {
  min: 1500,
  max: 20000,
  fallback: 5000,
};

/**
 * Czas animacji w zakresie. Tylko skończona liczba jest wartością - napis,
 * `null`, `NaN` i `±Infinity` to `fallback` zakresu (czytnik renderera `num`
 * zamienia wcześniej napis liczbowy na liczbę, więc tu dochodzą same śmieci).
 */
export function clampAnimationMs(value: unknown, range: AnimationRange): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return range.fallback;
  return Math.min(range.max, Math.max(range.min, value));
}
