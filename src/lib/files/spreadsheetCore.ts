import * as XLSX from "xlsx";
import type { SheetResult } from "./officeParse";

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
