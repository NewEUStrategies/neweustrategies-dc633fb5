// Renderer PDF faktury wydarzenia. Czysty modul (etykiety podaje wolajacy),
// wiec test czyta WYGENEROWANE BAJTY: struktura PDF, tresc strumieni w
// kodowaniu glifow modulu rozliczen, wiele stron z powtorzonym naglowkiem
// tabeli, sekcje warunkowe (anulowanie, korekta, rachunek, zw, KSeF, proforma).
import { describe, expect, it } from "vitest";

import { encodePdfText } from "@/lib/billing/invoicePdf";
import { parseInvoiceDocument, type EventInvoiceDocument } from "@/lib/events/eventInvoiceDocument";
import {
  eventInvoicePdfFileName,
  renderEventInvoicePdf,
  wrapText,
  type EventInvoicePdfLabels,
} from "@/lib/events/eventInvoicePdf";
import { INVOICE_IDS, invoiceDocumentJson, invoiceLineJson } from "@/test/events/invoiceFixtures";

const LABELS: EventInvoicePdfLabels = {
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
    unitNet: "Cena netto",
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
  correctsLine: "Korekta do FV/2026/09/0001",
  correctionReason: "Przyczyna",
  exemptBasis: "Podstawa zwolnienia",
  ksefNumber: "Numer KSeF",
  cancelled: "ANULOWANY",
  proformaNote: "Proforma nie jest fakturą VAT",
  page: (page, pages) => `Strona ${page}/${pages}`,
  fileStem: "faktura",
};

function doc(json: Parameters<typeof invoiceDocumentJson>[0] = {}): EventInvoiceDocument {
  const parsed = parseInvoiceDocument(invoiceDocumentJson(json));
  if (parsed === null) throw new Error("fixture");
  return parsed;
}

function pdfText(bytes: Uint8Array): string {
  return new TextDecoder("latin1").decode(bytes);
}

function contains(text: string, value: string): boolean {
  return text.includes(`(${encodePdfText(value)})`);
}

describe("wrapText", () => {
  it("zawija po slowach i tnie slowa dluzsze niz wiersz", () => {
    expect(wrapText("Bilet: Standard - Kongres 27", 12)).toEqual(["Bilet:", "Standard -", "Kongres 27"]);
    expect(wrapText("abcdefghij klm", 4)).toEqual(["abcd", "efgh", "ij", "klm"]);
    expect(wrapText("ab abcdefghij", 4)).toEqual(["ab", "abcd", "efgh", "ij"]);
    expect(wrapText("   ", 10)).toEqual([""]);
  });
});

describe("renderEventInvoicePdf", () => {
  it("poprawny PDF z naglowkiem, stronami, pozycjami i sumami", () => {
    const text = pdfText(renderEventInvoicePdf(doc(), LABELS));
    expect(text.startsWith("%PDF-1.4\n")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(text).toContain("/Count 1");
    expect(text).toContain("/BaseFont /Helvetica-Bold");
    expect(contains(text, "Faktura VAT")).toBe(true);
    expect(contains(text, "Nr FV/2026/09/0001")).toBe(true);
    expect(contains(text, "Data wystawienia: 2026-09-20")).toBe(true);
    expect(contains(text, "Sposób płatności: przelew")).toBe(true);
    expect(contains(text, "Organizator 27 Sp. z o.o.")).toBe(true);
    expect(contains(text, "NIP: 7011278375")).toBe(true);
    expect(contains(text, "Acme Sp. z o.o.")).toBe(true);
    expect(contains(text, "80-001 Gdansk")).toBe(true);
    expect(contains(text, "Wydarzenie: Kongres 27")).toBe(true);
    expect(contains(text, "Nr zamówienia: PO-27")).toBe(true);
    expect(contains(text, "123,01")).toBe(true);
    expect(contains(text, "246,01")).toBe(true);
    expect(contains(text, "Do zapłaty: 246,01 PLN")).toBe(true);
    expect(contains(text, "Rachunek: PL61109010140000071219812874")).toBe(true);
    expect(contains(text, "SWIFT: WBKPPLPP")).toBe(true);
    expect(contains(text, "Dziekujemy za udzial")).toBe(true);
    expect(contains(text, "Strona 1/1")).toBe(true);
    expect(contains(text, "ANULOWANY")).toBe(false);
    expect(contains(text, "Proforma nie jest fakturą VAT")).toBe(false);
  });

  it("zaplacona faktura: bez rachunku, z 'Zaplacono'; KSeF i zw na dokumencie", () => {
    const text = pdfText(
      renderEventInvoicePdf(
        doc({
          invoice: {
            paid_at: "2026-09-20T10:00:00Z",
            ksef_number: "KSEF-123",
            vat_exempt_basis: "art. 43",
            note: "Uwaga do faktury",
          },
        }),
        LABELS,
      ),
    );
    expect(contains(text, "Zapłacono: 246,01 PLN")).toBe(true);
    expect(contains(text, "Rachunek: PL61109010140000071219812874")).toBe(false);
    expect(contains(text, "Numer KSeF: KSEF-123")).toBe(true);
    expect(contains(text, "Podstawa zwolnienia: art. 43")).toBe(true);
    expect(contains(text, "Uwaga do faktury")).toBe(true);
  });

  it("rachunek bez SWIFT; karta = bez rachunku", () => {
    const noSwift = pdfText(
      renderEventInvoicePdf(doc({ seller: { seller_name: "Org", seller_bank_account: "PL61" } }), LABELS),
    );
    expect(contains(noSwift, "Rachunek: PL61")).toBe(true);
    expect(noSwift.includes(encodePdfText("SWIFT:"))).toBe(false);
    const card = pdfText(renderEventInvoicePdf(doc({ invoice: { payment_method: "card" } }), LABELS));
    expect(card.includes(encodePdfText("Rachunek:"))).toBe(false);
  });

  it("szkic bez numeru, anulowany dokument, odbiorca", () => {
    const text = pdfText(
      renderEventInvoicePdf(
        doc({
          invoice: {
            number: null,
            status: "cancelled",
            issue_date: null,
            recipient_name: "Dzial szkolen",
            recipient_address: "ul. Boczna 1, 80-002 Gdansk",
          },
        }),
        LABELS,
      ),
    );
    expect(contains(text, "Szkic")).toBe(true);
    expect(text.includes(encodePdfText("Nr FV/"))).toBe(false);
    expect(text.includes(encodePdfText("Data wystawienia"))).toBe(false);
    expect(contains(text, "ANULOWANY")).toBe(true);
    expect(contains(text, "Odbiorca")).toBe(true);
    expect(contains(text, "Dzial szkolen")).toBe(true);
    expect(contains(text, "ul. Boczna 1, 80-002 Gdansk")).toBe(true);
  });

  it("korekta: naglowek i przyczyna; proforma: adnotacja; angielski tytul wydarzenia", () => {
    const correction = pdfText(
      renderEventInvoicePdf(
        doc({ invoice: { kind: "correction", correction_mode: "full", correction_reason: "Rezygnacja" } }),
        LABELS,
      ),
    );
    expect(contains(correction, "Korekta do FV/2026/09/0001")).toBe(true);
    expect(contains(correction, "Przyczyna: Rezygnacja")).toBe(true);
    const proforma = pdfText(renderEventInvoicePdf(doc({ invoice: { kind: "proforma", locale: "en" } }), LABELS));
    expect(contains(proforma, "Proforma nie jest fakturą VAT")).toBe(true);
    expect(contains(proforma, "Wydarzenie: Congress 27")).toBe(true);
  });

  it("bez tytulu wydarzenia, numeru zamowienia i NIP nabywcy - wiersze pominiete", () => {
    const text = pdfText(
      renderEventInvoicePdf(
        doc({ invoice: { event_title_pl: "", po_number: "", buyer_tax_id: "", buyer_is_company: false } }),
        LABELS,
      ),
    );
    expect(text.includes(encodePdfText("Wydarzenie:"))).toBe(false);
    expect(text.includes(encodePdfText("Nr zamówienia:"))).toBe(false);
    expect(text.includes(encodePdfText("NIP: 5260250274"))).toBe(false);
  });

  it("faktura zbiorcza z wieloma pozycjami: wiele stron, naglowek tabeli na kazdej", () => {
    const lines = Array.from({ length: 90 }, (_unused, index) =>
      invoiceLineJson({
        id: `line-${index}`,
        position: index + 1,
        description: `Bilet dla uczestnika numer ${index + 1} z bardzo dlugim opisem, ktory trzeba zawinac`,
        vat_rate: index % 2 === 0 ? "23" : "8",
      }),
    );
    const text = pdfText(renderEventInvoicePdf(doc({ lines }), LABELS));
    const pages = Number(/\/Count (\d+)/.exec(text)?.[1] ?? "0");
    expect(pages).toBeGreaterThan(1);
    const headers = text.split(`(${encodePdfText("Cena netto")})`).length - 1;
    expect(headers).toBe(pages);
    expect(contains(text, `Strona ${pages}/${pages}`)).toBe(true);
    expect(contains(text, "8%")).toBe(true);
    expect(text.match(/\/Type \/Page /g)).toHaveLength(pages);
  });
});

describe("stopka dluzsza niz strona", () => {
  it("nowa strona poza tabela NIE powtarza naglowka pozycji", () => {
    const text = pdfText(renderEventInvoicePdf(doc({ invoice: { note: "slowo ".repeat(3000) } }), LABELS));
    const pages = Number(/\/Count (\d+)/.exec(text)?.[1] ?? "0");
    expect(pages).toBeGreaterThan(1);
    expect(text.split(`(${encodePdfText("Cena netto")})`).length - 1).toBe(1);
  });

  it("pusty sposob platnosci nie trafia do metryki", () => {
    const text = pdfText(renderEventInvoicePdf(doc(), { ...LABELS, paymentMethodValue: "" }));
    expect(text.includes(encodePdfText("Sposób płatności"))).toBe(false);
  });
});

describe("eventInvoicePdfFileName", () => {
  it("numer z ukosnikami -> myslniki; szkic -> draft + poczatek id", () => {
    expect(eventInvoicePdfFileName(doc(), LABELS)).toBe("faktura-FV-2026-09-0001.pdf");
    expect(eventInvoicePdfFileName(doc({ invoice: { number: null } }), LABELS)).toBe(
      `faktura-draft-${INVOICE_IDS.invoice.slice(0, 8)}.pdf`,
    );
  });
});
