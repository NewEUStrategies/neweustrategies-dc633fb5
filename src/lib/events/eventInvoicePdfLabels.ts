// Etykiety PDF faktury w JEZYKU DOKUMENTU i pobranie pliku w przegladarce.
//
// `i18n.getFixedT(doc.locale)`, a nie globalny jezyk: faktura angielska
// pobrana z polskiego panelu ma byc angielska. Nakladka publiczna
// (`i18n-event-invoices`) rejestruje oba jezyki przy imporcie, wiec stala
// funkcja tlumaczaca ma z czego czytac.
//
// POBRANIE DZIALA TYLKO W PRZEGLADARCE i tylko w obsludze klikniecia (Blob,
// `URL.createObjectURL`, sztuczny odnosnik) - nigdy w renderze.
import i18n from "@/lib/i18n";
import { ensureEventInvoicesI18n } from "@/lib/i18n-event-invoices";
import type { EventInvoiceDocument } from "@/lib/events/eventInvoiceDocument";
import type { EventInvoiceKind, EventInvoicePaymentMethod } from "@/lib/events/eventInvoiceEnums";
import type { EventInvoiceVatRate } from "@/lib/events/eventInvoiceMath";
import {
  eventInvoicePdfFileName,
  renderEventInvoicePdf,
  type EventInvoicePdfLabels,
} from "@/lib/events/eventInvoicePdf";

const TITLE_KEYS: Record<EventInvoiceKind, string> = {
  invoice: "eventInvoices.pdf.titles.invoice",
  proforma: "eventInvoices.pdf.titles.proforma",
  correction: "eventInvoices.pdf.titles.correction",
};

const STEM_KEYS: Record<EventInvoiceKind, string> = {
  invoice: "eventInvoices.pdf.fileStems.invoice",
  proforma: "eventInvoices.pdf.fileStems.proforma",
  correction: "eventInvoices.pdf.fileStems.correction",
};

const METHOD_KEYS: Record<EventInvoicePaymentMethod, string> = {
  card: "eventInvoices.pdf.methods.card",
  transfer: "eventInvoices.pdf.methods.transfer",
  other: "eventInvoices.pdf.methods.other",
};

const RATE_KEYS: Record<EventInvoiceVatRate, string> = {
  "23": "eventInvoices.pdf.rates.23",
  "8": "eventInvoices.pdf.rates.8",
  "5": "eventInvoices.pdf.rates.5",
  "0": "eventInvoices.pdf.rates.0",
  zw: "eventInvoices.pdf.rates.zw",
  np: "eventInvoices.pdf.rates.np",
};

export function eventInvoicePdfLabels(doc: EventInvoiceDocument): EventInvoicePdfLabels {
  ensureEventInvoicesI18n();
  const t = i18n.getFixedT(doc.locale);
  return {
    title: t(TITLE_KEYS[doc.kind]),
    draftTitle: t("eventInvoices.pdf.draftTitle"),
    number: t("eventInvoices.pdf.number"),
    issueDate: t("eventInvoices.pdf.issueDate"),
    saleDate: t("eventInvoices.pdf.saleDate"),
    dueDate: t("eventInvoices.pdf.dueDate"),
    paymentMethod: t("eventInvoices.pdf.paymentMethod"),
    paymentMethodValue: t(METHOD_KEYS[doc.paymentMethod]),
    seller: t("eventInvoices.pdf.seller"),
    buyer: t("eventInvoices.pdf.buyer"),
    recipient: t("eventInvoices.pdf.recipient"),
    taxId: t("eventInvoices.pdf.taxId"),
    bankAccount: t("eventInvoices.pdf.bankAccount"),
    swift: t("eventInvoices.pdf.swift"),
    event: t("eventInvoices.pdf.event"),
    poNumber: t("eventInvoices.pdf.poNumber"),
    columns: {
      lp: t("eventInvoices.pdf.columns.lp"),
      name: t("eventInvoices.pdf.columns.name"),
      unit: t("eventInvoices.pdf.columns.unit"),
      quantity: t("eventInvoices.pdf.columns.quantity"),
      unitNet: t("eventInvoices.pdf.columns.unitNet"),
      net: t("eventInvoices.pdf.columns.net"),
      rate: t("eventInvoices.pdf.columns.rate"),
      vat: t("eventInvoices.pdf.columns.vat"),
      gross: t("eventInvoices.pdf.columns.gross"),
    },
    rates: {
      "23": t(RATE_KEYS["23"]),
      "8": t(RATE_KEYS["8"]),
      "5": t(RATE_KEYS["5"]),
      "0": t(RATE_KEYS["0"]),
      zw: t(RATE_KEYS.zw),
      np: t(RATE_KEYS.np),
    },
    vatSummary: t("eventInvoices.pdf.vatSummary"),
    total: t("eventInvoices.pdf.total"),
    toPay: t("eventInvoices.pdf.toPay"),
    paid: t("eventInvoices.pdf.paid"),
    correctsLine: t("eventInvoices.pdf.correctsLine", {
      number: doc.corrects?.number ?? "",
      date: doc.corrects?.issueDate ?? "",
    }),
    correctionReason: t("eventInvoices.pdf.correctionReason"),
    exemptBasis: t("eventInvoices.pdf.exemptBasis"),
    ksefNumber: t("eventInvoices.pdf.ksefNumber"),
    cancelled: t("eventInvoices.pdf.cancelled"),
    proformaNote: t("eventInvoices.pdf.proformaNote"),
    page: (page, pages) => t("eventInvoices.pdf.page", { page, pages }),
    fileStem: t(STEM_KEYS[doc.kind]),
  };
}

/** Plik PDF dokumentu w jego jezyku: nazwa i bajty. */
export function buildEventInvoicePdf(doc: EventInvoiceDocument): {
  fileName: string;
  bytes: Uint8Array<ArrayBuffer>;
} {
  const labels = eventInvoicePdfLabels(doc);
  return { fileName: eventInvoicePdfFileName(doc, labels), bytes: renderEventInvoicePdf(doc, labels) };
}

/** Pobranie w przegladarce (obsluga klikniecia). */
export function downloadEventInvoicePdf(doc: EventInvoiceDocument): void {
  const { fileName, bytes } = buildEventInvoicePdf(doc);
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
