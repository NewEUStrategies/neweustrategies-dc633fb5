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

/**
 * Twardy limit rozmiaru pliku arkusza - JEDNO źródło dla obu stron procesu.
 * Strona odrzuca za duży bufor, zanim w ogóle uruchomi proces (żadnej kopii
 * 20+ MB przez structured clone), a rdzeń w procesie sprawdza go ponownie, bo
 * jest wołany także bez tej bramki. Do 2026-10-02 strona miała własną kopię
 * tej liczby (`spreadsheetCore` ciągnie `xlsx`, więc nie wolno go importować
 * w głównym wątku) - dwie liczby, które mogły się rozjechać po cichu.
 */
export const SPREADSHEET_MAX_BYTES = 20 * 1024 * 1024;

/**
 * Formaty skoroszytu, które import danych wykresu i mapy wysyła do procesu
 * arkuszy - JEDNA lista dla strony (atrybut `accept`, odmowa przed odczytem)
 * i dla rdzenia procesu. Każdy format ma w `spreadsheetCore.test.ts` próbkę
 * zapisaną przez SheetJS i przeczytaną z powrotem; formatu bez takiej próbki
 * (np. `numbers` - zapis wymaga szablonu) tu nie ma. Pliki tekstowe (csv,
 * tsv, txt) czyta strona własnym parserem - patrz `importTable.ts`.
 */
export const SPREADSHEET_IMPORT_EXTENSIONS = [
  "xlsx",
  "xlsm",
  "xlsb",
  "xltx",
  "xltm",
  "xls",
  "ods",
  "fods",
  "html",
  "htm",
  "slk",
  "dif",
] as const;

/**
 * Limity odczytu przy imporcie. Wykres bierze najwyżej kilkadziesiąt kategorii,
 * mapa - kilkaset krajów; reszta skoroszytu nie ma po co przechodzić przez
 * structured clone ani przez formatowanie na stronie. Obcięcie NIE jest ciche:
 * rdzeń zwraca dokładne liczby pominiętych wierszy, kolumn i arkuszy.
 */
export const IMPORT_MAX_SHEETS = 10;
export const IMPORT_MAX_ROWS = 2000;
export const IMPORT_MAX_COLUMNS = 256;

/** Komórka, jaką oddaje `sheet_to_json({ header: 1, raw: true, cellDates: true })`. */
export type SpreadsheetCell = string | number | boolean | Date | null;

/** Komórka, którą umiemy zapisać do nowego skoroszytu. */
export type WritableCell = string | number | boolean | null;

/** Jeden arkusz odczytany do surowych wierszy. */
export interface SpreadsheetRows {
  name: string;
  rows: SpreadsheetCell[][];
  /** Wiersze zakresu arkusza za `IMPORT_MAX_ROWS` - dokładnie tyle nie dojechało. */
  rowsDropped: number;
  /** Kolumny zakresu arkusza za `IMPORT_MAX_COLUMNS`. */
  columnsDropped: number;
}

/** Skoroszyt do importu: arkusze w kolejności pliku i liczba pominiętych za limitem. */
export interface SpreadsheetBook {
  sheets: SpreadsheetRows[];
  /** Arkusze za `IMPORT_MAX_SHEETS` - nieprzeczytane w ogóle. */
  sheetsDropped: number;
}

export type SpreadsheetRequest =
  /** Podgląd załącznika: ograniczony HTML, twarde limity arkuszy, wierszy i kolumn. */
  | { op: "preview"; buffer: ArrayBuffer }
  /** Import danych: surowe komórki arkuszy, w limitach `IMPORT_MAX_*`. */
  | { op: "rows"; buffer: ArrayBuffer }
  /** Eksport: jeden arkusz z wierszy do bajtów pliku `.xlsx`. */
  | { op: "write"; sheetName: string; rows: WritableCell[][] };

export type SpreadsheetOp = SpreadsheetRequest["op"];

export interface SpreadsheetResults {
  preview: SheetResult[];
  rows: SpreadsheetBook;
  write: ArrayBuffer;
}

export type SpreadsheetResponse<Op extends SpreadsheetOp = SpreadsheetOp> =
  { ok: true; result: SpreadsheetResults[Op] } | { ok: false };
