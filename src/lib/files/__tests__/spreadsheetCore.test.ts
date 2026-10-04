import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  decodeSpreadsheet,
  handleSpreadsheetRequest,
  readSpreadsheetRows,
  writeSpreadsheet,
} from "../spreadsheetCore";
import { SPREADSHEET_MAX_BYTES } from "../spreadsheetProtocol";

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

describe("raw rows for the chart import", () => {
  it("keeps numbers, text and booleans as values and empty cells as null", () => {
    const [sheet] = readSpreadsheetRows(
      workbook([
        ["Kraj", "Wartość", "Aktywny"],
        ["PL", 42, true],
        ["DE", null, false],
      ]),
    );
    expect(sheet?.name).toBe("Sheet0");
    expect(sheet?.rows).toEqual([
      ["Kraj", "Wartość", "Aktywny"],
      ["PL", 42, true],
      ["DE", null, false],
    ]);
  });
  it("returns dates as Date objects, so the axis is not a serial day number", () => {
    const book = XLSX.utils.book_new();
    const day = new Date(2024, 0, 15);
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["Dzień"], [day]]), "Daty");
    const bytes = XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const cell = readSpreadsheetRows(bytes)[0]?.rows[1]?.[0];
    expect(cell).toBeInstanceOf(Date);
    expect(cell instanceof Date ? cell.getDate() : null).toBe(15);
  });
  it("reads every sheet of the workbook in order", () => {
    expect(readSpreadsheetRows(workbook([["a"]], 3)).map((sheet) => sheet.name)).toEqual([
      "Sheet0",
      "Sheet1",
      "Sheet2",
    ]);
  });
  it("skips blank rows instead of returning holes", () => {
    const [sheet] = readSpreadsheetRows(workbook([["a"], [], ["b"]]));
    expect(sheet?.rows).toEqual([["a"], ["b"]]);
  });
  it("rejects bytes above the limit before decoding", () => {
    expect(() => readSpreadsheetRows(new ArrayBuffer(SPREADSHEET_MAX_BYTES + 1))).toThrow(
      "file-limit",
    );
  });
});

describe("lead export workbook", () => {
  it("writes one named sheet that reads back cell by cell", () => {
    const bytes = writeSpreadsheet("Leady", [
      ["Imię", "Telefon", "Zgoda"],
      ["Żaneta", "+48 500 000 001", true],
      ["Ewa", 42, null],
    ]);
    const book = XLSX.read(bytes, { type: "array" });
    expect(book.SheetNames).toEqual(["Leady"]);
    expect(
      XLSX.utils.sheet_to_json(book.Sheets.Leady, { header: 1, raw: true, defval: null }),
    ).toEqual([
      ["Imię", "Telefon", "Zgoda"],
      ["Żaneta", "+48 500 000 001", true],
      ["Ewa", 42, null],
    ]);
  });
  it("does not mutate the rows it was given", () => {
    const rows: string[][] = [["a", "b"]];
    writeSpreadsheet("X", rows);
    expect(rows).toEqual([["a", "b"]]);
  });

  // WAGA PROCESU ARKUSZY (kronika `scripts/check-bundle-size.ts`, wpis XXII).
  // Eksport idzie przez `XLSX.writeXLSX` - wejście SheetJS pod tree-shaking -
  // a nie przez rozdzielacz `XLSX.write`, który trzyma w bundlu KAŻDY pisarz
  // biblioteki (xlsb, BIFF, ods, numbers, xlml, ...). Dwa testy niżej pilnują
  // obu połów tej zamiany: pliku (ten sam bajt w bajt) i źródła (powrót do
  // `XLSX.write` po cichu oddałby ~20 KB gzip w procesie i bramkę `overall`).
  it("writes exactly the bytes `XLSX.write` produces for bookType xlsx", () => {
    const rows = [
      ["Imię", "Telefon", "Zgoda", "Kwota"],
      ["Żaneta", "+48 500 000 001", true, 12.5],
      ["Ewa", null, false, -3],
    ];
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), "Leady");
    const expected = XLSX.write(book, { bookType: "xlsx", type: "array" }) as ArrayBuffer;

    expect(new Uint8Array(writeSpreadsheet("Leady", rows))).toEqual(new Uint8Array(expected));
  });

  it("the core never calls the all-formats dispatcher `XLSX.write`", () => {
    const source = readFileSync(resolve(process.cwd(), "src/lib/files/spreadsheetCore.ts"), "utf8")
      .split("\n")
      .filter((line) => !/^\s*(\*|\/\/)/.test(line))
      .join("\n");
    expect(source).toContain("XLSX.writeXLSX(");
    expect(source).not.toMatch(/XLSX\.write\s*\(/);
    expect(source).not.toMatch(/\bwriteFile\b/);
  });
});

describe("worker request dispatch", () => {
  it("routes each operation to its own function", () => {
    const bytes = workbook([["Ala", 1]]);
    expect(handleSpreadsheetRequest({ op: "preview", buffer: bytes })).toEqual(
      decodeSpreadsheet(bytes),
    );
    expect(handleSpreadsheetRequest({ op: "rows", buffer: bytes })).toEqual(
      readSpreadsheetRows(bytes),
    );
    const written = handleSpreadsheetRequest({ op: "write", sheetName: "W", rows: [["x"]] });
    expect(written).toBeInstanceOf(ArrayBuffer);
  });
});
