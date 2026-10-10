// KOSZT ODCZYTU JEST OGRANICZONY - wklejenie i import nie mrożą strony.
//
// `CLIPBOARD_MAX_CHARS` ogranicza długość schowka, ale nie pracę: dwuznaczne
// wzorce (liczba, okres, reguła CSS, nawiasy formatu) próbowały każdego
// podziału długiego ciągu znaków, a dociągnięcie wierszy do najszerszego
// budowało wysokość × szerokość komórek. Kilkanaście kilobajtów schowka to
// były sekundy albo setki megabajtów - w procedurze obsługi wklejenia, na
// wątku strony. Każda próbka niżej jest złośliwa i MAŁA, a odczyt ma być
// natychmiastowy.
import { describe, expect, it } from "vitest";
import { MAX_GRID_CELLS, readClipboardTable } from "@/lib/charts/clipboardTable";
import {
  isPeriodLabel,
  numberStyle,
  parseImportedNumber,
  readImportedNumber,
  tableToChartData,
} from "@/lib/charts/importTable";

/** Czas wykonania w milisekundach. */
function czas(f: () => void): number {
  const start = performance.now();
  f();
  return performance.now() - start;
}

/** Próg z dużym zapasem: poprawny odczyt to milisekundy, kwadrat - sekundy. */
const SZYBKO_MS = 1000;

describe("liczba i okres - długi napis nie jest czytany wzorcem", () => {
  const cyfry = `${"1".repeat(40_000)}x`;

  it("40 000 cyfr i litera: nie liczba, od razu", () => {
    expect(czas(() => expect(readImportedNumber(cyfry).status).toBe("invalid"))).toBeLessThan(
      SZYBKO_MS,
    );
    expect(czas(() => expect(numberStyle(cyfry)).toBeNull())).toBeLessThan(SZYBKO_MS);
  });

  it("długie liczby z życia dalej są liczbami", () => {
    expect(parseImportedNumber("-1 234 567 890 123,45 zł", "pl")).toBe(-1234567890123.45);
    expect(parseImportedNumber("1.7976931348623157E+308")).toBe(1.7976931348623157e308);
    expect(parseImportedNumber("12 345,6 bep", "pl")).toBe(12345.6);
  });

  it("okres z tysiącami spacji w środku: nie okres, od razu", () => {
    const s = `2024${" ".repeat(30_000)}x`;
    expect(czas(() => expect(isPeriodLabel(s)).toBe(false))).toBeLessThan(SZYBKO_MS);
    expect(isPeriodLabel("2024 Q1")).toBe(true);
  });

  it("wklejony TSV z taką komórką przechodzi do danych wykresu od razu", () => {
    const text = `Kraj\tWartość\nPL\t${cyfry}\nDE\t2`;
    const ms = czas(() => {
      const dane = tableToChartData(readClipboardTable({ text })?.rows ?? [], {});
      expect(dane.series[0]?.values).toEqual([null, 2]);
    });
    expect(ms).toBeLessThan(SZYBKO_MS);
  });
});

describe("schowek - prostokąt w limicie komórek", () => {
  it("tysiące pustych linii pod linią z tysiącami tabulatorów: limit, nie miliony komórek", () => {
    const n = 4000;
    const text = `${"\t".repeat(n)}x${"\n".repeat(n)}a`;
    let table: ReturnType<typeof readClipboardTable> = null;
    const ms = czas(() => {
      table = readClipboardTable({ text });
    });
    expect(table).not.toBeNull();
    const t = table as unknown as NonNullable<ReturnType<typeof readClipboardTable>>;
    expect(t.cells).toBeLessThanOrEqual(MAX_GRID_CELLS);
    expect(t.truncated).toBe(true);
    // Zostaje początek: pierwszy wiersz z „x" na końcu.
    expect(t.rows[0]?.[n]).toBe("x");
    expect(ms).toBeLessThan(SZYBKO_MS);
  });

  it("tabela w limicie zostaje cała i nieoznaczona", () => {
    const text = Array.from({ length: 300 }, (_, i) => `K${i}\t${i}`).join("\n");
    const table = readClipboardTable({ text });
    expect(table?.rows).toHaveLength(300);
    expect(table?.truncated).toBe(false);
  });
});

describe("schowek HTML - style i formaty bez kwadratu", () => {
  it("arkusz stylów z tysiącami niedomkniętych reguł", () => {
    const html =
      `<style>${".a{".repeat(20_000)}</style>` + "<table><tr><td>a</td><td>b</td></tr></table>";
    let rows: string[][] | undefined;
    const ms = czas(() => {
      rows = readClipboardTable({ html })?.rows;
    });
    expect(rows).toEqual([["a", "b"]]);
    expect(ms).toBeLessThan(SZYBKO_MS);
  });

  it("kod formatu z dziesiątkami tysięcy nawiasów", () => {
    const html =
      `<table><tr><td>a</td><td style='mso-number-format:"${"[".repeat(30_000)}"' x:num="5">5</td>` +
      "</tr></table>";
    let rows: string[][] | undefined;
    const ms = czas(() => {
      rows = readClipboardTable({ html })?.rows;
    });
    expect(rows).toEqual([["a", "5"]]);
    expect(ms).toBeLessThan(SZYBKO_MS);
  });

  it("klasy Excela dalej dają format: data z klasy zostaje tekstem", () => {
    const html =
      '<style>td {padding:1px;} .xl65 {mso-number-format:"Short Date";} .p, .xl66\n\t{mso-number-format:Percent;}</style>' +
      '<table><tr><td class=xl65 x:num="45306">15.01.2024</td><td class=xl66 x:num="0.07">7%</td>' +
      '<td class=xl66 x:num="0.125">12,5%</td></tr></table>';
    expect(readClipboardTable({ html })?.rows).toEqual([["15.01.2024", "7%", "12.5"]]);
  });
});
