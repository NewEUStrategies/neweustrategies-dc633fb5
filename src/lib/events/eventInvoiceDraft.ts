// Edytor SZKICU dokumentu (faktura, proforma, korekta) - czysty stan
// formularza, walidacja i podglad sum.
//
// KWOTY W POLACH SA NAPISAMI. Organizator wpisuje "123,45"; grosze liczy
// `registrationPriceCents` (arytmetyka na napisach, bez mnozenia float), a
// podglad netto/VAT/brutto - lustro bazy `eventInvoiceMath`. Nieczytelna
// pozycja nie wchodzi do sum podgladu i blokuje zapis, zamiast po cichu
// liczyc sie jako zero.
//
// KLUCZ POZYCJI jest stabilny i DETERMINISTYCZNY (id pozycji z bazy albo
// kolejny numer nowej pozycji) - bez `Math.random()` w stanie, ktory trafia
// do testow i do `key` listy.
import {
  invoiceTotals,
  lineAmounts,
  vatSummary,
  type EventInvoiceAmountLine,
  type EventInvoiceTotals,
  type EventInvoiceVatRate,
  type EventInvoiceVatSummaryRow,
} from "@/lib/events/eventInvoiceMath";
import type {
  EventInvoiceKind,
  EventInvoiceLocale,
  EventInvoicePaymentMethod,
} from "@/lib/events/eventInvoiceEnums";
import type { EventInvoiceDocument } from "@/lib/events/eventInvoiceDocument";
import type { InvoiceLineInput, UpdateInvoiceDraftInput } from "@/lib/events/eventInvoicesApi";
import {
  hasBuyerErrors,
  validateBuyerDraft,
  type InvoiceBuyerDraft,
  type InvoiceBuyerErrors,
} from "@/lib/events/eventInvoiceBuyerDraft";
import {
  registrationPriceCents,
  registrationPriceInput,
} from "@/lib/events/registrationSettingsDraft";

export interface InvoiceLineDraft {
  key: string;
  description: string;
  unit: string;
  quantity: string;
  unitGross: string;
  vatRate: EventInvoiceVatRate;
  ticketTypeId: string | null;
  correctsLineId: string | null;
}

export interface InvoiceDocumentDraft {
  buyer: InvoiceBuyerDraft;
  saleDate: string;
  dueDate: string;
  paymentMethod: EventInvoicePaymentMethod;
  locale: EventInvoiceLocale;
  note: string;
  correctionReason: string;
  lines: InvoiceLineDraft[];
}

export const LINE_ERROR_KEYS = {
  description: "adminEventInvoices.draft.errors.lineDescription",
  unit: "adminEventInvoices.draft.errors.lineUnit",
  quantity: "adminEventInvoices.draft.errors.lineQuantity",
  price: "adminEventInvoices.draft.errors.linePrice",
} as const;

export type InvoiceLineErrorKey = (typeof LINE_ERROR_KEYS)[keyof typeof LINE_ERROR_KEYS];

export const DOCUMENT_ERROR_KEYS = {
  noLines: "adminEventInvoices.draft.errors.noLines",
  noteTooLong: "adminEventInvoices.draft.errors.noteTooLong",
  reasonRequired: "adminEventInvoices.draft.errors.reasonRequired",
} as const;

export type InvoiceDocumentErrorKey = (typeof DOCUMENT_ERROR_KEYS)[keyof typeof DOCUMENT_ERROR_KEYS];

export interface InvoiceDocumentErrors {
  buyer: InvoiceBuyerErrors;
  lines: Record<string, InvoiceLineErrorKey>;
  document: InvoiceDocumentErrorKey | null;
}

const INTEGER_PATTERN = /^-?\d{1,5}$/;

export function documentDraftFromDocument(doc: EventInvoiceDocument): InvoiceDocumentDraft {
  return {
    buyer: { ...doc.buyer },
    saleDate: doc.saleDate ?? "",
    dueDate: doc.dueDate ?? "",
    paymentMethod: doc.paymentMethod,
    locale: doc.locale,
    note: doc.note,
    correctionReason: doc.correctionReason,
    lines: doc.lines.map((line) => ({
      key: line.id,
      description: line.description,
      unit: line.unit,
      quantity: String(line.quantity),
      unitGross: registrationPriceInput(line.unitGrossCents),
      vatRate: line.vatRate,
      ticketTypeId: line.ticketTypeId,
      correctsLineId: line.correctsLineId,
    })),
  };
}

/** Nowa pusta pozycja; `ordinal` = kolejny numer w edytorze (klucz). */
export function newLineDraft(
  ordinal: number,
  vatRate: EventInvoiceVatRate,
  locale: EventInvoiceLocale,
): InvoiceLineDraft {
  return {
    key: `new-${ordinal}`,
    description: "",
    unit: locale === "en" ? "pcs" : "szt.",
    quantity: "1",
    unitGross: "",
    vatRate,
    ticketTypeId: null,
    correctsLineId: null,
  };
}

function quantityOf(line: InvoiceLineDraft): number | null {
  const trimmed = line.quantity.trim();
  return INTEGER_PATTERN.test(trimmed) ? Number(trimmed) : null;
}

function unitGrossOf(line: InvoiceLineDraft): number | null {
  const cents = registrationPriceCents(line.unitGross);
  return cents === null || Number.isNaN(cents) ? null : cents;
}

function lineError(line: InvoiceLineDraft, kind: EventInvoiceKind): InvoiceLineErrorKey | null {
  const description = line.description.trim();
  if (description === "" || description.length > 300) return LINE_ERROR_KEYS.description;
  const unit = line.unit.trim();
  if (unit === "" || unit.length > 20) return LINE_ERROR_KEYS.unit;
  const quantity = quantityOf(line);
  if (
    quantity === null ||
    quantity === 0 ||
    Math.abs(quantity) > 10000 ||
    (kind !== "correction" && quantity < 0)
  ) {
    return LINE_ERROR_KEYS.quantity;
  }
  const unitGross = unitGrossOf(line);
  return unitGross === null || unitGross > 100_000_000 ? LINE_ERROR_KEYS.price : null;
}

export function validateDocumentDraft(
  draft: InvoiceDocumentDraft,
  kind: EventInvoiceKind,
): InvoiceDocumentErrors {
  const lines: Record<string, InvoiceLineErrorKey> = {};
  for (const line of draft.lines) {
    const error = lineError(line, kind);
    if (error !== null) lines[line.key] = error;
  }
  let document: InvoiceDocumentErrorKey | null = null;
  if (draft.lines.length === 0) document = DOCUMENT_ERROR_KEYS.noLines;
  else if (draft.note.trim().length > 1000) document = DOCUMENT_ERROR_KEYS.noteTooLong;
  else if (kind === "correction" && draft.correctionReason.trim() === "") {
    document = DOCUMENT_ERROR_KEYS.reasonRequired;
  }
  return { buyer: validateBuyerDraft(draft.buyer), lines, document };
}

export function hasDocumentErrors(errors: InvoiceDocumentErrors): boolean {
  return (
    hasBuyerErrors(errors.buyer) || Object.keys(errors.lines).length > 0 || errors.document !== null
  );
}

/** Kwoty pozycji do podgladu albo `null`, gdy pola sa nieczytelne. */
export function lineDraftAmounts(line: InvoiceLineDraft): EventInvoiceAmountLine | null {
  const quantity = quantityOf(line);
  const unitGross = unitGrossOf(line);
  if (quantity === null || unitGross === null) return null;
  const amounts = lineAmounts(quantity, unitGross, line.vatRate);
  return {
    vatRate: line.vatRate,
    netCents: amounts.netCents,
    vatCents: amounts.vatCents,
    grossCents: amounts.grossCents,
  };
}

export interface InvoiceDraftPreview {
  totals: EventInvoiceTotals;
  summary: EventInvoiceVatSummaryRow[];
}

export function documentDraftPreview(draft: InvoiceDocumentDraft): InvoiceDraftPreview {
  const lines = draft.lines
    .map(lineDraftAmounts)
    .filter((line): line is EventInvoiceAmountLine => line !== null);
  return { totals: invoiceTotals(lines), summary: vatSummary(lines) };
}

function lineInput(line: InvoiceLineDraft): InvoiceLineInput {
  return {
    description: line.description.trim(),
    unit: line.unit.trim(),
    quantity: quantityOf(line) ?? 0,
    unitGrossCents: unitGrossOf(line) ?? 0,
    vatRate: line.vatRate,
    ticketTypeId: line.ticketTypeId,
    correctsLineId: line.correctsLineId,
  };
}

/** Pelny zapis szkicu (edytor zapisuje caly formularz naraz). */
export function documentDraftToUpdate(
  id: string,
  draft: InvoiceDocumentDraft,
  kind: EventInvoiceKind,
): UpdateInvoiceDraftInput {
  return {
    id,
    buyer: draft.buyer,
    saleDate: draft.saleDate === "" ? null : draft.saleDate,
    dueDate: draft.dueDate === "" ? null : draft.dueDate,
    paymentMethod: draft.paymentMethod,
    locale: draft.locale,
    note: draft.note.trim(),
    ...(kind === "correction" ? { correctionReason: draft.correctionReason.trim() } : {}),
    lines: draft.lines.map(lineInput),
  };
}

export function isDocumentDraftDirty(
  current: InvoiceDocumentDraft,
  initial: InvoiceDocumentDraft,
): boolean {
  return JSON.stringify(current) !== JSON.stringify(initial);
}
