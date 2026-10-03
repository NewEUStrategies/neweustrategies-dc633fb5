// GENERATOR PDF FAKTURY - STRUKTURA PLIKU I ZNAKI SPOZA KODOWANIA.
//
// `invoicePdf.test.ts` dowodzi sum, formatu kwot i ucieczki nawiasów. Ten plik
// pilnuje tego, co psuje dokument PO CICHU - plik się pobiera, ale księgowość
// dostaje coś innego niż powinna:
//
//  * ZNAK, KTÓREGO FONT NIE NARYSUJE (nazwa firmy z `Ĩ` spoza Latin-1, emoji
//    w adresie, znak nowej linii wklejony do pola adresu), musi zostać
//    zastąpiony `?`. Litery Latin-1 (é, ü, ß) font narysuje, a € zapisujemy
//    jako `EUR` - żadne z nich nie może przepaść ani podszyć się pod polski
//    glif.
//    Generator zapisuje bajty jako `charCode & 0xff`, więc np. `ĩ` (U+0129)
//    bez zastąpienia zostałby bajtem 0x29 - czyli `)` - i zamknąłby literał
//    tekstowy PDF w połowie nazwy nabywcy. Plik z takim strumieniem otwiera
//    się z ucięciem albo wcale.
//  * POLE BEZ WARTOŚCI nie zostawia pustej etykiety („NIP: " bez numeru).
//  * NOTA o rozliczeniu podatku przez operatora trafia pod tabelę i jest
//    przycinana do jednej linii, a jej brak nie zostawia pustego wiersza.
//  * BASE64 do transportu jest identyczny niezależnie od tego, czy środowisko
//    ma `btoa` (Worker, przeglądarka), czy tylko `Buffer` (Node).
//
// Moduł jest czysty - bez atrap; asercje czytają gotowe bajty pliku.
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  encodePdfText,
  formatInvoiceMoney,
  pdfToBase64,
  renderInvoicePdf,
  type InvoiceData,
} from "@/lib/billing/invoicePdf";

function invoice(overrides: Partial<InvoiceData> = {}): InvoiceData {
  return {
    number: "FV/7/2099",
    issuedAt: "dzień wystawienia",
    currency: "PLN",
    seller: { name: "Fundacja Syntetyczna" },
    buyer: { name: "Nabywca Syntetyczny", taxId: "PL1130000000", email: "kupujacy@example.com" },
    lines: [{ description: "Pozycja", quantity: 1, amountCents: 4900 }],
    labels: {
      title: "Faktura",
      number: "Numer",
      issuedAt: "Data",
      seller: "Sprzedawca",
      buyer: "Nabywca",
      taxId: "NIP",
      description: "Opis",
      quantity: "Ilość",
      amount: "Kwota",
      total: "Razem",
      paid: "Zapłacono",
    },
    ...overrides,
  };
}

function latin1(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("latin1");
}

/** Strumień treści strony (obiekt 4) razem z zadeklarowaną długością. */
function contentStream(pdf: string): { declared: number; body: string } {
  const match = /4 0 obj\n<< \/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/.exec(pdf);
  if (!match) throw new Error("test: brak strumienia treści w pliku");
  return { declared: Number(match[1]), body: match[2] ?? "" };
}

/** Każda operacja tekstowa strumienia musi być domkniętym literałem `(...) Tj ET`. */
function textOps(body: string): string[] {
  return body.split("\n").filter((op) => op.startsWith("BT "));
}

describe("encodePdfText - znaki, których font nie narysuje", () => {
  it("znak sterujący z pola adresu staje się `?` - literał zostaje w jednej linii", () => {
    expect(encodePdfText("ul. Długa 1\nlok. 2\tB")).toBe("ul. D\\203uga 1?lok. 2?B");
  });

  it("emoji (para surogatów) to JEDEN znak zapytania, nie dwa", () => {
    expect(encodePdfText("Firma 😀 SA")).toBe("Firma ? SA");
  });

  it("znak, którego młodszy bajt to `)` albo `\\`, nie domyka literału przedwcześnie", () => {
    // U+0129 & 0xff = 0x29 `)`, U+015C & 0xff = 0x5C `\`.
    expect(encodePdfText("Ĩĩ Ŝ")).toBe("?? ?");
  });

  it("znak sterujący C1 (U+0080-U+009F) to `?`, a nie bajt przejęty przez polski glif", () => {
    // Kody 0x80-0x8F są w /Differences przemapowane na ą..Ż - surowy bajt
    // wydrukowałby polską literę zamiast niewidocznego znaku z wklejki.
    expect(encodePdfText("A\u0080B\u0085C\u009fD")).toBe("A?B?C?D");
  });
});

describe("encodePdfText - znaki, które font narysuje", () => {
  it("litery Latin-1 z nazw zagranicznych firm drukują się jako one same, nie `?`", () => {
    // WinAnsi w zakresie 0xA0-0xFF pokrywa się z Latin-1, a /Differences tego
    // zakresu nie rusza - tak samo działa od zawsze `ó` (0xF3 = \363).
    expect(encodePdfText("Société Générale Müller GmbH")).toBe(
      "Soci\\351t\\351 G\\351n\\351rale M\\374ller GmbH",
    );
    expect(encodePdfText("Straße Çà ñ Ø")).toBe("Stra\\337e \\307\\340 \\361 \\330");
  });

  it("znak euro nie drukuje się jako `ą` - kod 0x80 zajmuje polski glif", () => {
    const encoded = encodePdfText("100 €");

    expect(encoded).toBe("100 EUR");
    expect(encoded).not.toBe(encodePdfText("100 ą"));
  });
});

describe("formatInvoiceMoney - kwoty korekt i duże kwoty", () => {
  it("nota korygująca ma minus przed kwotą, a grosze się nie gubią", () => {
    expect(formatInvoiceMoney(-4905, "pln")).toBe("-49,05 PLN");
  });

  it("tysiące są grupowane spacją, kod waluty wielkimi literami", () => {
    expect(formatInvoiceMoney(123456789, "eur")).toBe("1 234 567,89 EUR");
  });
});

describe("renderInvoicePdf - strumień treści", () => {
  it("nazwa nabywcy spoza kodowania nie rozrywa strumienia, a długość zgadza się z treścią", () => {
    const pdf = latin1(renderInvoicePdf(invoice({ buyer: { name: "Ĩnvest ĩ Spółka\n😀" } })));
    const { declared, body } = contentStream(pdf);

    expect(body.length).toBe(declared);
    expect(body).toContain("(?nvest ? Sp\\363\\203ka??) Tj ET");
    for (const op of textOps(body)) {
      // Jedyny nawias zamykający poza ucieczką to ten kończący literał.
      expect(op.replace(/\\[()\\]/g, "")).toMatch(
        /^BT \/F[12] \d+ Tf 1 0 0 1 [\d.]+ \d+ Tm \([^()]*\) Tj ET$/,
      );
    }
  });

  it("nabywca z literami Latin-1 trafia do pliku pod kodami WinAnsi, a strumień zostaje spójny", () => {
    const pdf = latin1(renderInvoicePdf(invoice({ buyer: { name: "Müller & Söhne – Café €" } })));
    const { declared, body } = contentStream(pdf);

    expect(body.length).toBe(declared);
    // Myślnik U+2013 leży poza Latin-1 i poza naszą tablicą - zostaje `?`.
    expect(body).toContain("(M\\374ller & S\\366hne ? Caf\\351 EUR) Tj ET");
    // Zakres 0xA0-0xFF nie jest przemapowany - glif bierze się z WinAnsi.
    expect(pdf).toContain("/BaseEncoding /WinAnsiEncoding /Differences [ 128 /aogonek");
    expect(pdf).not.toMatch(/\/Differences \[[^\]]*\b(1[6-9]\d|2[0-5]\d) \//);
  });

  it("strona bez NIP nie dostaje pustej etykiety - wiersz NIP ma tylko nabywca", () => {
    const pdf = latin1(
      renderInvoicePdf(invoice({ seller: { name: "Fundacja Syntetyczna", taxId: null } })),
    );
    const taxRows = textOps(contentStream(pdf).body).filter((op) => op.includes("(NIP"));

    expect(taxRows).toEqual([expect.stringContaining("1 0 0 1 320 ")]);
    expect(taxRows[0]).toContain("(NIP: PL1130000000)");
  });

  it("nota trafia pod tabelę jako jedna linia przycięta do 110 znaków", () => {
    const note = `${"Podatek rozlicza operator. ".repeat(4)}KONIEC-NOTY`;
    const body = contentStream(latin1(renderInvoicePdf(invoice({ note })))).body;
    const noteOps = textOps(body).filter((op) => op.startsWith("BT /F1 8 Tf"));

    expect(noteOps).toHaveLength(1);
    expect(noteOps[0]).toContain(`(${note.slice(0, 110)})`);
    expect(body).not.toContain("KONIEC-NOTY");
  });

  it("długi opis pozycji jest przycinany do 58 znaków - nie wchodzi na kolumnę ilości", () => {
    const description = `${"Członkostwo roczne ".repeat(3)}OGON-OPISU`;
    const body = contentStream(
      latin1(
        renderInvoicePdf(invoice({ lines: [{ description, quantity: 1, amountCents: 4900 }] })),
      ),
    ).body;
    const lineOps = textOps(body).filter((op) => op.startsWith("BT /F1 9 Tf 1 0 0 1 56 "));

    expect(lineOps).toEqual([
      expect.stringContaining(`(${encodePdfText(description.slice(0, 58))})`),
    ]);
    expect(body).not.toContain("OGON-OPISU");
  });

  it("bez noty nie ma wiersza noty", () => {
    const body = contentStream(latin1(renderInvoicePdf(invoice({ note: null })))).body;

    expect(textOps(body).filter((op) => op.startsWith("BT /F1 8 Tf"))).toEqual([]);
  });
});

describe("pdfToBase64 - transport niezależny od środowiska", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("bez globalnego btoa (Node) koduje przez Buffer - wynik identyczny bajt w bajt", () => {
    const bytes = renderInvoicePdf(invoice({ note: "Zażółć gęślą jaźń" }));
    const viaBtoa = pdfToBase64(bytes);

    vi.stubGlobal("btoa", undefined);
    const viaBuffer = pdfToBase64(bytes);

    expect(typeof globalThis.btoa).toBe("undefined");
    expect(viaBuffer).toBe(viaBtoa);
    expect(Buffer.from(viaBuffer, "base64").equals(Buffer.from(bytes))).toBe(true);
  });
});
