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
 * zapisaną przez SheetJS i przeczytaną z powrotem RAZEM Z POLSKIMI ZNAKAMI;
 * formatu bez takiej próbki tu nie ma. Pliki tekstowe (csv, tsv, txt) czyta
 * strona własnym parserem - patrz `importTable.ts`. Strony HTML (html, htm)
 * są na liście dla `accept`, ale import wykresu też czyta je na stronie:
 * proces bierze ich bajty za UTF-8 („Strona sieci Web" polskiego Excela jest
 * w Windows-1250) i nie zna większości encji.
 *
 * Czego tu NIE MA i dlaczego:
 *   - `slk` (SYLK) i `dif` - wydanie ESM SheetJS 0.20.3, które ładuje proces,
 *     nie ma tablic stron kodowych, więc oba czytniki biorą bajty UTF-8 za
 *     Latin-1: „Łódź" zapisane i przeczytane z powrotem wraca jako
 *     „ÅÃ³dÅº". Etykiety kategorii i nazwy krajów przechodziłyby na wykres
 *     zepsute bez słowa (próba w `spreadsheetCore.test.ts`).
 *   - `numbers` - zapis wymaga szablonu, więc nie ma próbki.
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
] as const;

/**
 * Czy kod formatu liczby jest procentowy - JEDNA reguła dla procesu arkuszy
 * (komórka pliku) i dla schowka (`mso-number-format` Excela, wzorzec Arkuszy
 * Google, `sdnum` LibreOffice), żeby ta sama komórka dawała tę samą liczbę
 * bez względu na drogę.
 *
 * Znak „%" w cudzysłowie, po ukośniku wstecznym albo w nawiasie kwadratowym
 * jest LITERAŁEM - Excel go wypisuje, ale wartości nie mnoży - więc liczy się
 * tylko „%" poza nimi. Nazwany format „Percent" to wbudowany format „0%"
 * w postaci, w jakiej Excel wkłada go do schowka.
 */
export function isPercentFormat(format: string): boolean {
  const bezLiteralow = format.replace(/"[^"]*"|\\.|\[[^\]]*\]/g, "");
  return /%/.test(bezLiteralow) || /^\s*percent\s*$/i.test(bezLiteralow);
}

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
  /** Wiersze zakresu arkusza za `IMPORT_MAX_ROWS` - dokładnie tyle nie dojechało (0 poza trybem importu wykresu). */
  rowsDropped: number;
  /** Kolumny zakresu arkusza za `IMPORT_MAX_COLUMNS` (0 poza trybem importu wykresu). */
  columnsDropped: number;
}

/** Skoroszyt do importu: arkusze w kolejności pliku i liczba pominiętych za limitem. */
export interface SpreadsheetBook {
  sheets: SpreadsheetRows[];
  /** Arkusze za `IMPORT_MAX_SHEETS` - nieprzeczytane w ogóle (0 poza trybem importu wykresu). */
  sheetsDropped: number;
}

/**
 * Odczyt surowych wierszy W TRYBIE IMPORTU WYKRESU - włączany JAWNIE, tylko
 * przez import danych wykresu i mapy (`importTable.readWorkbook`). Bez niego
 * (`chartImport` nieobecne albo `false`) `rows` czyta dokładnie tak jak przed
 * wprowadzeniem trybu: wszystkie arkusze, wszystkie wiersze, wartości tak, jak
 * je oddaje SheetJS, a liczniki pominiętych są zerami.
 *
 * W trybie importu wykresu:
 *   - komórka liczbowa w formacie procentowym (`isPercentFormat`) wraca jako
 *     wartość · 100 (`cellNF`), zaokrąglona `toPrecision(15)` - „7%" to 7,
 *     nie 7,000000000000001 - tak jak napis „7%" ze schowka;
 *   - błąd („#N/A") jedzie jako swój tekst, a nie jako cicha luka;
 *   - czytniki tekstowe (HTML) nie zgadują typów (`raw`): „2024-01" zostaje
 *     okresem, a „12,5%" napisem;
 *   - odczyt ma limity `IMPORT_MAX_*` z dokładnymi liczbami pominiętych.
 */
export interface SpreadsheetRowsOptions {
  chartImport?: boolean;
}

export type SpreadsheetRequest =
  /** Podgląd załącznika: ograniczony HTML, twarde limity arkuszy, wierszy i kolumn. */
  | { op: "preview"; buffer: ArrayBuffer }
  /** Import danych: surowe komórki arkuszy (tryb importu wykresu - patrz `SpreadsheetRowsOptions`). */
  | ({ op: "rows"; buffer: ArrayBuffer } & SpreadsheetRowsOptions)
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
