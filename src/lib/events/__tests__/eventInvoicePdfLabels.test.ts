// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW:
//
// Etykiety PDF w JEZYKU DOKUMENTU (nie panelu) i pobranie pliku w przegladarce.
// Faktura angielska pobrana z polskiego ekranu ma byc angielska - dlatego
// `getFixedT(doc.locale)`, a nie globalny jezyk.
import { afterEach, describe, expect, it, vi } from "vitest";

import i18n from "@/lib/i18n";
import { parseInvoiceDocument, type EventInvoiceDocument } from "@/lib/events/eventInvoiceDocument";
import {
  buildEventInvoicePdf,
  downloadEventInvoicePdf,
  eventInvoicePdfLabels,
} from "@/lib/events/eventInvoicePdfLabels";
import { invoiceDocumentJson } from "@/test/events/invoiceFixtures";

function doc(json: Parameters<typeof invoiceDocumentJson>[0] = {}): EventInvoiceDocument {
  const parsed = parseInvoiceDocument(invoiceDocumentJson(json));
  if (parsed === null) throw new Error("fixture");
  return parsed;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("eventInvoicePdfLabels", () => {
  it("polska faktura: polskie etykiety niezaleznie od jezyka interfejsu", async () => {
    await i18n.changeLanguage("en");
    const labels = eventInvoicePdfLabels(doc());
    expect(labels.title).toBe("Faktura VAT");
    expect(labels.paymentMethodValue).toBe("przelew");
    expect(labels.columns.unitNet).toBe("Cena netto");
    expect(labels.rates).toEqual({
      "23": "23%",
      "8": "8%",
      "5": "5%",
      "0": "0%",
      zw: "zw",
      np: "np",
    });
    expect(labels.page(2, 3)).toBe("Strona 2 z 3");
    expect(labels.fileStem).toBe("faktura");
    await i18n.changeLanguage("pl");
  });

  it("angielska korekta: tytul, naglowek korekty z numerem i data, rdzen pliku", () => {
    const labels = eventInvoicePdfLabels(
      doc({
        invoice: {
          kind: "correction",
          locale: "en",
          payment_method: "card",
          correction_mode: "full",
        },
        corrects: { id: "x", number: "FV/2026/09/0001", issue_date: "2026-09-10" },
      }),
    );
    expect(labels.title).toBe("Credit note");
    expect(labels.correctsLine).toBe("Credit note to invoice FV/2026/09/0001 of 2026-09-10");
    expect(labels.paymentMethodValue).toBe("payment card");
    expect(labels.rates.zw).toBe("exempt");
    expect(labels.fileStem).toBe("credit-note");
  });

  it("proforma i sposob 'inny'; brak faktury korygowanej = puste miejsca w zdaniu", () => {
    const labels = eventInvoicePdfLabels(
      doc({ invoice: { kind: "proforma", payment_method: "other" } }),
    );
    expect(labels.title).toBe("Faktura proforma");
    expect(labels.paymentMethodValue).toBe("inny");
    expect(labels.correctsLine).toBe("Korekta do faktury  z dnia ");
    expect(labels.fileStem).toBe("proforma");
  });
});

describe("buildEventInvoicePdf / downloadEventInvoicePdf", () => {
  it("nazwa pliku w jezyku dokumentu i bajty PDF", () => {
    const { fileName, bytes } = buildEventInvoicePdf(doc({ invoice: { locale: "en" } }));
    expect(fileName).toBe("invoice-FV-2026-09-0001.pdf");
    expect(new TextDecoder("latin1").decode(bytes.slice(0, 8))).toBe("%PDF-1.4");
  });

  it("pobranie: Blob, tymczasowy odnosnik, klikniecie, sprzatanie", () => {
    const create = vi.fn((_blob: Blob) => "blob:faktura");
    const revoke = vi.fn((_url: string) => {});
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: create });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revoke });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    downloadEventInvoicePdf(doc());
    expect(create).toHaveBeenCalledTimes(1);
    const blob = create.mock.calls[0]?.[0];
    expect(blob).toBeInstanceOf(Blob);
    expect(click).toHaveBeenCalledTimes(1);
    const anchor = click.mock.contexts[0];
    expect(anchor).toBeInstanceOf(HTMLAnchorElement);
    if (anchor instanceof HTMLAnchorElement) {
      expect(anchor.download).toBe("faktura-FV-2026-09-0001.pdf");
      expect(anchor.rel).toBe("noopener");
      expect(anchor.isConnected).toBe(false);
    }
    expect(revoke).toHaveBeenCalledWith("blob:faktura");
  });
});
