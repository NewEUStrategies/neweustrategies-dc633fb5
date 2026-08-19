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

/**
 * Wartość reprezentująca „pomiń tę kolumnę" na liście wyboru.
 *
 * Pole docelowe jest wtedy pustym napisem, ale kontrolka wyboru (Radix Select)
 * REZERWUJE pusty napis dla „brak zaznaczenia" i rzuca wyjątkiem, gdy pozycja
 * listy ma `value=""`. Dlatego na granicy UI pusty klucz jest tłumaczony na
 * ten sentinel - a `fieldKeyFromOption`/`optionFromFieldKey` są jedynym
 * miejscem, które o tym wie.
 */
export const SKIP_OPTION = "__skip__";

/** Wartość pozycji listy wyboru dla danego pola docelowego. */
export function optionFromFieldKey(key: FieldKey): string {
  return key === "" ? SKIP_OPTION : key;
}

/** Pole docelowe dla wartości wybranej na liście. */
export function fieldKeyFromOption(option: string): FieldKey {
  return option === SKIP_OPTION ? "" : (option as FieldKey);
}

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
 *
 * FIRMA stoi PRZED nazwą osoby, i to celowo: „Nazwa firmy" oraz „company name"
 * to najczęstsze nagłówki w eksportach CRM, a pasują do OBU wzorców. Przy
 * odwrotnej kolejności firma lądowała w bazie jako imię i nazwisko odbiorcy
 * („Szanowna Pani ACME sp. z o.o."), a kolumna firmy przepadała. W drugą stronę
 * pomyłka nie istnieje: żaden nagłówek nazwy osoby nie zawiera słowa „firma"
 * ani „company".
 */
export function autoMapHeader(header: readonly string[]): FieldKey[] {
  return header.map((h): FieldKey => {
    const n = h.trim().toLowerCase();
    if (/^(e[-_ ]?mail|mail|adres)/.test(n)) return "email";
    if (/(first|imi)/.test(n)) return "firstName";
    if (/(last|nazwisko|surname)/.test(n)) return "lastName";
    // `\bfirm` łapie polską odmianę („firma", „firmy", „firmie"), a granica słowa
    // wyklucza „confirmed" - nagłówek daty potwierdzenia nie jest firmą.
    if (/(company|\bfirm)/.test(n)) return "company";
    if (/(name|nazwa)/.test(n)) return "displayName";
    if (/(lang|jezyk|language)/.test(n)) return "language";
    if (/status/.test(n)) return "status";
    if (/(source|zrod)/.test(n)) return "source";
    return "";
  });
}

/**
 * Język wiersza. Rozpoznanie jest NIEWRAŻLIWE na wielkość liter i na wariant
 * regionalny: pliki z innych systemów mają zwykle „EN", „En" albo „en-GB",
 * a taki wiersz dostawał wcześniej polski szablon wiadomości mimo jawnej
 * deklaracji w pliku.
 *
 * Wszystko, czego nie da się odczytać jako angielski, schodzi na polski -
 * język nie jest zgodą, więc wartość domyślna jest tu bezpieczna.
 */
export function readLanguage(raw: string | undefined): "pl" | "en" {
  return (raw ?? "").trim().toLowerCase().startsWith("en") ? "en" : "pl";
}

/**
 * Słownik statusów zgody. Klucze są znormalizowane (bez spacji, małymi literami).
 *
 * Warianty polskie i angielskie są tu jawnie, bo pliki przychodzą z różnych
 * systemów: „unsub", „wypisany", „opt-out" znaczą to samo i MUSZĄ dać
 * `unsubscribed`, inaczej import wysłałby wiadomość komuś, kto się wypisał.
 */
const STATUS_WORDS: Readonly<Record<string, ImportStatus>> = {
  subscribed: "subscribed",
  subscriber: "subscribed",
  active: "subscribed",
  confirmed: "subscribed",
  zapisany: "subscribed",
  aktywny: "subscribed",
  potwierdzony: "subscribed",
  yes: "subscribed",
  tak: "subscribed",
  true: "subscribed",
  "1": "subscribed",
  pending: "pending",
  unconfirmed: "pending",
  oczekujacy: "pending",
  niepotwierdzony: "pending",
  unsubscribed: "unsubscribed",
  unsub: "unsubscribed",
  unsubscribe: "unsubscribed",
  optout: "unsubscribed",
  "opt-out": "unsubscribed",
  wypisany: "unsubscribed",
  wypisana: "unsubscribed",
  no: "unsubscribed",
  nie: "unsubscribed",
  false: "unsubscribed",
  "0": "unsubscribed",
};

/**
 * Status zgody wiersza.
 *
 * REGUŁA BEZPIECZEŃSTWA: kolumna statusu ZMAPOWANA, ale z wartością, której nie
 * da się odczytać, daje `pending` - nigdy `subscribed`. Wcześniej każda
 * nierozpoznana wartość („unsub", „wypisany", pusta komórka) zapisywała ZGODĘ
 * MARKETINGOWĄ, której nikt nie wyraził, a import nie miał jak tego zgłosić.
 *
 * Brak kolumny statusu w mapowaniu to inna sytuacja: operator wgrywa listę,
 * którą deklaruje jako swoją, więc domyślnym stanem jest `subscribed`.
 */
export function readStatus(raw: string | undefined, statusMapped: boolean): ImportStatus {
  if (!statusMapped) return "subscribed";
  const key = (raw ?? "").trim().toLowerCase();
  if (!key) return "pending";
  return STATUS_WORDS[key] ?? "pending";
}

/** Czy komórka wygląda na adres e-mail (ten sam warunek, co podgląd w dialogu). */
export function looksLikeEmail(value: string | undefined): boolean {
  return /.+@.+\..+/.test(value ?? "");
}

/** Status zgody marketingowej zapisywany przy imporcie. */
export type ImportStatus = "subscribed" | "pending" | "unsubscribed";

/** Wiersz gotowy do wysłania do server fn importu. */
export interface ImportRow {
  email: string;
  firstName?: string;
  lastName?: string;
  displayName?: string;
  language: "pl" | "en";
  status: ImportStatus;
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
 * Wartości są przycinane, a puste pola znikają (`undefined`). Język i status
 * przechodzą przez `readLanguage`/`readStatus` - patrz ich opisy: nierozpoznany
 * status w ZMAPOWANEJ kolumnie daje `pending`, nigdy zgodę marketingową.
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
    language: readLanguage(row.language),
    status: readStatus(row.status, mapping.includes("status")),
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
