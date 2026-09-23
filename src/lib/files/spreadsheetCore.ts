import * as XLSX from "xlsx";
import type { SheetResult } from "./officeParse";
import type {
  SpreadsheetCell,
  SpreadsheetRequest,
  SpreadsheetResults,
  SpreadsheetRows,
  WritableCell,
} from "./spreadsheetProtocol";

export const SPREADSHEET_MAX_BYTES = 20 * 1024 * 1024;
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
 * Import danych: surowe komórki każdego arkusza. `cellDates`, bo oś kategorii
 * wykresu potrzebuje daty jako daty, nie numeru dnia Excela; formatowanie
 * komórek do napisów zostaje po stronie strony (`importTable.formatImportedCell`),
 * bo zależy od strefy czasowej przeglądarki, a ta jest w procesie ta sama.
 */
export function readSpreadsheetRows(buffer: ArrayBuffer): SpreadsheetRows[] {
  if (buffer.byteLength > SPREADSHEET_MAX_BYTES) throw new Error("spreadsheet:file-limit");
  const book = XLSX.read(buffer, { type: "array", cellDates: true });
  const out: SpreadsheetRows[] = [];
  for (const name of book.SheetNames) {
    const sheet = book.Sheets[name];
    if (sheet === undefined) continue;
    const rows = XLSX.utils.sheet_to_json<SpreadsheetCell[]>(sheet, {
      header: 1,
      raw: true,
      defval: null,
      blankrows: false,
    });
    out.push({ name, rows });
  }
  return out;
}

/** Eksport: jeden arkusz z podanych wierszy do bajtów pliku `.xlsx`. */
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
  return XLSX.write(book, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
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
