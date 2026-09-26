// Odczyt jsonb planu sali - wspolne, defensywne czytniki pol.
//
// PO CO OSOBNY MODUL. Dwie funkcje panelu (`admin_event_seat_map_detail`,
// `admin_event_seat_section_save`) i dwie uczestnika (`event_my_seats`,
// `event_ticket_seats`) oddaja `jsonb`, ktory wygenerowane typy opisuja jako
// `Json` - czyli jako "cokolwiek". Kazdy parser musi wiec sprawdzic ksztalt
// pole po polu. Te same cztery czytniki powielone w dwoch modulach rozjechalyby
// sie przy pierwszej poprawce (np. przy liczbach, ktore PostgREST oddaje dla
// `numeric(8,2)` jako JSON number).
//
// MODUL JEST LEKKI (zero importow), bo korzysta z niego takze publiczna
// strona biletu - nie moze wciagac warstwy panelu.

export type JsonBag = Record<string, unknown>;

/** Obiekt JSON albo `null` (tablica, napis, liczba i `null` to nie obiekt). */
export function bag(value: unknown): JsonBag | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonBag)
    : null;
}

/** Tablica z JSON-a albo pusta tablica. */
export function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Niepusty napis albo `null` (pusty napis w bazie znaczy "brak"). */
export function text(source: JsonBag, key: string): string | null {
  const value = source[key];
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/** Skonczona liczba albo `null`. */
export function num(source: JsonBag, key: string): number | null {
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Wartosc logiczna albo wartosc domyslna. */
export function flag(source: JsonBag, key: string, fallback: boolean): boolean {
  const value = source[key];
  return typeof value === "boolean" ? value : fallback;
}
