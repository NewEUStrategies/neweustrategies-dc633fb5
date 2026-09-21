/**
 * Jedno źródło prawdy dla geometrii pasów nagłówka.
 *
 * DLACZEGO KLASY, A NIE LICZBY. Repozytorium skaluje `root font-size` płynnie
 * między 1280 a 1920 px (patrz „Fluid desktop scaling" w `styles.css`), więc
 * `h-10` to 37,5 px przy 1280 px i 40 px dopiero przy 16 px roota. Rezerwa
 * zapisana jako stała liczba pikseli rozjeżdża się z elementem, który tę samą
 * wysokość bierze z `rem` - i różnica wraca jako CLS. Skoro szkielet, rezerwa
 * paska „na czasie" i sam pasek mają mieć IDENTYCZNE pudełko, dzielą tę samą
 * klasę, a nie tę samą liczbę.
 *
 * Moduł jest celowo bez zależności (same stałe), żeby mógł go importować i
 * `HeaderSkeleton`, i `TrendingTicker`, bez wiązania tych dwóch ze sobą.
 */

/** Wysokość wewnętrznego pasa „na czasie" (`TrendingTicker`, wariant klasyczny). */
export const HEADER_TICKER_BAND_CLASS = "h-10";

/** Dolna krawędź paska „na czasie" - liczy się do jego wysokości w układzie. */
export const HEADER_TICKER_BORDER_CLASS = "border-b";

/**
 * Pudełko mobilnego paska nagłówka (`Header.tsx`, gałąź `lg:hidden`):
 * `px-4 py-3` + dolna krawędź. Wysokość bierze się z zawartości, więc pasuje
 * tylko razem z `HEADER_MOBILE_BAR_CONTENT_CLASS`.
 */
export const HEADER_MOBILE_BAR_BOX_CLASS = "px-4 py-3 border-b border-border bg-background";

/** Najwyższe dziecko mobilnego paska: przyciski `h-10` (lupa, motyw, menu). */
export const HEADER_MOBILE_BAR_CONTENT_CLASS = "h-10";
