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
import {
  IMPORT_MAX_COLUMNS,
  IMPORT_MAX_ROWS,
  IMPORT_MAX_SHEETS,
  SPREADSHEET_IMPORT_EXTENSIONS,
  SPREADSHEET_MAX_BYTES,
  isPercentFormat,
} from "../spreadsheetProtocol";

/** Tryb importu wykresu - włącza go wyłącznie import danych wykresu i mapy. */
const CHART = { chartImport: true } as const;

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
      CHART,
    ).sheets;
    expect(sheet?.name).toBe("Sheet0");
    expect(sheet?.rows).toEqual([
      ["Kraj", "Wartość", "Aktywny"],
      ["PL", 42, true],
      ["DE", null, false],
    ]);
    expect(sheet?.rowsDropped).toBe(0);
    expect(sheet?.columnsDropped).toBe(0);
  });
  it("returns dates as Date objects, so the axis is not a serial day number", () => {
    const book = XLSX.utils.book_new();
    const day = new Date(2024, 0, 15);
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["Dzień"], [day]]), "Daty");
    const bytes = XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const cell = readSpreadsheetRows(bytes, CHART).sheets[0]?.rows[1]?.[0];
    expect(cell).toBeInstanceOf(Date);
    expect(cell instanceof Date ? cell.getDate() : null).toBe(15);
  });
  it("reads every sheet of the workbook in order", () => {
    const book = readSpreadsheetRows(workbook([["a"]], 3), CHART);
    expect(book.sheets.map((sheet) => sheet.name)).toEqual(["Sheet0", "Sheet1", "Sheet2"]);
    expect(book.sheetsDropped).toBe(0);
  });
  it("skips blank rows instead of returning holes", () => {
    const [sheet] = readSpreadsheetRows(workbook([["a"], [], ["b"]]), CHART).sheets;
    expect(sheet?.rows).toEqual([["a"], ["b"]]);
  });
  it("rejects bytes above the limit before decoding", () => {
    for (const options of [{}, CHART]) {
      expect(() =>
        readSpreadsheetRows(new ArrayBuffer(SPREADSHEET_MAX_BYTES + 1), options),
      ).toThrow("file-limit");
    }
  });
});

// TRYB IMPORTU WYKRESU JEST WŁĄCZANY JAWNIE. `rows` bez `chartImport` czyta tak
// jak przed wprowadzeniem trybu - każdy inny (przyszły) wołający procesu
// arkuszy nie dostaje po cichu procentu · 100, błędów jako tekstu ani limitów.
describe("raw rows without the chart-import mode keep the previous reading", () => {
  it("returns the same values as the chart import for plain cells", () => {
    const bytes = workbook([
      ["Kraj", "Wartość", "Aktywny"],
      ["PL", 42, true],
      ["DE", null, false],
    ]);
    expect(readSpreadsheetRows(bytes)).toEqual(readSpreadsheetRows(bytes, CHART));
  });

  it("does not scale percent cells and keeps error cells as gaps", () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ["Udział", "Błąd"],
      [0.25, 0],
    ]);
    sheet.A2.z = "0%";
    sheet.B2 = { t: "e", v: 0x2a, w: "#N/A" };
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "Dane");
    const bytes = XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    expect(readSpreadsheetRows(bytes).sheets[0]?.rows).toEqual([
      ["Udział", "Błąd"],
      [0.25, null],
    ]);
    expect(readSpreadsheetRows(bytes, CHART).sheets[0]?.rows).toEqual([
      ["Udział", "Błąd"],
      [25, "#N/A"],
    ]);
  });

  it("reads every row and every sheet, with zero dropped counts", () => {
    const tall = Array.from({ length: IMPORT_MAX_ROWS + 5 }, (_, i) => [`K${i}`, i]);
    const [sheet] = readSpreadsheetRows(workbook(tall)).sheets;
    expect(sheet?.rows).toHaveLength(IMPORT_MAX_ROWS + 5);
    expect(sheet?.rowsDropped).toBe(0);
    const book = readSpreadsheetRows(workbook([["a"]], IMPORT_MAX_SHEETS + 2));
    expect(book.sheets).toHaveLength(IMPORT_MAX_SHEETS + 2);
    expect(book.sheetsDropped).toBe(0);
  });
});

// IMPORT: PLIK I SCHOWEK MAJĄ DAWAĆ TĘ SAMĄ LICZBĘ Z TEJ SAMEJ KOMÓRKI.
//
// Komórka „12,5%" w schowku to napis, który strona czyta jako 12,5 (procent nie
// dzieli przez sto). W pliku to 0,125 z formatem procentowym - rdzeń mnoży ją
// przez sto. Błąd („#N/D!") z pliku nie może być cichą luką: jedzie jako tekst
// i strona zgłasza go jak każdą komórkę nieliczbową.
describe("import cells agree with the clipboard", () => {
  function withFormats(bookType: XLSX.BookType): ArrayBuffer {
    const sheet = XLSX.utils.aoa_to_sheet([
      ["Udział", "Literał", "Błąd"],
      [0.125, 5, 0],
      [0.07, 6, 0],
    ]);
    sheet.A2.z = "0.0%";
    sheet.A3.z = "0%";
    sheet.B2.z = '0" %"';
    sheet.B3.z = "0\\%";
    sheet.C2 = { t: "e", v: 0x2a, w: "#N/A" };
    sheet.C3 = { t: "e", v: 0x07, w: "#DIV/0!" };
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "Dane");
    return XLSX.write(book, { type: "array", bookType }) as ArrayBuffer;
  }

  it.each(["xlsx", "xlsb", "xls", "ods"] as const)(
    "%s: a percent-formatted cell comes back as value x 100, a literal %% sign does not scale",
    (bookType) => {
      const [sheet] = readSpreadsheetRows(withFormats(bookType), CHART).sheets;
      // 0,07 · 100 to w liczbach zmiennoprzecinkowych 7,000000000000001 -
      // `toEqual(7)` dowodzi, że ogon binarny został zdjęty.
      expect(sheet?.rows.map((row) => row.slice(0, 2))).toEqual([
        ["Udział", "Literał"],
        [12.5, 5],
        [7, 6],
      ]);
    },
  );

  it("an error cell travels as its text, not as an empty cell", () => {
    const [sheet] = readSpreadsheetRows(withFormats("xlsx"), CHART).sheets;
    expect(sheet?.rows.map((row) => row[2])).toEqual(["Błąd", "#N/A", "#DIV/0!"]);
  });

  it("recognises percent formats and ignores quoted, escaped and bracketed % signs", () => {
    expect(isPercentFormat("0%")).toBe(true);
    expect(isPercentFormat("0.00%;[Red]-0.00%")).toBe(true);
    expect(isPercentFormat('0" %"')).toBe(false);
    expect(isPercentFormat("0\\%")).toBe(false);
    expect(isPercentFormat("[$%-415]0")).toBe(false);
    expect(isPercentFormat("General")).toBe(false);
    // Excel wkłada wbudowany format „0%" do schowka jako nazwę.
    expect(isPercentFormat("Percent")).toBe(true);
  });
});

// LIMITY ODCZYTU SĄ DOKŁADNE. Obcięcie arkusza bez liczby pominiętych wierszy
// to cicha strata - redaktor widziałby wykres z połowy danych jako komplet.
describe("import read limits report exact counts", () => {
  const tall = Array.from({ length: IMPORT_MAX_ROWS + 5 }, (_, i) => [`K${i}`, i]);

  it("caps the rows of a workbook sheet and reports how many were dropped", () => {
    const [sheet] = readSpreadsheetRows(workbook(tall), CHART).sheets;
    expect(sheet?.rows).toHaveLength(IMPORT_MAX_ROWS);
    expect(sheet?.rows.at(-1)).toEqual([`K${IMPORT_MAX_ROWS - 1}`, IMPORT_MAX_ROWS - 1]);
    expect(sheet?.rowsDropped).toBe(5);
  });

  it("keeps the count exact for text formats that have no full range (HTML)", () => {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(tall), "Dane");
    const html = XLSX.write(book, { type: "array", bookType: "html" }) as ArrayBuffer;
    const [sheet] = readSpreadsheetRows(html, CHART).sheets;
    expect(sheet?.rows).toHaveLength(IMPORT_MAX_ROWS);
    expect(sheet?.rowsDropped).toBe(5);
  });

  it("does not report a sheet that fits the limit exactly", () => {
    const [sheet] = readSpreadsheetRows(workbook(tall.slice(0, IMPORT_MAX_ROWS)), CHART).sheets;
    expect(sheet?.rows).toHaveLength(IMPORT_MAX_ROWS);
    expect(sheet?.rowsDropped).toBe(0);
  });

  it("caps the columns and reports how many were dropped", () => {
    const wide = [Array.from({ length: IMPORT_MAX_COLUMNS + 3 }, (_, i) => i)];
    const [sheet] = readSpreadsheetRows(workbook(wide), CHART).sheets;
    expect(sheet?.rows[0]).toHaveLength(IMPORT_MAX_COLUMNS);
    expect(sheet?.columnsDropped).toBe(3);
  });

  it("reads at most the sheet limit and reports the sheets it skipped", () => {
    const book = readSpreadsheetRows(workbook([["a"]], IMPORT_MAX_SHEETS + 2), CHART);
    expect(book.sheets).toHaveLength(IMPORT_MAX_SHEETS);
    expect(book.sheets.at(-1)?.name).toBe(`Sheet${IMPORT_MAX_SHEETS - 1}`);
    expect(book.sheetsDropped).toBe(2);
  });

  it("returns an empty sheet as an empty list, not as an error", () => {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([]), "Pusty");
    const bytes = XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    expect(readSpreadsheetRows(bytes, CHART).sheets).toEqual([
      { name: "Pusty", rows: [], rowsDropped: 0, columnsDropped: 0 },
    ]);
  });
});

// KAŻDE ROZSZERZENIE Z LISTY MA PRÓBKĘ - Z POLSKIMI ZNAKAMI. Lista importu
// jest kontraktem z redaktorem: rozszerzenie, które przyjmujemy, a którego
// proces nie czyta (albo czyta z zepsutymi etykietami), kończy się błędem albo,
// gorzej, wykresem z „ÅÃ³dÅº" w miejscu „Łódź". Próbki zapisuje SheetJS
// w teście (bez plików binarnych w repozytorium); szablony xltx/xltm mają tę
// samą budowę co xlsx/xlsm.
describe("every accepted import extension has a readable sample", () => {
  const BOOK_TYPE: Record<(typeof SPREADSHEET_IMPORT_EXTENSIONS)[number], XLSX.BookType> = {
    xlsx: "xlsx",
    xlsm: "xlsm",
    xlsb: "xlsb",
    xltx: "xlsx",
    xltm: "xlsm",
    xls: "xls",
    ods: "ods",
    fods: "fods",
    html: "html",
    htm: "html",
  };

  function sample(bookType: XLSX.BookType): ArrayBuffer {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      book,
      XLSX.utils.aoa_to_sheet([
        ["Miasto", "Wartość"],
        ["Łódź", 1234.5],
        ["NA", -3],
      ]),
      "Dane",
    );
    return XLSX.write(book, { type: "array", bookType }) as ArrayBuffer;
  }

  it.each([...SPREADSHEET_IMPORT_EXTENSIONS])("%s", (ext) => {
    const [sheet] = readSpreadsheetRows(sample(BOOK_TYPE[ext]), CHART).sheets;
    // HTML wraca napisami (czytnik tekstowy bez zgadywania typów), reszta
    // liczbami - strona i tak sprowadza jedno i drugie do napisu.
    expect(sheet?.rows.map((row) => row.map(String))).toEqual([
      ["Miasto", "Wartość"],
      ["Łódź", "1234.5"],
      ["NA", "-3"],
    ]);
  });

  // DLACZEGO NIE MA SYLK (.slk) I DIF (.dif). Wydanie ESM SheetJS 0.20.3, które
  // ładuje proces, nie ma tablic stron kodowych: oba czytniki biorą bajty
  // UTF-8 za Latin-1. Gdy ta próba zacznie przechodzić (nowa wersja
  // biblioteki), oba formaty mogą wrócić na listę - razem z próbką wyżej.
  it.each([
    ["slk", "sylk"],
    ["dif", "dif"],
  ] as const)(
    "%s is not accepted: Polish characters do not survive the round trip",
    (ext, type) => {
      expect(SPREADSHEET_IMPORT_EXTENSIONS as readonly string[]).not.toContain(ext);
      const [sheet] = readSpreadsheetRows(sample(type)).sheets;
      expect(sheet?.rows[1]?.[0]).not.toBe("Łódź");
    },
  );

  it("an HTML table keeps period labels and country codes as text", () => {
    const html = new TextEncoder().encode(
      "<html><body><table><tr><td>Okres</td><td>Kraj</td></tr><tr><td>2024-01</td><td>NA</td></tr></table></body></html>",
    );
    const [sheet] = readSpreadsheetRows(html.buffer, CHART).sheets;
    expect(sheet?.rows).toEqual([
      ["Okres", "Kraj"],
      ["2024-01", "NA"],
    ]);
    // Bez trybu importu wykresu SheetJS zgaduje typ i robi z okresu datę -
    // dlatego `raw` należy do trybu, a nie do odczytu zastanego.
    expect(readSpreadsheetRows(html.buffer).sheets[0]?.rows[1]?.[0]).toBeInstanceOf(Date);
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

  it("switches the chart-import mode on only for a rows request that asks for it", () => {
    const sheet = XLSX.utils.aoa_to_sheet([["Udział"], [0.25]]);
    sheet.A2.z = "0%";
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "Dane");
    const bytes = XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const cell = (request: Parameters<typeof handleSpreadsheetRequest>[0]) => {
      const result = handleSpreadsheetRequest(request);
      return "sheets" in result ? result.sheets[0]?.rows[1]?.[0] : undefined;
    };
    expect(cell({ op: "rows", buffer: bytes })).toBe(0.25);
    expect(cell({ op: "rows", buffer: bytes, chartImport: false })).toBe(0.25);
    expect(cell({ op: "rows", buffer: bytes, chartImport: true })).toBe(25);
  });
});
