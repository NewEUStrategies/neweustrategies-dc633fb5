// PLIK HTML (html, htm) - bajty dekoduje strona, tabelę czyta `readClipboardTable`.
//
// Do 2026-10 plik HTML szedł do procesu arkuszy, a ten brał jego bajty za
// UTF-8 i rozwiązywał tylko kilka encji nazwanych. „Strona sieci Web"
// polskiego Excela (Windows-1250, zadeklarowane w `<meta>`) wracała jako
// „Warto��" i „W�gry", a „&#321;&oacute;d&#378;" - jako tekst encji. Oba
// bez zgłoszenia, więc zepsute kategorie i nierozpoznane kraje szły dalej.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ calls: 0 }));

vi.mock("@/lib/files/spreadsheetWorker", async () => {
  const core = await import("@/lib/files/spreadsheetCore");
  return {
    readSpreadsheetRowsInWorker: async (
      buffer: ArrayBuffer,
      options?: { chartImport?: boolean },
    ) => {
      h.calls += 1;
      return core.readSpreadsheetRows(buffer, { chartImport: options?.chartImport });
    },
  };
});

import { decodeHtmlBytes, readWorkbook } from "@/lib/charts/importTable";
import { CLIPBOARD_MAX_CHARS } from "@/lib/charts/clipboardTable";
import { IMPORT_MAX_ROWS } from "@/lib/files/spreadsheetProtocol";

/** Polskie litery w Windows-1250 - tylko te, których używają próbki. */
const CP1250: Record<string, number> = {
  ć: 0xe6,
  ę: 0xea,
  ł: 0xb3,
  ó: 0xf3,
  ś: 0x9c,
  ź: 0x9f,
  Ł: 0xa3,
};

function windows1250(s: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(Array.from(s, (ch) => CP1250[ch] ?? ch.charCodeAt(0)));
}

function plik(bytes: Uint8Array<ArrayBuffer>, name: string): File {
  return new File([bytes], name);
}

const TABELA =
  "<table><tr><td>Kraj</td><td>Wartość</td></tr>" +
  "<tr><td>Węgry</td><td>1,5</td></tr><tr><td>Łódź</td><td>2</td></tr></table>";

const OCZEKIWANE = [
  ["Kraj", "Wartość"],
  ["Węgry", "1,5"],
  ["Łódź", "2"],
];

beforeEach(() => {
  h.calls = 0;
});

describe("plik HTML - kodowanie", () => {
  it("Windows-1250 zadeklarowane w `<meta>` (Excel: Strona sieci Web) daje polskie znaki bez zgłoszenia", async () => {
    const html =
      '<html><head><meta http-equiv=Content-Type content="text/html; charset=windows-1250">' +
      `</head><body>${TABELA}</body></html>`;
    const book = await readWorkbook(plik(windows1250(html), "dane.htm"));
    expect(book.sheets).toHaveLength(1);
    expect(book.sheets[0]?.rows).toEqual(OCZEKIWANE);
    // Deklaracja to nie zgadywanie - nie ma czego zgłaszać.
    expect(book.problems).toEqual([]);
    // Plik HTML nie dotyka procesu arkuszy.
    expect(h.calls).toBe(0);
  });

  it("Windows-1250 BEZ deklaracji: ścisły UTF-8 odmawia, odczyt zastępczy jest zgłaszany", async () => {
    const book = await readWorkbook(
      plik(windows1250(`<html><body>${TABELA}</body></html>`), "dane.html"),
    );
    expect(book.sheets[0]?.rows).toEqual(OCZEKIWANE);
    expect(book.problems).toEqual([{ code: "encodingFallback", encoding: "windows-1250" }]);
  });

  it("UTF-8 z encjami liczbowymi i nazwanymi - encje rozwiązane", async () => {
    const html =
      '<meta charset="utf-8"><table><tr><td>Kraj</td><td>Wartość</td></tr>' +
      "<tr><td>W&#281;gry</td><td>1</td></tr>" +
      "<tr><td>&#321;&oacute;d&#378;</td><td>2</td></tr>" +
      "<tr><td>&#x141;</td><td>3</td></tr></table>";
    const book = await readWorkbook(plik(new TextEncoder().encode(html), "dane.html"));
    expect(book.sheets[0]?.rows).toEqual([
      ["Kraj", "Wartość"],
      ["Węgry", "1"],
      ["Łódź", "2"],
      ["Ł", "3"],
    ]);
    expect(book.problems).toEqual([]);
  });

  it("BOM wygrywa z deklaracją, deklaracja z odczytem UTF-8", () => {
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("Łódź")]);
    expect(decodeHtmlBytes(bom)).toEqual({ text: "Łódź", fallback: false });
    // „cp1250" to etykieta Windows-1250 - przeglądarka zna obie nazwy.
    const meta = windows1250('<meta charset="cp1250">Łódź');
    expect(decodeHtmlBytes(meta)).toEqual({ text: '<meta charset="cp1250">Łódź', fallback: false });
    // Nieznana nazwa kodowania: zostaje UTF-8.
    const nieznane = new TextEncoder().encode('<meta charset="x-nic">Łódź');
    expect(decodeHtmlBytes(nieznane)).toEqual({
      text: '<meta charset="x-nic">Łódź',
      fallback: false,
    });
  });
});

describe("plik HTML - ta sama reguła co schowek", () => {
  it("surowa wartość i procent jak przy wklejeniu z Excela", async () => {
    const html =
      '<style>.p{mso-number-format:"0\\.0%";}</style><table>' +
      "<tr><td>Kraj</td><td>Kwota</td><td>Udział</td></tr>" +
      '<tr><td>PL</td><td x:num="1234.5">1 234,50</td><td class=p x:num="0.125">12,5%</td></tr></table>';
    const book = await readWorkbook(plik(new TextEncoder().encode(html), "dane.html"));
    expect(book.sheets[0]?.rows).toEqual([
      ["Kraj", "Kwota", "Udział"],
      ["PL", "1234.5", "12.5"],
    ]);
  });

  it("wiersze ponad limit odczytu są pominięte i policzone, jak w procesie arkuszy", async () => {
    const wiersze = Array.from(
      { length: IMPORT_MAX_ROWS + 5 },
      (_, i) => `<tr><td>K${i}</td><td>${i}</td></tr>`,
    ).join("");
    const book = await readWorkbook(
      plik(new TextEncoder().encode(`<table>${wiersze}</table>`), "dane.html"),
    );
    expect(book.sheets[0]?.rows).toHaveLength(IMPORT_MAX_ROWS);
    expect(book.sheets[0]?.problems).toEqual([{ code: "cellsTruncated", rows: 5, columns: 0 }]);
  });

  it("strona dłuższa niż limit parsera: początek do pełnego wiersza, reszta policzona", async () => {
    // Trzy wiersze, komentarz ponad limit i cztery wiersze za nim: czytane są
    // trzy pierwsze, a cztery dalsze wracają jako pominięte.
    const wiersz = (i: number) => `<tr><td>K${i}</td><td>${i}</td></tr>`;
    const html =
      `<table>${[1, 2, 3].map(wiersz).join("")}<!--${"x".repeat(CLIPBOARD_MAX_CHARS)}-->` +
      `${[4, 5, 6, 7].map(wiersz).join("")}</table>`;
    const book = await readWorkbook(plik(new TextEncoder().encode(html), "dane.html"));
    expect(book.sheets[0]?.rows).toEqual([
      ["K1", "1"],
      ["K2", "2"],
      ["K3", "3"],
    ]);
    expect(book.sheets[0]?.problems).toEqual([{ code: "cellsTruncated", rows: 4, columns: 0 }]);
  });

  it("strona bez tabeli to arkusz bez wierszy (kontrolka mówi wtedy „plik nie zawiera danych”)", async () => {
    const book = await readWorkbook(plik(new TextEncoder().encode("<p>akapit</p>"), "dane.html"));
    expect(book.sheets).toEqual([{ name: "dane.html", rows: [], problems: [] }]);
  });
});
