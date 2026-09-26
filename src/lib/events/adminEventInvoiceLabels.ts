// Slowniki ETYKIET ekranu faktur studia - `Record<Enum, "pelny.klucz">`.
//
// Osobny modul (nie eksport z komponentow), bo czyta je kilka molekul
// naraz: formularz ustawien, edytor szkicu, korekta, KSeF i lista dokumentow.
// Klucze sa pelnymi literalami (bramki i18n nie widza kluczy skladanych
// z szablonu), a zbiory kluczy sa zamkniete typami enumow - brakujaca
// etykieta to blad kompilacji, nie surowa sciezka i18n na ekranie.
import type {
  EventInvoiceKind,
  EventInvoiceKsefStatus,
  EventInvoiceLocale,
  EventInvoicePaymentMethod,
  EventInvoiceStatus,
} from "@/lib/events/eventInvoiceEnums";
import type { EventInvoiceVatRate } from "@/lib/events/eventInvoiceMath";

export const VAT_RATE_LABEL_KEYS: Record<EventInvoiceVatRate, string> = {
  "23": "adminEventInvoices.vatRates.23",
  "8": "adminEventInvoices.vatRates.8",
  "5": "adminEventInvoices.vatRates.5",
  "0": "adminEventInvoices.vatRates.0",
  zw: "adminEventInvoices.vatRates.zw",
  np: "adminEventInvoices.vatRates.np",
};

export const LOCALE_LABEL_KEYS: Record<EventInvoiceLocale, string> = {
  pl: "adminEventInvoices.locales.pl",
  en: "adminEventInvoices.locales.en",
};

export const PAYMENT_METHOD_LABEL_KEYS: Record<EventInvoicePaymentMethod, string> = {
  card: "adminEventInvoices.methods.card",
  transfer: "adminEventInvoices.methods.transfer",
  other: "adminEventInvoices.methods.other",
};

export const KSEF_STATUS_LABEL_KEYS: Record<EventInvoiceKsefStatus, string> = {
  not_applicable: "adminEventInvoices.ksefStatuses.not_applicable",
  pending: "adminEventInvoices.ksefStatuses.pending",
  sent: "adminEventInvoices.ksefStatuses.sent",
  accepted: "adminEventInvoices.ksefStatuses.accepted",
  rejected: "adminEventInvoices.ksefStatuses.rejected",
};

export const KIND_LABEL_KEYS: Record<EventInvoiceKind, string> = {
  invoice: "adminEventInvoices.kinds.invoice",
  proforma: "adminEventInvoices.kinds.proforma",
  correction: "adminEventInvoices.kinds.correction",
};

export const STATUS_LABEL_KEYS: Record<EventInvoiceStatus, string> = {
  draft: "adminEventInvoices.statuses.draft",
  issued: "adminEventInvoices.statuses.issued",
  cancelled: "adminEventInvoices.statuses.cancelled",
};
