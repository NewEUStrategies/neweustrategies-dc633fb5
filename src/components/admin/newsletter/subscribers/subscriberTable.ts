// Reguły tabeli subskrybentów: filtrowanie i eksport CSV - warstwa CZYSTA.
//
// PO CO OSOBNY MODUŁ. Obie reguły odpowiadają na pytania, których nie da się
// sprawdzić „na oko" w panelu:
//   * FILTR decyduje, kogo operator widzi - a od tego zależy, komu potem
//     ręcznie zmienia zgodę. Filtr, który po cichu gubi wiersz, prowadzi do
//     decyzji podjętej na niepełnej liście.
//   * EKSPORT wynosi DANE OSOBOWE z systemu do pliku. Błąd w cytowaniu psuje
//     plik po stronie odbiorcy: adres z przecinkiem albo nazwa z cudzysłowem
//     rozjeżdża kolumny i przypisuje komuś cudzą zgodę.
// Wyprowadzenie jest bezstratne - ciała przeniesione z `SubscribersPanel` bez
// zmiany zachowania.

/** Wiersz tabeli - dokładnie te kolumny, które panel czyta z bazy. */
export interface SubscriberRow {
  id: string;
  email: string;
  display_name: string | null;
  language: string;
  status: string;
  source: string | null;
  created_at: string;
  confirmed_at: string | null;
}

export type StatusFilter = "all" | "subscribed" | "pending" | "unsubscribed";
export type LanguageFilter = "all" | "pl" | "en";

export interface SubscriberFilters {
  q: string;
  status: StatusFilter;
  lang: LanguageFilter;
}

/**
 * Zawęża listę do wierszy pasujących do wszystkich trzech filtrów.
 *
 * Szukanie obejmuje adres ORAZ nazwę wyświetlaną - operator wpisuje jedno albo
 * drugie i oczekuje trafienia w obu przypadkach.
 */
export function filterSubscribers(
  rows: readonly SubscriberRow[],
  filters: SubscriberFilters,
): SubscriberRow[] {
  const term = filters.q.trim().toLowerCase();
  return rows.filter((s) => {
    if (filters.status !== "all" && s.status !== filters.status) return false;
    if (filters.lang !== "all" && s.language !== filters.lang) return false;
    if (
      term &&
      !s.email.toLowerCase().includes(term) &&
      !(s.display_name ?? "").toLowerCase().includes(term)
    ) {
      return false;
    }
    return true;
  });
}

/**
 * Ile najnowszych wierszy panel ściąga na klienta. Powyżej tej liczby lista
 * i eksport MOGĄ być niepełne, więc panel ostrzega, zamiast ucinać po cichu
 * (pełne stronicowanie po stronie serwera to osobna praca).
 */
export const SUBSCRIBER_FETCH_CAP = 5000;

/** Czy odczyt dobił do limitu - czyli czy ostrzeżenie ma się pokazać. */
export function isFetchCapped(rowCount: number): boolean {
  return rowCount >= SUBSCRIBER_FETCH_CAP;
}

/** Kolumny eksportu, w kolejności zapisu do pliku. */
export const CSV_COLUMNS = [
  "email",
  "display_name",
  "language",
  "status",
  "source",
  "created_at",
  "confirmed_at",
] as const;

/**
 * Jedna komórka CSV. Cytujemy tylko wtedy, gdy trzeba (cudzysłów, przecinek,
 * nowa linia), a cudzysłów w treści podwajamy - RFC 4180.
 */
export function csvCell(value: string | null | undefined): string {
  const v = String(value ?? "");
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Cała tabela jako tekst CSV z wierszem nagłówka. */
export function subscribersToCsv(rows: readonly SubscriberRow[]): string {
  const asRecord = (row: SubscriberRow) => row as unknown as Record<string, string | null>;
  return [CSV_COLUMNS.join(",")]
    .concat(rows.map((row) => CSV_COLUMNS.map((key) => csvCell(asRecord(row)[key])).join(",")))
    .join("\n");
}

/** Nazwa pliku eksportu dla podanego dnia (ISO). */
export function csvFileName(nowIso: string): string {
  return `newsletter-${nowIso.slice(0, 10)}.csv`;
}
