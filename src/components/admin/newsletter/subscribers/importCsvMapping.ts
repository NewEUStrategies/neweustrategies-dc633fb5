// Reguły mapowania importu CSV subskrybentów - warstwa CZYSTA.
//
// PO CO OSOBNY MODUŁ. Import CSV wprowadza na listę DANE OSOBOWE wraz ze
// statusem zgody marketingowej, a decyduje o tym kilka cichych reguł:
// rozpoznanie nagłówka, dopuszczalne wartości języka i statusu oraz to, co
// się dzieje z wartością nierozpoznaną. Dopóki żyły wewnątrz komponentu
// dialogu, jedyną drogą do nich był render z podstawionym plikiem - czyli
// najdroższy możliwy sposób sprawdzenia reguły, która jest funkcją tekstu.
//
// Wyprowadzenie jest bezstratne: ciała funkcji przeniesione BEZ ZMIANY
// zachowania (łącznie z kolejnością dopasowań w `autoMapHeader`, która ma
// znaczenie - patrz komentarz przy regułach). Zmiany zachowania idą osobnymi
// commitami, żeby dało się je czytać jako naprawy, a nie jako refaktor.

/** Pole subskrybenta, na które można zmapować kolumnę pliku. */
export type FieldKey =
  | "email"
  | "firstName"
  | "lastName"
  | "displayName"
  | "language"
  | "status"
  | "company"
  | "source"
  | "";

/** Kolejność decyduje o kolejności pozycji na liście wyboru w dialogu. */
export const FIELD_KEYS: readonly FieldKey[] = [
  "email",
  "firstName",
  "lastName",
  "displayName",
  "language",
  "status",
  "company",
  "source",
  "",
];

/**
 * Automatyczne rozpoznanie nagłówka.
 *
 * UWAGA: kolejność reguł jest częścią zachowania. Dopasowanie jest zachłanne -
 * wygrywa PIERWSZA pasująca reguła, więc nagłówek pasujący do dwóch wzorców
 * dostaje ten wcześniejszy.
 */
export function autoMapHeader(header: readonly string[]): FieldKey[] {
  return header.map((h): FieldKey => {
    const n = h.trim().toLowerCase();
    if (/^(e[-_ ]?mail|mail|adres)/.test(n)) return "email";
    if (/(first|imi)/.test(n)) return "firstName";
    if (/(last|nazwisko|surname)/.test(n)) return "lastName";
    if (/(name|nazwa)/.test(n)) return "displayName";
    if (/(lang|jezyk|language)/.test(n)) return "language";
    if (/status/.test(n)) return "status";
    if (/(company|firma)/.test(n)) return "company";
    if (/(source|zrod)/.test(n)) return "source";
    return "";
  });
}

/** Czy komórka wygląda na adres e-mail (ten sam warunek, co podgląd w dialogu). */
export function looksLikeEmail(value: string | undefined): boolean {
  return /.+@.+\..+/.test(value ?? "");
}

/** Wiersz gotowy do wysłania do server fn importu. */
export interface ImportRow {
  email: string;
  firstName?: string;
  lastName?: string;
  displayName?: string;
  language: "pl" | "en";
  status: "subscribed" | "pending" | "unsubscribed";
  source?: string;
  company?: string;
}

/** Wiersze, w których zmapowana kolumna e-mail zawiera adres. */
export function validRows(
  rows: readonly (readonly string[])[],
  emailIdx: number,
): readonly string[][] {
  if (emailIdx < 0) return [];
  return rows.filter((r) => looksLikeEmail(r[emailIdx])) as string[][];
}

/**
 * Składa wiersz pliku w ładunek importu według mapowania kolumn.
 *
 * Zachowanie przeniesione 1:1 z dialogu: wartości są przycinane, puste pola
 * znikają (`undefined`), a język i status spoza słownika schodzą na wartości
 * domyślne.
 */
export function buildImportRow(cells: readonly string[], mapping: readonly FieldKey[]): ImportRow {
  const row: Record<string, string> = {};
  mapping.forEach((key, i) => {
    const cell = cells[i];
    if (key && cell) row[key] = cell.trim();
  });

  return {
    email: row.email ?? "",
    firstName: row.firstName || undefined,
    lastName: row.lastName || undefined,
    displayName: row.displayName || undefined,
    language: row.language === "en" ? "en" : "pl",
    status:
      row.status === "pending" || row.status === "unsubscribed"
        ? (row.status as "pending" | "unsubscribed")
        : "subscribed",
    source: row.source || undefined,
    company: row.company || undefined,
  };
}

/** Wszystkie wiersze z poprawnym adresem, złożone w ładunek importu. */
export function buildImportRows(
  rows: readonly (readonly string[])[],
  mapping: readonly FieldKey[],
): ImportRow[] {
  const emailIdx = mapping.indexOf("email");
  return validRows(rows, emailIdx).map((cells) => buildImportRow(cells, mapping));
}
