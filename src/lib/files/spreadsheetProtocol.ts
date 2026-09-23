// Kontrakt wiadomości między stroną a procesem arkuszy (`spreadsheet.worker.ts`).
//
// JEDNA KOPIA `xlsx` W CAŁEJ APLIKACJI. Biblioteka żyje WYŁĄCZNIE w procesie
// arkuszy - podgląd załącznika w klubie, import danych wykresu i eksport leadów
// idą przez ten sam proces. Do 2026-09-23 dwie ostatnie powierzchnie ładowały
// `xlsx` drugi raz, w głównym wątku (159 KB gzip), obok kopii w procesie
// (121 KB): ten sam kod był w paczce dwukrotnie. Ten plik NIE importuje `xlsx`
// i nie może - to właśnie on jest współdzielony przez obie strony.
//
// Wszystko, co tu płynie, przechodzi przez structured clone: napisy, liczby,
// wartości logiczne, `null`, `Date` i `ArrayBuffer`.
import type { SheetResult } from "./officeParse";

/** Komórka, jaką oddaje `sheet_to_json({ header: 1, raw: true, cellDates: true })`. */
export type SpreadsheetCell = string | number | boolean | Date | null;

/** Komórka, którą umiemy zapisać do nowego skoroszytu. */
export type WritableCell = string | number | boolean | null;

/** Jeden arkusz odczytany do surowych wierszy. */
export interface SpreadsheetRows {
  name: string;
  rows: SpreadsheetCell[][];
}

export type SpreadsheetRequest =
  /** Podgląd załącznika: ograniczony HTML, twarde limity arkuszy, wierszy i kolumn. */
  | { op: "preview"; buffer: ArrayBuffer }
  /** Import danych: surowe komórki wszystkich arkuszy. */
  | { op: "rows"; buffer: ArrayBuffer }
  /** Eksport: jeden arkusz z wierszy do bajtów pliku `.xlsx`. */
  | { op: "write"; sheetName: string; rows: WritableCell[][] };

export type SpreadsheetOp = SpreadsheetRequest["op"];

export interface SpreadsheetResults {
  preview: SheetResult[];
  rows: SpreadsheetRows[];
  write: ArrayBuffer;
}

export type SpreadsheetResponse<Op extends SpreadsheetOp = SpreadsheetOp> =
  { ok: true; result: SpreadsheetResults[Op] } | { ok: false };
