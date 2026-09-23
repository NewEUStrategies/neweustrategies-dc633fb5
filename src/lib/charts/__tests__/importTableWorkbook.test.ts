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

const h = vi.hoisted(() => ({ calls: 0, refuse: false }));

vi.mock("@/lib/files/spreadsheetWorker", async () => {
  const core = await import("@/lib/files/spreadsheetCore");
  return {
    readSpreadsheetRowsInWorker: async (buffer: ArrayBuffer) => {
      h.calls += 1;
      if (h.refuse) throw new Error("spreadsheet:read-failed");
      return core.readSpreadsheetRows(buffer);
    },
  };
});

import { IMPORT_MAX_BYTES, readWorkbook } from "@/lib/charts/importTable";

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
      },
    ]);
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
    expect(book.sheets).toEqual([
      {
        name: "Dane",
        rows: [
          ["Kraj", "Wartość", "Aktywny"],
          ["PL", "1234.5", "1"],
          ["DE", "", "0"],
        ],
      },
    ]);
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

describe("granica rozmiaru", () => {
  it("za duży plik nie trafia do procesu arkuszy", async () => {
    const big = new File([new Uint8Array(IMPORT_MAX_BYTES + 1)], "wielki.xlsx");

    await expect(readWorkbook(big)).rejects.toThrow("file too large");
    expect(h.calls).toBe(0);
  });
});
