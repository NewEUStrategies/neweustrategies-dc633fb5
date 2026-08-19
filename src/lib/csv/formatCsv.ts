// Zapis CSV - JEDNA reguła cytowania dla całego repo.
//
// PO CO. Repo ma wspólny PARSER (`parseCsv`), ale zapis był kopiowany: panel
// subskrybentów i lista wykluczeń miały własne, identyczne funkcje cytujące.
// Dwie kopie tej samej reguły to dwie okazje, żeby jedna z nich się rozjechała
// przy następnej zmianie - a konsekwencja jest cicha i poważna: wartość
// z przecinkiem (nazwa „Nowak, Anna", diagnostyka odbicia „550, mailbox full")
// rozjeżdża kolumny w pliku, który operator otwiera POZA systemem. Wiersz
// przesunięty o jedną kolumnę przypisuje komuś cudzą zgodę albo cudzy powód
// blokady.
//
// Reguła jest zgodna z RFC 4180: cytujemy tylko wtedy, gdy trzeba, a cudzysłów
// w treści podwajamy.

/** Jedna komórka CSV, zacytowana tylko wtedy, gdy jej treść tego wymaga. */
export function csvCell(value: string | number | null | undefined): string {
  const v = String(value ?? "");
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/**
 * Tekst CSV z wierszem nagłówka.
 *
 * `rows` to gotowe krotki wartości w kolejności kolumn - dobór kolumn należy
 * do wołającego, bo to on wie, co wolno wynieść z systemu.
 */
export function toCsv(
  columns: readonly string[],
  rows: ReadonlyArray<ReadonlyArray<string | number | null | undefined>>,
): string {
  return [columns.join(",")].concat(rows.map((row) => row.map(csvCell).join(","))).join("\n");
}

/** Nazwa pliku eksportu: prefiks plus dzień (z podanego znacznika ISO). */
export function csvFileNameFor(prefix: string, nowIso: string): string {
  return `${prefix}-${nowIso.slice(0, 10)}.csv`;
}
