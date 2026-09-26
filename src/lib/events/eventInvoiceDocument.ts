// Dokument faktury wydarzenia w ksztalcie dla ekranu i PDF.
//
// SKAD KSZTALT. `admin_event_invoice_get` (panel) i `event_my_invoice`
// (kupujacy) zwracaja ten sam obiekt z `_event_invoice_document` (migracja
// 20260926110000): `invoice` (wiersz bez migawki sprzedawcy), `seller`,
// `lines`, `corrects`, a panel dodatkowo `sources` i `corrections`. Typ
// generowany widzi w tym wylacznie `Json`, wiec odczyt jest JAWNY, pole po
// polu, z bezpiecznym zastepstwem - zadnego rzutowania wiersza na
// recznie napisany interfejs (`check:db-row-casts`).
//
// ZLY KSZTALT = `null`, a nie pol dokumentu. Ekran, ktory narysowalby
// fakture bez numeru i pozycji, bylby gorszy niz komunikat o bledzie.
import type { Json } from "@/integrations/supabase/types";
import {
  EVENT_INVOICE_CORRECTION_MODES,
  EVENT_INVOICE_KINDS,
  EVENT_INVOICE_KSEF_STATUSES,
  EVENT_INVOICE_LOCALES,
  EVENT_INVOICE_PAYMENT_METHODS,
  EVENT_INVOICE_SOURCE_KINDS,
  EVENT_INVOICE_STATUSES,
  pickEnum,
  type EventInvoiceCorrectionMode,
  type EventInvoiceKind,
  type EventInvoiceKsefStatus,
  type EventInvoiceLocale,
  type EventInvoicePaymentMethod,
  type EventInvoiceSourceKind,
  type EventInvoiceStatus,
} from "@/lib/events/eventInvoiceEnums";
import { EVENT_INVOICE_VAT_RATES, type EventInvoiceVatRate } from "@/lib/events/eventInvoiceMath";
import { buyerDraftFromColumns, type InvoiceBuyerDraft } from "@/lib/events/eventInvoiceBuyerDraft";

type JsonObject = { [key: string]: Json | undefined };

export function jsonRecord(value: Json | undefined): JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function jsonList(value: Json | undefined): Json[] {
  return Array.isArray(value) ? value : [];
}

export function jsonText(value: Json | undefined): string {
  return typeof value === "string" ? value : "";
}

export function jsonTextOrNull(value: Json | undefined): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

export function jsonNumber(value: Json | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function jsonBool(value: Json | undefined): boolean {
  return value === true;
}

export interface EventInvoiceSeller {
  name: string;
  taxId: string;
  address: string;
  postalCode: string;
  city: string;
  country: string;
  email: string;
  phone: string;
  bankAccount: string;
  bankSwift: string;
}

export interface EventInvoiceDocumentLine {
  id: string;
  position: number;
  description: string;
  unit: string;
  quantity: number;
  unitGrossCents: number;
  unitNetCents: number;
  vatRate: EventInvoiceVatRate;
  netCents: number;
  vatCents: number;
  grossCents: number;
  ticketTypeId: string | null;
  correctsLineId: string | null;
}

export interface EventInvoiceDocumentSource {
  id: string;
  sourceKind: EventInvoiceSourceKind;
  registrationId: string | null;
  packageOrderId: string | null;
  seats: number;
  grossCents: number;
  covers: boolean;
  releasedAt: string | null;
}

export interface EventInvoiceCorrectionRef {
  id: string;
  number: string | null;
  status: EventInvoiceStatus;
  correctionMode: EventInvoiceCorrectionMode;
}

export interface EventInvoiceDocument {
  id: string;
  eventId: string | null;
  eventSlug: string;
  eventTitlePl: string;
  eventTitleEn: string;
  kind: EventInvoiceKind;
  status: EventInvoiceStatus;
  number: string | null;
  issueDate: string | null;
  saleDate: string | null;
  dueDate: string | null;
  paymentMethod: EventInvoicePaymentMethod;
  paidAt: string | null;
  currency: string;
  netCents: number;
  vatCents: number;
  grossCents: number;
  vatExemptBasis: string;
  buyer: InvoiceBuyerDraft;
  locale: EventInvoiceLocale;
  note: string;
  ksefStatus: EventInvoiceKsefStatus;
  ksefNumber: string | null;
  correctionMode: EventInvoiceCorrectionMode | null;
  correctionReason: string;
  cancelReason: string;
  correctsInvoiceId: string | null;
  sourceProformaId: string | null;
  seller: EventInvoiceSeller;
  footerNote: string;
  lines: EventInvoiceDocumentLine[];
  corrects: { id: string; number: string | null; issueDate: string | null } | null;
  sources: EventInvoiceDocumentSource[];
  corrections: EventInvoiceCorrectionRef[];
}

function parseSeller(value: Json | undefined): EventInvoiceSeller {
  const row = jsonRecord(value);
  return {
    name: jsonText(row.seller_name),
    taxId: jsonText(row.seller_tax_id),
    address: jsonText(row.seller_address),
    postalCode: jsonText(row.seller_postal_code),
    city: jsonText(row.seller_city),
    country: jsonText(row.seller_country),
    email: jsonText(row.seller_email),
    phone: jsonText(row.seller_phone),
    bankAccount: jsonText(row.seller_bank_account),
    bankSwift: jsonText(row.seller_bank_swift),
  };
}

function parseLine(value: Json): EventInvoiceDocumentLine {
  const row = jsonRecord(value);
  return {
    id: jsonText(row.id),
    position: jsonNumber(row.position),
    description: jsonText(row.description),
    unit: jsonText(row.unit),
    quantity: jsonNumber(row.quantity),
    unitGrossCents: jsonNumber(row.unit_gross_cents),
    unitNetCents: jsonNumber(row.unit_net_cents),
    vatRate: pickEnum(EVENT_INVOICE_VAT_RATES, row.vat_rate),
    netCents: jsonNumber(row.net_cents),
    vatCents: jsonNumber(row.vat_cents),
    grossCents: jsonNumber(row.gross_cents),
    ticketTypeId: jsonTextOrNull(row.ticket_type_id),
    correctsLineId: jsonTextOrNull(row.corrects_line_id),
  };
}

function parseSource(value: Json): EventInvoiceDocumentSource {
  const row = jsonRecord(value);
  return {
    id: jsonText(row.id),
    sourceKind: pickEnum(EVENT_INVOICE_SOURCE_KINDS, row.source_kind),
    registrationId: jsonTextOrNull(row.registration_id),
    packageOrderId: jsonTextOrNull(row.package_order_id),
    seats: jsonNumber(row.seats),
    grossCents: jsonNumber(row.gross_cents),
    covers: jsonBool(row.covers),
    releasedAt: jsonTextOrNull(row.released_at),
  };
}

function parseCorrection(value: Json): EventInvoiceCorrectionRef {
  const row = jsonRecord(value);
  return {
    id: jsonText(row.id),
    number: jsonTextOrNull(row.number),
    status: pickEnum(EVENT_INVOICE_STATUSES, row.status),
    correctionMode: pickEnum(EVENT_INVOICE_CORRECTION_MODES, row.correction_mode),
  };
}

export function parseInvoiceDocument(value: Json | null): EventInvoiceDocument | null {
  const root = jsonRecord(value ?? undefined);
  const invoice = jsonRecord(root.invoice);
  const id = jsonText(invoice.id);
  if (id === "") return null;
  const corrects = jsonRecord(root.corrects);
  const correctsId = jsonText(corrects.id);
  const mode = invoice.correction_mode;
  return {
    id,
    eventId: jsonTextOrNull(invoice.event_id),
    eventSlug: jsonText(invoice.event_slug),
    eventTitlePl: jsonText(invoice.event_title_pl),
    eventTitleEn: jsonText(invoice.event_title_en),
    kind: pickEnum(EVENT_INVOICE_KINDS, invoice.kind),
    status: pickEnum(EVENT_INVOICE_STATUSES, invoice.status),
    number: jsonTextOrNull(invoice.number),
    issueDate: jsonTextOrNull(invoice.issue_date),
    saleDate: jsonTextOrNull(invoice.sale_date),
    dueDate: jsonTextOrNull(invoice.due_date),
    paymentMethod: pickEnum(EVENT_INVOICE_PAYMENT_METHODS, invoice.payment_method),
    paidAt: jsonTextOrNull(invoice.paid_at),
    currency: jsonText(invoice.currency) || "PLN",
    netCents: jsonNumber(invoice.net_cents),
    vatCents: jsonNumber(invoice.vat_cents),
    grossCents: jsonNumber(invoice.gross_cents),
    vatExemptBasis: jsonText(invoice.vat_exempt_basis),
    buyer: buyerDraftFromColumns({
      buyer_is_company: jsonBool(invoice.buyer_is_company),
      buyer_name: jsonText(invoice.buyer_name),
      buyer_tax_id: jsonText(invoice.buyer_tax_id),
      buyer_country: jsonText(invoice.buyer_country) || "PL",
      buyer_address: jsonText(invoice.buyer_address),
      buyer_postal_code: jsonText(invoice.buyer_postal_code),
      buyer_city: jsonText(invoice.buyer_city),
      buyer_email: jsonText(invoice.buyer_email),
      po_number: jsonText(invoice.po_number),
      recipient_name: jsonText(invoice.recipient_name),
      recipient_address: jsonText(invoice.recipient_address),
    }),
    locale: pickEnum(EVENT_INVOICE_LOCALES, invoice.locale),
    note: jsonText(invoice.note),
    ksefStatus: pickEnum(EVENT_INVOICE_KSEF_STATUSES, invoice.ksef_status),
    ksefNumber: jsonTextOrNull(invoice.ksef_number),
    correctionMode:
      typeof mode === "string" ? pickEnum(EVENT_INVOICE_CORRECTION_MODES, mode) : null,
    correctionReason: jsonText(invoice.correction_reason),
    cancelReason: jsonText(invoice.cancel_reason),
    correctsInvoiceId: jsonTextOrNull(invoice.corrects_invoice_id),
    sourceProformaId: jsonTextOrNull(invoice.source_proforma_id),
    seller: parseSeller(root.seller),
    footerNote: jsonText(root.footer_note),
    lines: jsonList(root.lines).map(parseLine),
    corrects:
      correctsId === ""
        ? null
        : {
            id: correctsId,
            number: jsonTextOrNull(corrects.number),
            issueDate: jsonTextOrNull(corrects.issue_date),
          },
    sources: jsonList(root.sources).map(parseSource),
    corrections: jsonList(root.corrections).map(parseCorrection),
  };
}
