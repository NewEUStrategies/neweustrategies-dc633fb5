import * as XLSX from "xlsx";
import type { SheetResult } from "./officeParse";
import {
  IMPORT_MAX_COLUMNS,
  IMPORT_MAX_ROWS,
  IMPORT_MAX_SHEETS,
  SPREADSHEET_MAX_BYTES,
  type SpreadsheetBook,
  type SpreadsheetCell,
  type SpreadsheetRequest,
  type SpreadsheetResults,
  type SpreadsheetRows,
  type WritableCell,
} from "./spreadsheetProtocol";

export const SPREADSHEET_MAX_ROWS = 1000;
const MAX_COLUMNS = 100;
const MAX_SHEETS = 10;
const MAX_HTML_CHARS = 2 * 1024 * 1024;

/** Runs exclusively in a disposable worker. Reject oversized previews explicitly. */
export function decodeSpreadsheet(buffer: ArrayBuffer): SheetResult[] {
  if (buffer.byteLength > SPREADSHEET_MAX_BYTES) throw new Error("spreadsheet:file-limit");
  const index = XLSX.read(buffer, { type: "array", bookSheets: true });
  if (index.SheetNames.length > MAX_SHEETS) throw new Error("spreadsheet:sheet-limit");
  const book = XLSX.read(buffer, { type: "array", sheetRows: SPREADSHEET_MAX_ROWS + 1 });
  let htmlChars = 0;
  return book.SheetNames.map((name) => {
    const sheet = book.Sheets[name];
    if (!sheet) return { name, html: "", rows: 0 };
    const ref = sheet["!fullref"] ?? sheet["!ref"];
    const range = ref ? XLSX.utils.decode_range(ref) : undefined;
    const rows = range ? range.e.r + 1 : 0;
    if (rows > SPREADSHEET_MAX_ROWS || (range && range.e.c >= MAX_COLUMNS)) {
      throw new Error("spreadsheet:cell-limit");
    }
    const html = XLSX.utils.sheet_to_html(sheet, { editable: false });
    htmlChars += html.length;
    if (htmlChars > MAX_HTML_CHARS) throw new Error("spreadsheet:html-limit");
    return { name, html, rows };
  });
}

/**
 * Czy format liczby jest procentowy. Znak „%" w cudzysłowie, po ukośniku
 * wstecznym albo w nawiasie kwadratowym jest LITERAŁEM - Excel go wypisuje,
 * ale wartości nie mnoży - więc liczy się tylko „%" poza nimi.
 */
export function isPercentFormat(format: string): boolean {
  return /%/.test(format.replace(/"[^"]*"|\\.|\[[^\]]*\]/g, ""));
}

/**
 * Komórka do importu - DWIE poprawki, obie po to, żeby plik i schowek dawały
 * tę samą liczbę z tej samej komórki.
 *
 * PROCENT: komórka „12,5%" ma w pliku wartość 0,125, a w schowku napis
 * „12,5%", który parser strony czyta jako 12,5 (procent NIE dzieli przez sto -
 * reguła w `importTable.parseImportedNumber`). Bez tej poprawki ten sam
 * arkusz dawał 0,125 z pliku i 12,5 z wklejenia. `toPrecision(15)` zdejmuje
 * ogon binarny (0,07 · 100 = 7,000000000000001).
 *
 * BŁĄD: „#N/D!" (`#N/A`) w surowym odczycie zamieniał się w pustą komórkę, czyli
 * w CICHĄ lukę. Napis błędu jedzie dalej jako tekst, a strona zgłasza go jako
 * komórkę nieliczbową - dokładnie tak, jak przy wklejeniu.
 */
function normaliseImportCell(cell: XLSX.CellObject | undefined): void {
  if (cell === undefined || cell === null) return;
  if (cell.t === "n" && typeof cell.v === "number" && typeof cell.z === "string") {
    if (isPercentFormat(cell.z)) cell.v = Number((cell.v * 100).toPrecision(15));
  } else if (cell.t === "e") {
    cell.t = "s";
    cell.v = cell.w ?? "#ERR";
  }
}

function normaliseImportSheet(sheet: XLSX.WorkSheet): void {
  const dense = sheet["!data"];
  if (Array.isArray(dense)) {
    for (const row of dense) if (Array.isArray(row)) row.forEach(normaliseImportCell);
    return;
  }
  for (const key of Object.keys(sheet)) {
    if (!key.startsWith("!")) normaliseImportCell(sheet[key] as XLSX.CellObject);
  }
}

/** Zakres arkusza albo `null` dla arkusza pustego. */
function rangeOf(ref: unknown): XLSX.Range | null {
  return typeof ref === "string" && ref !== "" ? XLSX.utils.decode_range(ref) : null;
}

/**
 * Import danych: surowe komórki arkuszy, w limitach `IMPORT_MAX_*`.
 *
 * `cellDates`, bo oś kategorii wykresu potrzebuje daty jako daty, nie numeru
 * dnia Excela; formatowanie komórek do napisów zostaje po stronie strony
 * (`importTable.formatImportedCell`), bo zależy od strefy czasowej
 * przeglądarki, a ta jest w procesie ta sama. `cellNF` - bo bez formatu nie
 * da się rozpoznać komórki procentowej. `raw` dotyczy wyłącznie czytników
 * tekstowych (HTML): bez niego SheetJS zgaduje typy i zamienia „2024-01" na
 * datę, a „12,5%" na 0,125 BEZ formatu - czyli wbrew regule procentu.
 *
 * LIMITY SĄ DOKŁADNE. `sheetRows` ucina odczyt, a pełny zakres zostaje
 * w `!fullref`; z różnicy wychodzi liczba pominiętych wierszy. Czytniki
 * tekstowe (HTML, SYLK, DIF) `!fullref` nie ustawiają - gdy taki arkusz
 * dobił do limitu, rdzeń czyta plik drugi raz bez limitu (format tekstowy
 * mieści się w limicie bajtów strony), żeby liczba była prawdziwa, a nie
 * „co najmniej".
 */
export function readSpreadsheetRows(buffer: ArrayBuffer): SpreadsheetBook {
  if (buffer.byteLength > SPREADSHEET_MAX_BYTES) throw new Error("spreadsheet:file-limit");
  const names = XLSX.read(buffer, { type: "array", bookSheets: true }).SheetNames;
  const wanted = names.slice(0, IMPORT_MAX_SHEETS);
  const opts: XLSX.ParsingOptions = {
    type: "array",
    cellDates: true,
    cellNF: true,
    raw: true,
    dense: true,
    sheets: wanted,
  };
  const book = XLSX.read(buffer, { ...opts, sheetRows: IMPORT_MAX_ROWS });
  let unbounded: XLSX.WorkBook | null = null;
  const sheets: SpreadsheetRows[] = [];
  for (const name of wanted) {
    const sheet = book.Sheets[name];
    if (sheet === undefined) continue;
    const read = rangeOf(sheet["!ref"]);
    let full = rangeOf(sheet["!fullref"]) ?? read;
    if (read !== null && sheet["!fullref"] === undefined && read.e.r + 1 >= IMPORT_MAX_ROWS) {
      unbounded ??= XLSX.read(buffer, opts);
      full = rangeOf(unbounded.Sheets[name]?.["!ref"]) ?? read;
    }
    if (read === null || full === null) {
      sheets.push({ name, rows: [], rowsDropped: 0, columnsDropped: 0 });
      continue;
    }
    const lastColumn = Math.min(read.e.c, read.s.c + IMPORT_MAX_COLUMNS - 1);
    normaliseImportSheet(sheet);
    const rows = XLSX.utils.sheet_to_json<SpreadsheetCell[]>(sheet, {
      header: 1,
      raw: true,
      defval: null,
      blankrows: false,
      range: { s: read.s, e: { r: read.e.r, c: lastColumn } },
    });
    sheets.push({
      name,
      rows,
      rowsDropped: Math.max(0, full.e.r - read.e.r),
      columnsDropped: Math.max(0, full.e.c - lastColumn),
    });
  }
  return { sheets, sheetsDropped: names.length - wanted.length };
}

/**
 * Eksport: jeden arkusz z podanych wierszy do bajtów pliku `.xlsx`.
 *
 * `writeXLSX`, NIE `write` - i to jest decyzja o wadze procesu, nie o stylu.
 * `XLSX.write` rozdziela zlecenie po `bookType` na KAŻDY pisarz biblioteki
 * (xlsb, xls/BIFF2-8, ods, numbers, xlml, csv, sylk, dbf, ...), więc bundler
 * nie może żadnego z nich wyrzucić, choć wołamy wyłącznie xlsx. `writeXLSX` to
 * wejście, które SheetJS wystawia właśnie pod tree-shaking: ta sama ścieżka
 * `write_zip_xlsx` co `write(..., { bookType: "xlsx" })`, bez pozostałych
 * pisarzy. Plik wynikowy jest ten sam bajt w bajt (test w
 * `__tests__/spreadsheetCore.test.ts`), a proces arkuszy chudnie o ~18 KB gzip
 * na `xlsx` 0.18.5 i więcej na 0.20.3 runnera (kronika w
 * `scripts/check-bundle-size.ts`, wpis XXII).
 */
export function writeSpreadsheet(
  sheetName: string,
  rows: readonly (readonly WritableCell[])[],
): ArrayBuffer {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet(rows.map((row) => [...row])),
    sheetName,
  );
  return XLSX.writeXLSX(book, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
}

/** Jedyne wejście procesu arkuszy - rozdziela zlecenie na trzy operacje. */
export function handleSpreadsheetRequest(
  request: SpreadsheetRequest,
): SpreadsheetResults[SpreadsheetRequest["op"]] {
  switch (request.op) {
    case "preview":
      return decodeSpreadsheet(request.buffer);
    case "rows":
      return readSpreadsheetRows(request.buffer);
    case "write":
      return writeSpreadsheet(request.sheetName, request.rows);
  }
}
