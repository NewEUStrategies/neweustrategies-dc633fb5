// Wejście PROCESU arkuszy (`spreadsheet.worker.ts`) - jedyne miejsce w aplikacji,
// w którym żyje `xlsx`. Do dziś: 0 z 5 linii; transport po stronie strony
// (`spreadsheetWorker.ts`) i rdzeń (`spreadsheetCore.ts`) miały testy, a sklejka
// między nimi - `self.onmessage` - nie miała żadnego.
//
// TRZY REGUŁY, KTÓRYCH ZŁAMANIE KOSZTUJE:
//
//   1. SUKCES TO `{ ok: true, result }` Z WYNIKIEM RDZENIA. Strona rozpakowuje
//      dokładnie ten kształt (`event.data.ok` -> `event.data.result`); każde
//      inne opakowanie rozstrzyga obietnicę eksportu wartością `undefined`.
//   2. ODMOWA TO SAMO `{ ok: false }` - BEZ SZCZEGÓŁÓW BIBLIOTEKI. Podgląd
//      dotyczy CUDZEGO pliku z załącznika; komunikat SheetJS (ścieżki w ZIP,
//      fragmenty XML) nie ma prawa dojechać do UI. Strona sama dobiera
//      komunikat po operacji (`spreadsheet:preview-unavailable` itd.).
//   3. JEDNO ZLECENIE = JEDNA ODPOWIEDŹ. Strona kończy proces po pierwszej
//      wiadomości; druga trafiłaby w zakończony proces, brak - w termin.
//
// JAK TO BIEGNIE BEZ WORKERA. Pod happy-dom `self` to `window`, więc import
// modułu podpina handler pod `window.onmessage`. `postMessage` jest SZPIEGIEM
// z pustą implementacją - prawdziwe `window.postMessage` odesłałoby odpowiedź
// jako NOWE zdarzenie `message` do tego samego handlera (pętla).
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - LIMITÓW I KSZTAŁTU WYNIKU RDZENIA: `spreadsheetCore.test.ts`.
// - TERMINÓW, PRZERWANIA I SPRZĄTANIA PROCESU: `spreadsheetWorker.test.ts`.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import {
  SPREADSHEET_MAX_BYTES,
  type SpreadsheetRequest,
  type SpreadsheetResponse,
} from "../spreadsheetProtocol";

let posted: unknown[] = [];

beforeAll(async () => {
  await import("../spreadsheet.worker");
});

afterEach(() => {
  vi.restoreAllMocks();
  posted = [];
});

/** Wysyła zlecenie do handlera procesu i oddaje WSZYSTKIE odpowiedzi. */
function send(request: SpreadsheetRequest): unknown[] {
  vi.spyOn(self, "postMessage").mockImplementation((message: unknown) => {
    posted.push(message);
  });
  const handler = self.onmessage;
  if (!handler) throw new Error("test: moduł procesu nie podpiął `self.onmessage`");
  handler.call(self, new MessageEvent("message", { data: request }));
  return posted;
}

function isSuccess(value: unknown): value is Extract<SpreadsheetResponse<"write">, { ok: true }> {
  return typeof value === "object" && value !== null && "ok" in value && value.ok === true;
}

describe("proces arkuszy - wejście `self.onmessage`", () => {
  it("eksport odpowiada `{ ok: true, result }` z bajtami PRAWDZIWEGO pliku .xlsx", () => {
    // REGUŁA 1. Bajty czytamy z powrotem tą samą biblioteką - dowód, że
    // w `result` jest skoroszyt, a nie dowolna wartość w dobrym opakowaniu.
    const replies = send({
      op: "write",
      sheetName: "Leady",
      rows: [
        ["Imię", "E-mail"],
        ["Ewa", "ewa@example.com"],
      ],
    });

    expect(replies).toHaveLength(1);
    const [reply] = replies;
    if (!isSuccess(reply)) throw new Error("test: proces nie odpowiedział sukcesem");
    expect(reply.result).toBeInstanceOf(ArrayBuffer);
    const book = XLSX.read(reply.result, { type: "array" });
    expect(book.SheetNames).toEqual(["Leady"]);
    expect(XLSX.utils.sheet_to_json(book.Sheets.Leady, { header: 1 })).toEqual([
      ["Imię", "E-mail"],
      ["Ewa", "ewa@example.com"],
    ]);
  });

  it("odmowa rdzenia (podgląd ponad limit) to SAMO `{ ok: false }`, bez szczegółów", () => {
    // REGUŁA 2. Rdzeń rzuca `spreadsheet:file-limit`; ta nazwa, ani żaden
    // komunikat biblioteki, nie może przejść granicy procesu.
    const replies = send({ op: "preview", buffer: new ArrayBuffer(SPREADSHEET_MAX_BYTES + 1) });

    expect(replies).toEqual([{ ok: false }]);
    expect(JSON.stringify(replies)).not.toContain("spreadsheet:");
  });

  it("jedno zlecenie daje DOKŁADNIE jedną odpowiedź - także po odmowie", () => {
    // REGUŁA 3. Odpowiedź wysłana dwa razy (np. w `try` i po `catch`)
    // trafiłaby w proces, który strona już zakończyła.
    const ok = send({ op: "write", sheetName: "A", rows: [["x"]] }).length;
    posted = [];
    const refused = send({ op: "rows", buffer: new ArrayBuffer(SPREADSHEET_MAX_BYTES + 1) }).length;

    expect([ok, refused]).toEqual([1, 1]);
  });
});
