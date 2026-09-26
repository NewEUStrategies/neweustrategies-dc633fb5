// Edytor szkicu dokumentu: stan formularza, walidacja pozycji (lustro
// `_event_invoice_replace_lines`), podglad sum (lustro `_event_invoice_recalc`)
// i ladunek zapisu. Nieczytelna pozycja nie liczy sie jako zero - blokuje zapis.
import { describe, expect, it } from "vitest";

import { emptyBuyerDraft } from "@/lib/events/eventInvoiceBuyerDraft";
import { parseInvoiceDocument, type EventInvoiceDocument } from "@/lib/events/eventInvoiceDocument";
import {
  DOCUMENT_ERROR_KEYS,
  LINE_ERROR_KEYS,
  documentDraftFromDocument,
  documentDraftPreview,
  documentDraftToUpdate,
  hasDocumentErrors,
  isDocumentDraftDirty,
  lineDraftAmounts,
  newLineDraft,
  validateDocumentDraft,
  type InvoiceDocumentDraft,
  type InvoiceLineDraft,
} from "@/lib/events/eventInvoiceDraft";
import { INVOICE_IDS, invoiceDocumentJson } from "@/test/events/invoiceFixtures";

function doc(): EventInvoiceDocument {
  const parsed = parseInvoiceDocument(invoiceDocumentJson({ invoice: { status: "draft", number: null } }));
  if (parsed === null) throw new Error("fixture");
  return parsed;
}

function line(overrides: Partial<InvoiceLineDraft> = {}): InvoiceLineDraft {
  return { ...newLineDraft(1, "23", "pl"), description: "Bilet", unitGross: "123,00", ...overrides };
}

function draft(overrides: Partial<InvoiceDocumentDraft> = {}): InvoiceDocumentDraft {
  return { ...documentDraftFromDocument(doc()), ...overrides };
}

describe("documentDraftFromDocument", () => {
  it("dokument -> formularz (kwoty jako napisy z kropka)", () => {
    const value = documentDraftFromDocument(doc());
    expect(value.saleDate).toBe("2026-09-20");
    expect(value.dueDate).toBe("2026-10-04");
    expect(value.paymentMethod).toBe("transfer");
    expect(value.locale).toBe("pl");
    expect(value.buyer.name).toBe("Acme Sp. z o.o.");
    expect(value.lines).toEqual([
      {
        key: INVOICE_IDS.line1,
        description: "Bilet: Standard - Kongres 27",
        unit: "szt.",
        quantity: "1",
        unitGross: "123.00",
        vatRate: "23",
        ticketTypeId: INVOICE_IDS.ticketType,
        correctsLineId: null,
      },
      expect.objectContaining({ key: INVOICE_IDS.line2, unitGross: "123.01" }),
    ]);
  });

  it("brak dat = pusty napis", () => {
    const parsed = parseInvoiceDocument(invoiceDocumentJson({ invoice: { sale_date: null, due_date: null } }));
    if (parsed === null) throw new Error("fixture");
    expect(documentDraftFromDocument(parsed)).toMatchObject({ saleDate: "", dueDate: "" });
  });
});

describe("newLineDraft", () => {
  it("deterministyczny klucz, jednostka wg jezyka dokumentu", () => {
    expect(newLineDraft(3, "8", "pl")).toEqual({
      key: "new-3",
      description: "",
      unit: "szt.",
      quantity: "1",
      unitGross: "",
      vatRate: "8",
      ticketTypeId: null,
      correctsLineId: null,
    });
    expect(newLineDraft(1, "23", "en").unit).toBe("pcs");
  });
});

describe("validateDocumentDraft", () => {
  it("poprawny szkic = brak bledow", () => {
    const errors = validateDocumentDraft(draft(), "invoice");
    expect(errors).toEqual({ buyer: {}, lines: {}, document: null });
    expect(hasDocumentErrors(errors)).toBe(false);
  });

  it("bledy pozycji po kolei: opis, jednostka, ilosc, cena", () => {
    const cases: ReadonlyArray<readonly [Partial<InvoiceLineDraft>, string]> = [
      [{ description: " " }, LINE_ERROR_KEYS.description],
      [{ description: "x".repeat(301) }, LINE_ERROR_KEYS.description],
      [{ unit: "" }, LINE_ERROR_KEYS.unit],
      [{ unit: "u".repeat(21) }, LINE_ERROR_KEYS.unit],
      [{ quantity: "0" }, LINE_ERROR_KEYS.quantity],
      [{ quantity: "1,5" }, LINE_ERROR_KEYS.quantity],
      [{ quantity: "10001" }, LINE_ERROR_KEYS.quantity],
      [{ quantity: "-1" }, LINE_ERROR_KEYS.quantity],
      [{ unitGross: "" }, LINE_ERROR_KEYS.price],
      [{ unitGross: "abc" }, LINE_ERROR_KEYS.price],
      [{ unitGross: "1000000.01" }, LINE_ERROR_KEYS.price],
    ];
    for (const [patch, key] of cases) {
      const errors = validateDocumentDraft(draft({ lines: [line({ key: "k", ...patch })] }), "invoice");
      expect(errors.lines).toEqual({ k: key });
      expect(hasDocumentErrors(errors)).toBe(true);
    }
  });

  it("ujemna ilosc wolno WYLACZNIE na korekcie", () => {
    const value = draft({ lines: [line({ key: "k", quantity: "-2" })], correctionReason: "Zwrot" });
    expect(validateDocumentDraft(value, "correction").lines).toEqual({});
    expect(validateDocumentDraft(value, "proforma").lines).toEqual({ k: LINE_ERROR_KEYS.quantity });
  });

  it("bledy dokumentu: brak pozycji, za dluga uwaga, korekta bez przyczyny", () => {
    expect(validateDocumentDraft(draft({ lines: [] }), "invoice").document).toBe(DOCUMENT_ERROR_KEYS.noLines);
    expect(validateDocumentDraft(draft({ note: "n".repeat(1001) }), "invoice").document).toBe(
      DOCUMENT_ERROR_KEYS.noteTooLong,
    );
    const correction = validateDocumentDraft(draft({ correctionReason: " " }), "correction");
    expect(correction.document).toBe(DOCUMENT_ERROR_KEYS.reasonRequired);
    expect(hasDocumentErrors(correction)).toBe(true);
  });

  it("bledy nabywcy wchodza do wyniku", () => {
    const errors = validateDocumentDraft(draft({ buyer: emptyBuyerDraft() }), "invoice");
    expect(errors.buyer.name).toBeDefined();
    expect(hasDocumentErrors(errors)).toBe(true);
  });
});

describe("podglad sum", () => {
  it("pozycje czytelne licza sie jak w bazie, nieczytelne sa pomijane", () => {
    expect(lineDraftAmounts(line({ quantity: "1", unitGross: "123", vatRate: "8" }))).toEqual({
      vatRate: "8",
      netCents: 11389,
      vatCents: 911,
      grossCents: 12300,
    });
    expect(lineDraftAmounts(line({ quantity: "x" }))).toBeNull();
    expect(lineDraftAmounts(line({ unitGross: "" }))).toBeNull();
    const preview = documentDraftPreview(
      draft({
        lines: [
          line({ key: "a", quantity: "1", unitGross: "123", vatRate: "8" }),
          line({ key: "b", quantity: "2", unitGross: "10,50", vatRate: "5" }),
          line({ key: "c", unitGross: "zle" }),
        ],
      }),
    );
    expect(preview.totals).toEqual({ netCents: 13389, vatCents: 1011, grossCents: 14400 });
    expect(preview.summary.map((row) => row.vatRate)).toEqual(["8", "5"]);
  });
});

describe("documentDraftToUpdate", () => {
  it("pelny zapis szkicu faktury: daty puste = null, bez przyczyny korekty", () => {
    const update = documentDraftToUpdate(
      "d",
      draft({ saleDate: "", dueDate: "2026-10-01", note: " Uwaga ", lines: [line({ unitGross: "1 250,5" })] }),
      "invoice",
    );
    expect(update).toEqual({
      id: "d",
      buyer: expect.objectContaining({ name: "Acme Sp. z o.o." }),
      saleDate: null,
      dueDate: "2026-10-01",
      paymentMethod: "transfer",
      locale: "pl",
      note: "Uwaga",
      lines: [
        {
          description: "Bilet",
          unit: "szt.",
          quantity: 1,
          unitGrossCents: 125050,
          vatRate: "23",
          ticketTypeId: null,
          correctsLineId: null,
        },
      ],
    });
    expect(update).not.toHaveProperty("correctionReason");
  });

  it("pusty termin platnosci = null (baza policzy z ustawien)", () => {
    expect(documentDraftToUpdate("d", draft({ dueDate: "" }), "invoice").dueDate).toBeNull();
  });

  it("korekta niesie przyczyne; nieczytelne pola ida jako zero (baza odmowi)", () => {
    const update = documentDraftToUpdate(
      "c",
      draft({ correctionReason: " Zwrot ", lines: [line({ quantity: "x", unitGross: "" })] }),
      "correction",
    );
    expect(update.correctionReason).toBe("Zwrot");
    expect(update.lines?.[0]).toMatchObject({ quantity: 0, unitGrossCents: 0 });
  });
});

describe("isDocumentDraftDirty", () => {
  it("porownuje caly formularz", () => {
    const initial = draft();
    expect(isDocumentDraftDirty(draft(), initial)).toBe(false);
    expect(isDocumentDraftDirty({ ...initial, note: "x" }, initial)).toBe(true);
  });
});
