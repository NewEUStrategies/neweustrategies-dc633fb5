// Wspólne reguły filtrów i stronicowania logów modułu newslettera.
//
// PO CO WSPÓLNY MODUŁ. Log maili systemowych i log webhooka maili
// autoryzacyjnych mają ten sam układ filtrów - celowo, żeby operator przechodził
// między ekranami bez zmiany nawyków. Skopiowane reguły rozjeżdżają się cicho:
// jeden panel poprawiony, drugi nie, a różnicy nie widać na oczy.
//
// Trzy rzeczy, których te funkcje pilnują:
//   1. SENTYNELA „wszystkie". Radix wywala się na `SelectItem value=""`, więc
//      opcja „bez filtra" musi mieć NIEPUSTĄ wartość - a przy zapytaniu MUSI
//      wrócić na `null`. Puszczona dalej jako wartość filtra zwraca zero
//      wierszy: operator widzi „brak wysyłek" tam, gdzie wysyłek są tysiące.
//   2. LICZBA STRON. Pusty log ma JEDNĄ stronę, nie zero - inaczej przycisk
//      „następna" jest aktywny w pustym widoku i prowadzi w nicość.
//   3. BRAK DATY. Kreska, nie „Invalid Date" - wiersz bez znacznika czasu i tak
//      niesie informację o wysyłce.

/**
 * Sentynela „wszystkie" w listach filtrów.
 *
 * Musi być niepusta (Radix) i nie może dać się pomylić z prawdziwą wartością
 * filtra - nazwy szablonów i typów przychodzą z bazy.
 */
export const ALL_OPTION = "all";

/** Domyślny rozmiar strony logu. */
export const DEFAULT_PAGE_SIZE = 50;

/** Wartość z listy filtra -> wartość do zapytania (`null` = bez filtra). */
export function filterValue(raw: string): string | null {
  return raw === ALL_OPTION ? null : raw;
}

/** Wartość filtra -> wartość dla listy (`null` -> sentynela „wszystkie"). */
export function filterOption(value: string | null): string {
  return value ?? ALL_OPTION;
}

/** Fraza wyszukiwania: puste i same spacje znaczą „bez filtra". */
export function searchValue(raw: string): string | null {
  return raw.trim() ? raw.trim() : null;
}

/** Liczba stron. Pusty log ma JEDNĄ stronę - zero zapaliłoby „następna". */
export function totalPages(rowsTotal: number, pageSize: number = DEFAULT_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(rowsTotal / pageSize));
}

/** Znacznik czasu wiersza; brak daty to KRESKA, nie „Invalid Date". */
export function rowTimestamp(
  createdAt: string | null | undefined,
  locale: string,
  options: Intl.DateTimeFormatOptions = { dateStyle: "short", timeStyle: "short" },
): string {
  if (!createdAt) return "-";
  return new Date(createdAt).toLocaleString(locale, options);
}
