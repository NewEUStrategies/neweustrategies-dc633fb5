// Lista stref czasowych dla droplist panelu wydarzeń.
//
// PO CO OSOBNY MODUŁ. Tę samą listę potrzebuje kreator wydarzenia (strefa jest
// tam polem, bo `admin_event_create` ją zapisuje) i „Informacje ogólne" (strefa
// jest tam polem edycji). Dwie kopie rozjeżdżają się w jedną stronę, której nie
// widać: redaktor zakłada wydarzenie w strefie, której panel edycji już nie
// oferuje, więc pierwszy zapis ustawień po cichu ją zmienia.
//
// ŹRÓDŁEM JEST `Intl.supportedValuesOf`, a nie stała: pełna lista IANA jest
// zawsze aktualniejsza niż cokolwiek wpisane w kod. Skrócony zbiór stoi tylko
// jako awaryjny dla przeglądarek bez tego API - i zawiera strefy, w których
// organizacja faktycznie pracuje.

/** Strefy oferowane wprost; `Intl` dorzuca resztę, gdy przeglądarka ją zna. */
export const FALLBACK_TIME_ZONES = [
  "Europe/Warsaw",
  "Europe/Brussels",
  "Europe/Berlin",
  "Europe/London",
  "Europe/Kyiv",
  "Europe/Vilnius",
  "Europe/Prague",
  "UTC",
] as const;

/** Domyślna strefa organizacji - ta sama, którą ma `events.timezone` w bazie. */
export const DEFAULT_EVENT_TIME_ZONE = "Europe/Warsaw";

/**
 * Zbiór opcji droplisty. `current` jest doklejany na początek, gdy lista go nie
 * zna - inaczej pole edycji wyglądałoby na puste dla wartości już zapisanej.
 */
export function timeZoneOptions(current: string): readonly string[] {
  let zones: readonly string[] = FALLBACK_TIME_ZONES;
  try {
    const supported = (Intl as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
    if (typeof supported === "function") zones = supported("timeZone");
  } catch {
    // Starsza przeglądarka - lista skrócona jest nadal użyteczna.
  }
  return current !== "" && !zones.includes(current) ? [current, ...zones] : zones;
}
