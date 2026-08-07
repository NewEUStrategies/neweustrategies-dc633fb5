// STOPIEŃ sieci kontaktów - czysty moduł (bez Reacta, bez klienta Supabase).
//
// Baza liczyła drugi stopień od 20260717170000 (CTE `mutual`), ale zwracała
// wyłącznie `mutual_count`, więc interfejs musiał sam zinterpretować, co ta
// liczba znaczy dla odległości w sieci - i nie interpretował. Od 20260807143000
// `connection_statuses` i `connection_suggestions` zwracają jawną kolumnę
// `degree`; tutaj mieszka jej normalizacja i klucze etykiet, żeby odznaka
// wyglądała identycznie w katalogu, na karcie sugestii i w nagłówku profilu.
//
// Definicja (jedna, po stronie bazy):
//   1 - połączeni bezpośrednio,
//   2 - co najmniej jeden wspólny kontakt,
//   3 - brak ścieżki w zasięgu dwóch skoków ("3+").

export type NetworkDegree = 1 | 2 | 3;

/**
 * Normalizacja wartości z bazy. Wszystko poza 1 i 2 to "3+" - fail-safe:
 * nieznany stopień nie ma prawa wyglądać jak bliska relacja.
 */
export function toNetworkDegree(value: number | null | undefined): NetworkDegree {
  return value === 1 ? 1 : value === 2 ? 2 : 3;
}

/** Klucz i18n krótkiej etykiety odznaki (np. "2."). */
export function networkDegreeShortKey(degree: NetworkDegree): string {
  return `network.degree.short.${degree}`;
}

/** Klucz i18n pełnego opisu dla technologii asystujących. */
export function networkDegreeLabelKey(degree: NetworkDegree): string {
  return `network.degree.label.${degree}`;
}
