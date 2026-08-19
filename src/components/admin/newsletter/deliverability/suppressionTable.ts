// Reguły listy wykluczeń - warstwa CZYSTA.
//
// Lista wykluczeń jest hamulcem bezpieczeństwa wysyłki: adres, który tu trafia,
// przestaje dostawać pocztę. Dwie reguły tego ekranu decydują o tym, czy
// operator podejmuje decyzję na pełnych danych:
//   * FILTR tekstowy działa lokalnie na pobranej paczce - jeśli zgubi wiersz,
//     operator uzna, że adresu nie ma na liście, i wyśle do niego kampanię,
//   * EKSPORT wynosi powody blokad poza system; diagnostyka dostawcy zawiera
//     przecinki („550, mailbox full"), więc bez cytowania plik rozjeżdża się
//     o kolumnę i przypisuje komuś cudzy powód blokady.
import { csvFileNameFor, toCsv } from "@/lib/csv/formatCsv";
import type { SuppressionRow } from "@/lib/newsletter-deliverability.functions";

/** Ile wpisów panel ściąga jednym zapytaniem. */
export const SUPPRESSION_LIST_LIMIT = 300;

/** Czy odczyt dobił do limitu - wtedy lista MOŻE być niepełna. */
export function isSuppressionListCapped(rowCount: number): boolean {
  return rowCount >= SUPPRESSION_LIST_LIMIT;
}

/** Zawężenie po fragmencie adresu; pusta fraza nie filtruje. */
export function filterSuppressions(
  rows: readonly SuppressionRow[],
  search: string,
): readonly SuppressionRow[] {
  const term = search.trim().toLowerCase();
  if (!term) return rows;
  return rows.filter((r) => r.email.toLowerCase().includes(term));
}

/** Kolumny eksportu listy wykluczeń, w kolejności zapisu. */
export const SUPPRESSION_CSV_COLUMNS = [
  "email",
  "reason",
  "scope",
  "source",
  "occurrences",
  "first_seen_at",
  "last_seen_at",
  "expires_at",
  "released_at",
  "diagnostic",
] as const;

export function suppressionsToCsv(rows: readonly SuppressionRow[]): string {
  return toCsv(
    SUPPRESSION_CSV_COLUMNS,
    rows.map((r) => [
      r.email,
      r.reason,
      r.scope,
      r.source,
      r.occurrences,
      r.firstSeenAt,
      r.lastSeenAt,
      r.expiresAt,
      r.releasedAt,
      r.diagnostic,
    ]),
  );
}

export function suppressionCsvFileName(nowIso: string): string {
  return csvFileNameFor("suppressions", nowIso);
}

/**
 * Czy wpisany adres da się dodać na listę.
 *
 * Warunek jest luźny z rozmysłu (obecność `@`): blokadę zakłada OPERATOR na
 * podstawie tego, co widzi w logu dostawcy, a tam bywają adresy, których nasz
 * walidator formularza by nie przyjął. Twarda walidacja i tak stoi po stronie
 * server fn - tu chodzi tylko o to, żeby puste pole nie wysyłało żądania.
 */
export function canAddSuppression(email: string): boolean {
  const value = email.trim();
  return value.length > 0 && value.includes("@");
}

/** Adres w formie, w jakiej trafia na listę (bez wielkości liter). */
export function normalizeSuppressionEmail(email: string): string {
  return email.trim().toLowerCase();
}
