// IMPORT SKOROSZYTU DO WYKRESU - `readWorkbook` na prawdziwym pliku.
//
// CO TEN PLIK DOWODZI.
//   1. PLIK TEKSTOWY NIE DOTYKA PROCESU ARKUSZY. CSV, TSV i TXT czyta własny
//      parser, który niczego nie przetypowuje - `xlsx` zamieniłby „2024-01" na
//      datę, a kod kraju „NA" (Namibia) na pustą komórkę.
//   2. SKOROSZYT CZYTA PROCES ARKUSZY, a strona tylko formatuje komórki:
//      liczba zostaje liczbą w zapisie kropkowym, data wychodzi jako
//      „RRRR-MM-DD" z pól LOKALNYCH (bez cofania dnia na wschód od Greenwich),
//      wartość logiczna jako 1/0, pusta komórka jako pusty napis.
//   3. KAŻDY ARKUSZ WRACA OSOBNO i jako prostokąt, a wiersze całkiem puste
//      znikają - redaktor wybiera arkusz, więc nie może dostać dziur.
//   4. ZA DUŻY PLIK NIE WYCHODZI Z PRZEGLĄDARKI do procesu, a odmowa procesu
//      dochodzi do wołającego jako błąd (UI mówi wtedy „nie udało się
//      odczytać", bez szczegółów biblioteki).
//
// Proces arkuszy (Web Worker) nie istnieje w środowisku testów. Jego transport
// ma własny test (`src/lib/files/__tests__/spreadsheetWorker.test.ts`); tutaj
// biegnie TEN SAM rdzeń odczytu, tylko w procesie testu.
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";

const h = vi.hoisted(() => ({
  calls: 0,
  refuse: false,
  options: [] as ({ chartImport?: boolean } | undefined)[],
}));

vi.mock("@/lib/files/spreadsheetWorker", async () => {
  const core = await import("@/lib/files/spreadsheetCore");
  return {
    readSpreadsheetRowsInWorker: async (
      buffer: ArrayBuffer,
      options?: { chartImport?: boolean },
    ) => {
      h.calls += 1;
      h.options.push(options);
      if (h.refuse) throw new Error("spreadsheet:read-failed");
      return core.readSpreadsheetRows(buffer, { chartImport: options?.chartImport });
    },
  };
});

import {
  IMPORT_MAX_BYTES,
  decodeTextBytes,
  parseImportedNumber,
  readWorkbook,
  tableToChartData,
} from "@/lib/charts/importTable";
import { readClipboardTable } from "@/lib/charts/clipboardTable";
import { IMPORT_MAX_ROWS, IMPORT_MAX_SHEETS } from "@/lib/files/spreadsheetProtocol";

function skoroszyt(arkusze: Record<string, unknown[][]>): File {
  const book = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(arkusze)) {
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), name);
  }
  const bytes = XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return new File([bytes], "dane.xlsx");
}

beforeEach(() => {
  h.calls = 0;
  h.refuse = false;
  h.options = [];
});

describe("plik tekstowy", () => {
  it("CSV idzie własnym parserem i nie przetypowuje komórek", async () => {
    const book = await readWorkbook(new File(["kraj;okres\nNA;2024-01\n"], "dane.csv"));

    expect(book.sheets).toEqual([
      {
        name: "dane.csv",
        rows: [
          ["kraj", "okres"],
          ["NA", "2024-01"],
        ],
        problems: [],
      },
    ]);
    expect(book.problems).toEqual([]);
    expect(h.calls).toBe(0);
  });

  it("TSV dzieli po tabulatorze", async () => {
    const book = await readWorkbook(new File(["a\tb\n1\t2\n"], "dane.tsv"));

    expect(book.sheets[0]?.rows).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("skoroszyt przez proces arkuszy", () => {
  it("formatuje komórki: liczba, tekst, wartość logiczna i pusta komórka", async () => {
    const book = await readWorkbook(
      skoroszyt({
        Dane: [
          ["Kraj", "Wartość", "Aktywny"],
          ["PL", 1234.5, true],
          ["DE", null, false],
        ],
      }),
    );

    expect(h.calls).toBe(1);
    // Tryb importu wykresu włącza WYŁĄCZNIE ta droga - proces bez niego czyta
    // jak przed jego wprowadzeniem (podgląd w klubie, eksport leadów).
    expect(h.options).toEqual([{ chartImport: true }]);
    expect(book.sheets).toEqual([
      {
        name: "Dane",
        rows: [
          ["Kraj", "Wartość", "Aktywny"],
          ["PL", "1234.5", "1"],
          ["DE", "", "0"],
        ],
        problems: [],
      },
    ]);
    expect(book.problems).toEqual([]);
  });

  it("data z komórki wychodzi jako dzień z pól lokalnych, bez godziny o północy", async () => {
    const book = await readWorkbook(skoroszyt({ Daty: [["Dzień"], [new Date(2024, 0, 15)]] }));

    expect(book.sheets[0]?.rows[1]).toEqual(["2024-01-15"]);
  });

  it("każdy arkusz wraca osobno, dociągnięty do prostokąta, bez pustych wierszy", async () => {
    const book = await readWorkbook(
      skoroszyt({
        Pierwszy: [["a", "b", "c"], ["1"], [], ["2", "3"]],
        Drugi: [["x"]],
      }),
    );

    expect(book.sheets.map((sheet) => sheet.name)).toEqual(["Pierwszy", "Drugi"]);
    expect(book.sheets[0]?.rows).toEqual([
      ["a", "b", "c"],
      ["1", "", ""],
      ["2", "3", ""],
    ]);
  });

  it("odmowa procesu dochodzi do wołającego jako błąd", async () => {
    h.refuse = true;

    await expect(readWorkbook(skoroszyt({ A: [["x"]] }))).rejects.toThrow("read-failed");
  });
});

// KODOWANIE PLIKU TEKSTOWEGO. Polski Excel zapisuje „CSV (rozdzielany
// przecinkami)" w Windows-1250, a „Tekst Unicode" w UTF-16LE z tabulatorami.
// `file.text()` czytało oba jako UTF-8 i etykiety wychodziły ze znakami
// zastępczymi - a z nimi przestawało działać rozpoznawanie krajów po nazwie.
describe("kodowanie pliku tekstowego", () => {
  const plik = (bytes: Uint8Array<ArrayBuffer>, name: string) => new File([bytes], name);

  it("UTF-8 z BOM: BOM znika, polskie znaki zostają, bez zgłoszenia", async () => {
    const bytes = new Uint8Array([
      0xef,
      0xbb,
      0xbf,
      ...new TextEncoder().encode("Kraj;Wartość\nWęgry;1"),
    ]);
    const book = await readWorkbook(plik(bytes, "dane.csv"));
    expect(book.sheets[0]?.rows).toEqual([
      ["Kraj", "Wartość"],
      ["Węgry", "1"],
    ]);
    expect(book.problems).toEqual([]);
  });

  it("Windows-1250: odczyt zastępczy z polskimi znakami i ZGŁOSZENIEM", async () => {
    // „Węgry;1,5" w Windows-1250: ę = 0xEA - bajt, którego ścisły UTF-8 nie przyjmie.
    const bytes = new Uint8Array([0x57, 0xea, 0x67, 0x72, 0x79, 0x3b, 0x31, 0x2c, 0x35]);
    const book = await readWorkbook(plik(bytes, "dane.csv"));
    expect(book.sheets[0]?.rows).toEqual([["Węgry", "1,5"]]);
    expect(book.problems).toEqual([{ code: "encodingFallback", encoding: "windows-1250" }]);
  });

  it("UTF-16LE z BOM („Tekst Unicode” Excela): tabulator bez zgadywania", async () => {
    const text = "Kraj\tUdział\nPolska\t1,5\n";
    const body = new Uint8Array(text.length * 2);
    for (let i = 0; i < text.length; i += 1) {
      body[i * 2] = text.charCodeAt(i) & 0xff;
      body[i * 2 + 1] = text.charCodeAt(i) >> 8;
    }
    const book = await readWorkbook(plik(new Uint8Array([0xff, 0xfe, ...body]), "dane.txt"));
    expect(book.sheets[0]?.rows).toEqual([
      ["Kraj", "Udział"],
      ["Polska", "1,5"],
    ]);
    expect(book.problems).toEqual([]);
  });

  it("UTF-16BE z BOM i UTF-16LE bez BOM też są rozpoznane", () => {
    const be = new Uint8Array([0xfe, 0xff, 0x00, 0x41, 0x00, 0x3b, 0x00, 0x42]);
    expect(decodeTextBytes(be)).toEqual({ text: "A;B", encoding: "utf-16be", fallback: false });
    const le = new Uint8Array([0x41, 0x00, 0x3b, 0x00, 0x42, 0x00, 0x0a, 0x00]);
    expect(decodeTextBytes(le)).toEqual({ text: "A;B\n", encoding: "utf-16le", fallback: false });
  });
});

describe("limity procesu wracają jako problemy", () => {
  it("arkusz ponad limit wierszy dostaje `cellsTruncated` z dokładną liczbą", async () => {
    const rows = Array.from({ length: IMPORT_MAX_ROWS + 4 }, (_, i) => [`K${i}`, i]);
    const book = await readWorkbook(skoroszyt({ Dlugi: rows, Krotki: [["a", 1]] }));
    expect(book.sheets[0]?.problems).toEqual([{ code: "cellsTruncated", rows: 4, columns: 0 }]);
    expect(book.sheets[1]?.problems).toEqual([]);
  });

  it("skoroszyt ponad limit arkuszy dostaje `sheetsTruncated`", async () => {
    const arkusze: Record<string, unknown[][]> = {};
    for (let i = 0; i < IMPORT_MAX_SHEETS + 3; i += 1) arkusze[`A${i}`] = [["x", i]];
    const book = await readWorkbook(skoroszyt(arkusze));
    expect(book.sheets).toHaveLength(IMPORT_MAX_SHEETS);
    expect(book.problems).toEqual([{ code: "sheetsTruncated", dropped: 3 }]);
  });
});

describe("plik i schowek dają tę samą liczbę", () => {
  it("komórka procentowa z pliku wychodzi jak „12,5%” ze schowka: 12,5", async () => {
    const sheet = XLSX.utils.aoa_to_sheet([["Udział"], [0.125]]);
    sheet.A2.z = "0.0%";
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, "Dane");
    const bytes = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const book = await readWorkbook(new File([bytes], "dane.xlsx"));
    expect(book.sheets[0]?.rows[1]).toEqual(["12.5"]);
    expect(parseImportedNumber(book.sheets[0]?.rows[1]?.[0] ?? "")).toBe(
      parseImportedNumber("12,5%"),
    );
  });

  it("plik HTML idzie przez proces i NIE przetypowuje okresu ani procentu", async () => {
    const html =
      "<table><tr><td>Okres</td><td>Udział</td></tr><tr><td>2024-01</td><td>12,5%</td></tr></table>";
    const book = await readWorkbook(new File([html], "dane.html"));
    expect(h.calls).toBe(1);
    expect(book.sheets[0]?.rows).toEqual([
      ["Okres", "Udział"],
      ["2024-01", "12,5%"],
    ]);
  });

  // „25%" i „7%": plik (komórka 0,25 / 0,07 w formacie procentowym) i schowek
  // (Excel z `x:num`, Arkusze Google z `data-sheets-value`, LibreOffice
  // z `sdval`) dają 25 i 7 - a nie 0,25 z pliku ani 7,000000000000001
  // (0,07 · 100 w liczbach zmiennoprzecinkowych) z któregokolwiek.
  it("„25%” i „7%” dają 25 i 7 z pliku i z każdego schowka", async () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ["Kraj", "Udział"],
      ["PL", 0.25],
      ["DE", 0.07],
    ]);
    sheet.B2.z = "0%";
    sheet.B3.z = "0%";
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, "Dane");
    for (const bookType of ["xlsx", "xls", "ods"] as const) {
      const bytes = XLSX.write(wb, { type: "array", bookType }) as ArrayBuffer;
      const book = await readWorkbook(new File([bytes], `dane.${bookType}`));
      const z = tableToChartData(book.sheets[0]?.rows ?? []);
      expect(z.series[0]?.values, bookType).toEqual([25, 7]);
    }

    const excel =
      "<style>.xl65{mso-number-format:Percent;}</style><table>" +
      "<tr><td>Kraj</td><td>Udział</td></tr>" +
      '<tr><td>PL</td><td class=xl65 x:num="0.25">25%</td></tr>' +
      '<tr><td>DE</td><td class=xl65 x:num="7.0000000000000007E-2">7%</td></tr></table>';
    const sheets =
      "<table><tr><td>Kraj</td><td>Udział</td></tr>" +
      '<tr><td>PL</td><td data-sheets-value=\'{"1":3,"3":0.25}\' data-sheets-numberformat=\'{"1":3,"2":"0%"}\'>25%</td></tr>' +
      '<tr><td>DE</td><td data-sheets-value=\'{"1":3,"3":0.07}\' data-sheets-numberformat=\'{"1":3,"2":"0%"}\'>7%</td></tr></table>';
    const libre =
      "<table><tr><td>Kraj</td><td>Udział</td></tr>" +
      '<tr><td>PL</td><td sdval="0.25" sdnum="1045;0;0%">25%</td></tr>' +
      '<tr><td>DE</td><td sdval="0.07" sdnum="1045;0;0%">7%</td></tr></table>';
    for (const [name, html] of Object.entries({ excel, sheets, libre })) {
      const table = readClipboardTable({ html, text: "Kraj\tUdział\nPL\t25%\nDE\t7%" });
      expect(table?.source, name).toBe("html");
      const z = tableToChartData(table?.rows ?? []);
      expect(z.series[0]?.values, name).toEqual([25, 7]);
    }
    // Tekst bez HTML-a: „7%" to 7 wprost z napisu (procent nie dzieli przez sto).
    const text = readClipboardTable({ text: "Kraj\tUdział\nPL\t25%\nDE\t7%" });
    expect(tableToChartData(text?.rows ?? []).series[0]?.values).toEqual([25, 7]);
  });

  it("liczba z trzema miejscami po kropce wychodzi w zapisie, którego nie da się wziąć za tysiące", async () => {
    const book = await readWorkbook(skoroszyt({ Dane: [["Wartość"], [1.234]] }));
    expect(book.sheets[0]?.rows[1]).toEqual(["1.2340"]);
    expect(parseImportedNumber("1.2340", "pl")).toBe(1.234);
  });
});

describe("granica rozmiaru", () => {
  it("za duży plik nie trafia do procesu arkuszy", async () => {
    const big = new File([new Uint8Array(IMPORT_MAX_BYTES + 1)], "wielki.xlsx");

    await expect(readWorkbook(big)).rejects.toThrow("file too large");
    expect(h.calls).toBe(0);
  });
});
