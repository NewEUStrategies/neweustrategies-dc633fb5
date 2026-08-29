// Czysty model widgetu "travel-route-card" (karta trasy).
// Poza komponentami, żeby renderer, molekuła UI i testy miały jedno źródło
// prawdy i żeby formatowanie licznika dało się sprawdzić bez DOM.

/** Wartości domyślne prezentacji - te same liczby siedzą w `WIDGET_SCHEMAS`. */
export const TRAVEL_ROUTE_CARD_DEFAULTS = {
  /** Tyle, ile miała nakładka wzorca (`/60`). */
  overlayAlpha: 0.6,
  minHeight: 224,
  /** Platformowe 6 px, nie 16 px ze wzorca - patrz komentarz molekuły. */
  radius: 6,
  maxWidth: 448,
  distanceSizePx: 96,
} as const;

/** Czerwień „pigułki" po polubieniu, gdy panel nie narzucił własnego koloru. */
export const TRAVEL_ROUTE_LIKE_COLOR = "#ef4444";

/** Jedna cyfra po przecinku, bez zbędnego zera - dokładnie jak wzorzec. */
const short = (n: number, unit: number, suffix: string): string =>
  `${(n / unit).toFixed(1).replace(/\.0$/, "")}${suffix}`;

/**
 * Najmniejsza liczba, która po zaokrągleniu do jednego miejsca daje „1000.0K".
 * Poniżej tego progu skrót w tysiącach jest jeszcze uczciwy.
 */
const K_ROUNDS_TO_MILLION = 999_950;

/**
 * Skrót dużych liczb: 1527 -> „1.5K", 2 000 000 -> „2M".
 *
 * Dwa świadome odstępstwa od wklejonego wzorca:
 *   * wzorzec liczył `(n / 1000).toFixed(1)` bez sprawdzenia wyniku, więc
 *     999 999 wyświetlał jako „1000K" - a milion jako „1M". Skrót, który
 *     przeskakuje z „1000K" na „1M", czyta się jak defekt licznika, więc
 *     zaokrąglenie do tysiąca tysięcy awansuje do miliona,
 *   * wartości ujemne, ułamkowe i nieskończone sprowadzamy do liczby całkowitej
 *     nieujemnej - panel pozwala wpisać liczbę startową ręcznie, a licznik
 *     nigdy nie ma prawa wyświetlić „NaN" ani „-1".
 */
export function formatLikes(num: number): string {
  if (!Number.isFinite(num) || num <= 0) return "0";
  const n = Math.floor(num);
  if (n >= 1_000_000) return short(n, 1_000_000, "M");
  if (n >= K_ROUNDS_TO_MILLION) return "1M";
  if (n >= 1_000) return short(n, 1_000, "K");
  return String(n);
}

/**
 * Klucz pamięci polubienia: jedna karta = jeden wpis w `localStorage`
 * przeglądarki odwiedzającego. Bierzemy id węzła, bo jest stabilne między
 * publikacjami, a dwie karty na jednej stronie muszą mieć osobne polubienia.
 */
export function travelRouteLikeKey(nodeId: string): string {
  return `nes:travel-route-like:${nodeId}`;
}
