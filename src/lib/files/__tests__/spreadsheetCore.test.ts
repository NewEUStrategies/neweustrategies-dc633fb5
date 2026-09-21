import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { decodeSpreadsheet, SPREADSHEET_MAX_BYTES } from "../spreadsheetCore";

function workbook(rows: unknown[][], count = 1): ArrayBuffer {
  const book = XLSX.utils.book_new();
  for (let i = 0; i < count; i++)
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), `Sheet${i}`);
  return XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

describe("bounded real SheetJS preview", () => {
  it("reads a real workbook with accents, numbers and multiple sheets", () => {
    const result = decodeSpreadsheet(
      workbook(
        [
          ["Żółć", 42],
          ["Second", 7],
        ],
        2,
      ),
    );
    expect(result.map((s) => s.rows)).toEqual([2, 2]);
    expect(result[0]?.html).toContain("Żółć");
    expect(result[0]?.html).toContain("42");
  });
  it("rejects bytes before decompression", () => {
    expect(() => decodeSpreadsheet(new ArrayBuffer(SPREADSHEET_MAX_BYTES + 1))).toThrow(
      "file-limit",
    );
  });
  it("rejects too many sheets before decoding cells", () => {
    expect(() => decodeSpreadsheet(workbook([[1]], 11))).toThrow("sheet-limit");
  });
  it("rejects excessive rows rather than silently presenting a truncated report", () => {
    expect(() => decodeSpreadsheet(workbook(Array.from({ length: 1001 }, (_, i) => [i])))).toThrow(
      "cell-limit",
    );
  });
  it("rejects excessive columns", () => {
    expect(() => decodeSpreadsheet(workbook([Array.from({ length: 101 }, (_, i) => i)]))).toThrow(
      "cell-limit",
    );
  });
});
