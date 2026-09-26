// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW:
//
// Odczyt dokumentu faktury wydarzenia (panel i kupujacy czytaja ten sam JSON
// z `_event_invoice_document`). Typ generowany widzi tam wylacznie `Json`, wiec
// odczyt jest pole po polu - a zly ksztalt to `null`, nie pol faktury.
import { describe, expect, it } from "vitest";

import {
  jsonBool,
  jsonList,
  jsonNumber,
  jsonRecord,
  jsonText,
  jsonTextOrNull,
  parseInvoiceDocument,
} from "@/lib/events/eventInvoiceDocument";
import { INVOICE_IDS, invoiceDocumentJson } from "@/test/events/invoiceFixtures";

describe("pomocnicze odczyty JSON", () => {
  it("obiekt, lista, tekst, liczba i flaga z bezpiecznym zastepstwem", () => {
    expect(jsonRecord({ a: 1 })).toEqual({ a: 1 });
    expect(jsonRecord([1])).toEqual({});
    expect(jsonRecord(null)).toEqual({});
    expect(jsonRecord(undefined)).toEqual({});
    expect(jsonList([1, 2])).toEqual([1, 2]);
    expect(jsonList({})).toEqual([]);
    expect(jsonText("x")).toBe("x");
    expect(jsonText(1)).toBe("");
    expect(jsonTextOrNull("x")).toBe("x");
    expect(jsonTextOrNull("")).toBeNull();
    expect(jsonTextOrNull(null)).toBeNull();
    expect(jsonNumber(5)).toBe(5);
    expect(jsonNumber(Number.NaN)).toBe(0);
    expect(jsonNumber("5")).toBe(0);
    expect(jsonBool(true)).toBe(true);
    expect(jsonBool("true")).toBe(false);
  });
});

describe("parseInvoiceDocument", () => {
  it("pelny dokument panelu", () => {
    const doc = parseInvoiceDocument(invoiceDocumentJson());
    expect(doc).not.toBeNull();
    expect(doc).toMatchObject({
      id: INVOICE_IDS.invoice,
      eventId: INVOICE_IDS.event,
      eventSlug: "kongres-27",
      eventTitlePl: "Kongres 27",
      eventTitleEn: "Congress 27",
      kind: "invoice",
      status: "issued",
      number: "FV/2026/09/0001",
      issueDate: "2026-09-20",
      saleDate: "2026-09-20",
      dueDate: "2026-10-04",
      paymentMethod: "transfer",
      paidAt: null,
      currency: "PLN",
      netCents: 20001,
      vatCents: 4600,
      grossCents: 24601,
      locale: "pl",
      ksefStatus: "pending",
      ksefNumber: null,
      correctionMode: null,
      correctsInvoiceId: null,
      sourceProformaId: null,
      footerNote: "Dziekujemy za udzial",
      corrects: null,
    });
    expect(doc?.buyer).toEqual({
      isCompany: true,
      name: "Acme Sp. z o.o.",
      taxId: "5260250274",
      country: "PL",
      address: "ul. Morska 5",
      postalCode: "80-001",
      city: "Gdansk",
      email: "ksiegowosc@acme.example.com",
      poNumber: "PO-27",
      recipientName: "",
      recipientAddress: "",
    });
    expect(doc?.seller).toEqual({
      name: "Organizator 27 Sp. z o.o.",
      taxId: "7011278375",
      address: "ul. Dluga 1",
      postalCode: "00-001",
      city: "Warszawa",
      country: "PL",
      email: "faktury@org27.example.com",
      phone: "+48 22 000 00 00",
      bankAccount: "PL61109010140000071219812874",
      bankSwift: "WBKPPLPP",
    });
    expect(doc?.lines).toHaveLength(2);
    expect(doc?.lines[1]).toEqual({
      id: INVOICE_IDS.line2,
      position: 2,
      description: "Bilet: Standard - Kongres 27",
      unit: "szt.",
      quantity: 1,
      unitGrossCents: 12301,
      unitNetCents: 10001,
      vatRate: "23",
      netCents: 10001,
      vatCents: 2300,
      grossCents: 12301,
      ticketTypeId: INVOICE_IDS.ticketType,
      correctsLineId: null,
    });
    expect(doc?.sources).toEqual([
      {
        id: "27f20000-0000-4000-8000-000000000001",
        sourceKind: "registration",
        registrationId: INVOICE_IDS.registration,
        packageOrderId: null,
        seats: 2,
        grossCents: 24601,
        covers: true,
        releasedAt: null,
      },
    ]);
    expect(doc?.corrections).toEqual([]);
  });

  it("korekta: tryb, faktura korygowana, lista korekt", () => {
    const doc = parseInvoiceDocument(
      invoiceDocumentJson({
        invoice: {
          kind: "correction",
          correction_mode: "partial",
          correction_reason: "Zla stawka",
          corrects_invoice_id: INVOICE_IDS.proforma,
          cancel_reason: "",
        },
        corrects: { id: INVOICE_IDS.proforma, number: "FV/2026/09/0001", issue_date: "2026-09-10" },
        corrections: [
          { id: INVOICE_IDS.correction, number: null, status: "draft", correction_mode: "full" },
        ],
      }),
    );
    expect(doc?.kind).toBe("correction");
    expect(doc?.correctionMode).toBe("partial");
    expect(doc?.correctionReason).toBe("Zla stawka");
    expect(doc?.corrects).toEqual({
      id: INVOICE_IDS.proforma,
      number: "FV/2026/09/0001",
      issueDate: "2026-09-10",
    });
    expect(doc?.corrections).toEqual([
      { id: INVOICE_IDS.correction, number: null, status: "draft", correctionMode: "full" },
    ]);
  });

  it("brak identyfikatora = null (nie polowa dokumentu)", () => {
    expect(parseInvoiceDocument(null)).toBeNull();
    expect(parseInvoiceDocument({})).toBeNull();
    expect(parseInvoiceDocument({ invoice: { id: "" } })).toBeNull();
    expect(parseInvoiceDocument([])).toBeNull();
  });

  it("uszkodzone pola degraduja sie do bezpiecznych wartosci", () => {
    const doc = parseInvoiceDocument({
      invoice: {
        id: "x",
        kind: "receipt",
        status: 3,
        currency: "",
        buyer_country: "",
        locale: "de",
      },
      lines: [{ vat_rate: "7" }, "zly"],
      sources: [{ source_kind: "ticket" }],
      corrections: [{ status: "void", correction_mode: "x" }],
    });
    expect(doc).toMatchObject({
      kind: "invoice",
      status: "draft",
      currency: "PLN",
      locale: "pl",
      paymentMethod: "card",
      ksefStatus: "not_applicable",
      seller: { name: "", country: "" },
      footerNote: "",
    });
    expect(doc?.buyer.country).toBe("PL");
    expect(doc?.buyer.isCompany).toBe(false);
    expect(doc?.lines.map((line) => line.vatRate)).toEqual(["23", "23"]);
    expect(doc?.lines[1].id).toBe("");
    expect(doc?.sources[0].sourceKind).toBe("registration");
    expect(doc?.corrections[0]).toEqual({
      id: "",
      number: null,
      status: "draft",
      correctionMode: "full",
    });
  });
});
