// Lista stref czasowych dla droplist panelu wydarzeń.
//
// PO CO OSOBNY MODUŁ. Tę samą listę potrzebuje kreator wydarzenia (strefa jest
// tam polem, bo `admin_event_create` ją zapisuje) i „Informacje ogólne" (strefa
// jest tam polem edycji). Dwie kopie rozjeżdżają się w jedną stronę, której nie
// widać: redaktor zakłada wydarzenie w strefie, której panel edycji już nie
// oferuje, więc pierwszy zapis ustawień po cichu ją zmienia.
//
// ŹRÓDŁEM JEST `Intl.supportedValuesOf`, a nie stała: pełna lista IANA jest
// zawsze aktualniejsza niż cokolwiek wpisane w kod. Zbiór własny NIE jest
// jednak wyłącznie awaryjny - jest DOKLEJANY, i to jest naprawa, nie ozdoba.
//
// DLACZEGO. `Intl.supportedValuesOf("timeZone")` NIE ZAWIERA `UTC` (ani żadnego
// `Etc/*`, ani `GMT*`) i nie zna `Europe/Kyiv` - zna wyłącznie przestarzałe
// `Europe/Kiev`. Zmierzone w tym repozytorium: Node 22, ICU 78.2, 418 stref.
// Dopóki katalog ZASTĘPOWAŁ zbiór własny, redaktor na każdej nowoczesnej
// przeglądarce NIE MÓGŁ wybrać UTC, a Kijów widział wyłącznie pod starą nazwą -
// mimo że obie strefy stały jawnie w `FALLBACK_TIME_ZONES` jako te, „w których
// organizacja faktycznie pracuje".
//
// ODSIEW IDZIE PO NAZWIE KANONICZNEJ, nie po napisie: `Europe/Kyiv`
// i `Europe/Kiev` to ta sama strefa, więc lista pokazywałaby ją dwa razy.
// Wygrywa nazwa nasza, bo stoi pierwsza - i bo jest tą, której dziś się używa.

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
 * Nazwa kanoniczna strefy - `Europe/Kyiv` i `Europe/Kiev` dają ten sam wynik.
 *
 * Identyfikator, którego środowisko nie zna, RZUCA `RangeError` - i to jest tu
 * użyteczne: taki wpis wypada z listy zamiast wywrócić render droplisty.
 */
function canonicalZone(zone: string): string | null {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: zone }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

export function timeZoneOptions(current: string): readonly string[] {
  let catalogue: readonly string[] = [];
  try {
    const supported = (Intl as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
    if (typeof supported === "function") catalogue = supported("timeZone");
  } catch {
    // Starsza przeglądarka - zostaje sam zbiór własny, nadal użyteczny.
  }

  // `current` na początek, gdy lista go nie zna: inaczej pole edycji wyglądałoby
  // na puste dla wartości JUŻ ZAPISANEJ w bazie. Strażnik sprawdza `trim()`,
  // bo napis z samych spacji to nie jest strefa - dokleiłby pozycję droplisty
  // z niewidoczną etykietą.
  const saved = typeof current === "string" && current.trim() !== "" ? [current.trim()] : [];

  const seen = new Set<string>();
  const out: string[] = [];
  for (const zone of [...saved, ...FALLBACK_TIME_ZONES, ...catalogue]) {
    const canonical = canonicalZone(zone);
    if (canonical === null || seen.has(canonical)) continue;
    seen.add(canonical);
    out.push(zone);
  }
  return out;
}
