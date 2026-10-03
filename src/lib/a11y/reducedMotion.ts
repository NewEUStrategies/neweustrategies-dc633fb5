// Systemowe „ogranicz ruch" (`prefers-reduced-motion`) - JEDNO miejsce odczytu.
//
// Czytane W CHWILI zdarzenia (klik, zmiana strony, start animacji), a nie
// w renderze: `matchMedia` nie istnieje na serwerze, więc odczyt w renderze
// dałby inny pierwszy rysunek klienta niż serwera. Środowisko bez
// `matchMedia` (SSR, starsze WebView, część testów) traktujemy jak brak
// preferencji - ruch zostaje, bo to zachowanie sprzed wprowadzenia bramki.

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  try {
    return window.matchMedia(REDUCED_MOTION_QUERY).matches === true;
  } catch {
    return false;
  }
}

/**
 * `behavior` dla `scrollTo` / `scrollIntoView`: płynnie, chyba że użytkownik
 * prosi o ograniczenie ruchu - wtedy skok natychmiastowy.
 */
export function preferredScrollBehavior(): ScrollBehavior {
  return prefersReducedMotion() ? "auto" : "smooth";
}
