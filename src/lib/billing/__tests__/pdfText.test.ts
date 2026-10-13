// KODOWANIE GLIFÓW PDF (`pdfText.ts`) - audyt INV-19b.
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW. Dawny generator znał WinAnsi
// i 16 polskich glifów, a każdy inny znak drukował jako `?`: „Kovács Kft. /
// Dvořák s.r.o." trafiało na dokument jako „Kovács Kft. / Dvo?ák s.r.o.",
// litewski bank i rumuńska spółka podobnie. Kryterium audytu: PDF obu
// rendererów z taką nazwą nabywcy nie ma `?` w operatorach tekstu, a nazwy
// glifów stoją w /Differences. Dowodzimy więcej: niezależny dekoder
// (`src/test/billing/pdfTextDecoder.ts`) czyta plik jak czytnik - font z `Tf`,
// kod z /Differences, glif z Adobe Glyph List - i odzyskuje DOKŁADNIE nazwę.
//
// Moduł jest czysty - bez atrap.
import { describe, expect, it } from "vitest";

import { renderInvoicePdf, type InvoiceData } from "@/lib/billing/invoicePdf";
import {
  encodePdfText,
  PDF_FONT_COUNT,
  pdfFontObjects,
  pdfFontResources,
  pdfTextOp,
  pdfTextRuns,
} from "@/lib/billing/pdfText";
import { parseInvoiceDocument } from "@/lib/events/eventInvoiceDocument";
import { renderEventInvoicePdf, type EventInvoicePdfLabels } from "@/lib/events/eventInvoicePdf";
import { aglForm, decodePdfTexts, pdfTextLiterals } from "@/test/billing/pdfTextDecoder";
import { invoiceDocumentJson } from "@/test/events/invoiceFixtures";

/** Nazwy nabywców z audytu i z rynków, których dotyczy zestaw Helvetiki. */
const BUYERS = [
  "Kovács Kft. / Dvořák s.r.o.",
  "Šiaulių bankas",
  "Țară SRL",
  "Ţară Veche SRL",
  "Zażółć gęślą jaźń Sp. z o.o.",
  "Őrség Kft. – Űrhajó",
  "Ģirts Ķeniņš SIA",
  "İstanbul Ağ Ltd. Şti.",
  "Đurđević d.o.o.",
] as const;

function latin1(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("latin1");
}

function billingPdf(buyer: string): string {
  const data: InvoiceData = {
    number: "FV/1/2099",
    issuedAt: "2099-01-01",
    currency: "EUR",
    seller: { name: "Fundacja Syntetyczna", city: "Kraków" },
    buyer: { name: buyer, city: "Brno", email: "kupujacy@example.com" },
    lines: [{ description: "Bilet na wydarzenie", quantity: 1, amountCents: 4900 }],
    status: "paid",
    labels: {
      title: "Potwierdzenie płatności",
      number: "Numer",
      issuedAt: "Data",
      seller: "Sprzedawca",
      buyer: "Nabywca",
      taxId: "NIP",
      description: "Opis",
      quantity: "Ilość",
      amount: "Kwota",
      total: "Razem",
      status: { paid: "Zapłacono", open: "Otwarte", void: "Unieważnione", refunded: "Zwrócono" },
    },
    note: "Nota testowa.",
  };
  return latin1(renderInvoicePdf(data));
}

const EVENT_LABELS: EventInvoicePdfLabels = {
  title: "Faktura VAT",
  draftTitle: "Szkic",
  number: "Nr",
  issueDate: "Data wystawienia",
  saleDate: "Data sprzedaży",
  dueDate: "Termin płatności",
  paymentMethod: "Sposób płatności",
  paymentMethodValue: "przelew",
  seller: "Sprzedawca",
  buyer: "Nabywca",
  recipient: "Odbiorca",
  taxId: "NIP",
  bankAccount: "Rachunek",
  swift: "SWIFT",
  event: "Wydarzenie",
  poNumber: "Nr zamówienia",
  columns: {
    lp: "Lp.",
    name: "Nazwa",
    unit: "J.m.",
    quantity: "Ilość",
    unitGross: "Cena jedn. brutto",
    net: "Netto",
    rate: "VAT",
    vat: "Kwota VAT",
    gross: "Brutto",
  },
  rates: { "23": "23%", "8": "8%", "5": "5%", "0": "0%", zw: "zw", np: "np" },
  vatSummary: "Podsumowanie VAT",
  total: "Razem",
  toPay: "Do zapłaty",
  paid: "Zapłacono",
  toRefund: "Do zwrotu",
  refunded: "Zwrócono",
  correctsLine: "Korekta",
  correctionReason: "Przyczyna",
  exemptBasis: "Podstawa zwolnienia",
  correctsKsefNumber: "Numer KSeF faktury korygowanej",
  npBasis: "Podstawa np",
  reverseCharge: "odwrotne obciążenie",
  vatPln: "VAT w PLN",
  fxLine: "",
  ksefNumber: "Numer KSeF",
  cancelled: "ANULOWANY",
  proformaNote: "Proforma",
  page: (page, pages) => `Strona ${page}/${pages}`,
  fileStem: "faktura",
};

function eventPdf(buyer: string): string {
  const doc = parseInvoiceDocument(invoiceDocumentJson({ invoice: { buyer_name: buyer } }));
  if (doc === null) throw new Error("test: fixture faktury wydarzenia");
  return latin1(renderEventInvoicePdf(doc, EVENT_LABELS));
}

describe.each([
  ["potwierdzenie płatności (invoicePdf)", billingPdf],
  ["faktura wydarzenia (eventInvoicePdf)", eventPdf],
])("nazwy spoza Latin-1 w PDF: %s", (_label, render) => {
  it.each(BUYERS)('„%s" bez `?` w operatorach tekstu i odczytana dosłownie', (buyer) => {
    const pdf = render(buyer);

    for (const literal of pdfTextLiterals(pdf)) expect(literal).not.toContain("?");
    expect(decodePdfTexts(pdf)).toContain(aglForm(buyer));
  });

  it("glify z nazw stoją w /Differences fontów dokumentu", () => {
    const pdf = render(BUYERS.join(" "));
    const differences = [...pdf.matchAll(/\/Differences \[ ([^\]]*) \]/g)]
      .map((match) => match[1])
      .join(" ");

    for (const glyph of ["rcaron", "uogonek", "Tcommaaccent", "abreve", "Ohungarumlaut"]) {
      expect(differences.split(" ")).toContain(`/${glyph}`);
    }
    expect(pdf.match(/\/Type \/Font /g)).toHaveLength(PDF_FONT_COUNT);
  });
});

describe("pdfTextRuns - podział napisu między kodowania", () => {
  it("polski i czeski tekst to JEDEN odcinek w kodowaniu podstawowym (F1/F2)", () => {
    expect(pdfTextRuns("Zażółć gęślą jaźń - Dvořák, Žluťoučký kůň")).toEqual([
      { encoding: 0, literal: encodePdfText("Zażółć gęślą jaźń - Dvořák, Žluťoučký kůň") },
    ]);
  });

  it("napis mieszczący się w jednym kodowaniu nie przełącza fontu, nawet poza podstawowym", () => {
    const runs = pdfTextRuns("Šiaulių bankas");

    expect(runs).toHaveLength(1);
    expect(runs[0].encoding).toBeGreaterThan(0);
  });

  it("napis z liter z dwóch kodowań dzieli się na odcinki, ASCII nie wymusza przełączenia", () => {
    const runs = pdfTextRuns("Łódź / Šiaulių");

    expect(runs.map((run) => run.encoding)).toEqual([0, runs[1].encoding]);
    expect(runs[1].encoding).toBeGreaterThan(0);
  });

  it("pusty napis to jeden pusty odcinek (operacja `() Tj` jak dotąd)", () => {
    expect(pdfTextRuns("")).toEqual([{ encoding: 0, literal: "" }]);
  });
});

describe("pdfTextOp - operacja tekstowa", () => {
  it("pierwszy odcinek ustawia font przed macierzą, kolejne przełączają font w tym samym BT", () => {
    const op = pdfTextOp(56, 700, "Łódź / Šiaulių", 9);

    expect(op).toMatch(
      /^BT \/F1 9 Tf 1 0 0 1 56 700 Tm \([^)]*\) Tj \/F[35] 9 Tf \([^)]*\) Tj ET$/,
    );
    expect(decodePdfTexts(`${pdfFontObjectsForDecoder()}\n${op}`)).toEqual(["Łódź / Šiaulių"]);
  });

  it("pogrubienie wybiera parzysty font tego samego kodowania", () => {
    expect(pdfTextOp(0, 0, "Ąę", 10, true)).toMatch(/^BT \/F2 10 Tf /);
    expect(pdfTextOp(0, 0, "ų", 10, true)).toMatch(/^BT \/F[46] 10 Tf /);
  });
});

/** Słowniki fontów i zasób `/Font` w postaci, jaką czyta dekoder testowy. */
function pdfFontObjectsForDecoder(): string {
  const objects = pdfFontObjects().map((body, index) => `${index + 1} 0 obj\n${body}\nendobj`);
  return `${objects.join("\n")}\n/Font ${pdfFontResources(1)}`;
}

describe("znaki spoza wszystkich kodowań", () => {
  it("litera ze znakiem łączącym (zapis NFD z wklejki) drukuje się jako jedna litera", () => {
    expect(encodePdfText("Café")).toBe("Caf\\351");
  });

  it("brak glifu: zrzucamy znaki diakrytyczne od końca, zanim padnie `?`", () => {
    // ễ = e + daszek + tylda -> ê (Latin-1); ǘ -> ü; Ĩ -> I.
    expect(encodePdfText("Nguyễn")).toBe("Nguy\\352n");
    expect(encodePdfText("ǘ")).toBe("\\374");
    expect(encodePdfText("Ĩ")).toBe("I");
  });

  it("osierocony znak łączący znika - jego litera już się wydrukowała", () => {
    expect(encodePdfText("q́")).toBe("q");
  });

  it("pismo bez litery łacińskiej i znaki sterujące to `?` - nigdy surowy bajt 0x01-0x1F", () => {
    // Kody 0x01-0x1F niosą tu glify (ą, ć, ...): surowy `\n` wydrukowałby literę.
    expect(encodePdfText("Москва")).toBe("??????");
    for (let code = 0; code < 0x20; code += 1) {
      expect(encodePdfText(String.fromCharCode(code))).toBe("?");
    }
    expect(encodePdfText("\u007f")).toBe("?");
  });
});

describe("pdfFontObjects / pdfFontResources", () => {
  it("para Helvetica / Helvetica-Bold na każde kodowanie, każde na bazie WinAnsi", () => {
    const objects = pdfFontObjects();

    expect(objects).toHaveLength(PDF_FONT_COUNT);
    objects.forEach((body, index) => {
      expect(body).toContain(
        index % 2 === 0 ? "/BaseFont /Helvetica " : "/BaseFont /Helvetica-Bold ",
      );
      expect(body).toContain("/BaseEncoding /WinAnsiEncoding /Differences [ ");
    });
  });

  it("zasób `/Font` nazywa fonty F1..Fn kolejnymi obiektami od podanego numeru", () => {
    expect(pdfFontResources(5)).toBe(
      `<< ${Array.from({ length: PDF_FONT_COUNT }, (_u, i) => `/F${i + 1} ${5 + i} 0 R`).join(" ")} >>`,
    );
  });

  it("cały zestaw środkowoeuropejski, bałtycki, rumuński i turecki Helvetiki jest drukowalny", () => {
    const alphabets = [
      "ąćęłńśźżĄĆĘŁŃŚŹŻ",
      "čďěňřťůĺľŕČĎĚŇŘŤŮĹĽŔ",
      "őűŐŰ",
      "ėįųūĖĮŲŪ",
      "āēīģķļņōŗĀĒĪĢĶĻŅŌŖ",
      "ășțşţĂȘȚŞŢ",
      "ğıİĞ",
      "đĐ",
      "−≤≥≠∆∂∑√◊⁄ﬁﬂ˘˙˚˝˛ˇ",
    ].join("");

    const literals = pdfTextRuns(alphabets).map((run) => run.literal);
    expect(literals.join("")).not.toContain("?");
    const op = pdfTextOp(0, 0, alphabets, 9);
    expect(decodePdfTexts(`${pdfFontObjectsForDecoder()}\n${op}`)).toEqual([aglForm(alphabets)]);
  });
});
