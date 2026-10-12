// Dokument faktury wydarzenia w ksztalcie dla ekranu i PDF.
//
// SKAD KSZTALT. `admin_event_invoice_get` (panel) i `event_my_invoice`
// (kupujacy) zwracaja ten sam obiekt z `_event_invoice_document` (migracja
// 20260927000200): `invoice` (wiersz bez migawki sprzedawcy), `seller`,
// `lines`, `corrects`, a panel dodatkowo `sources`, `corrections`,
// `current_lines` (pozycje wystawionej faktury PO jej korektach - podstawa
// kolejnej korekty) i `correction_hint` (sprzedaz skurczyla sie po
// wystawieniu - powod albo NULL), `ksef_events` (dziennik stanu KSeF),
// `rate_gross_before` (szkic korekty: brutto w stawce przed nia) i `fx_need`
// (kurs NBP potrzebny do wystawienia, migracja 20261012100000). Typ
// generowany widzi w tym wylacznie `Json`, wiec odczyt jest JAWNY, pole po
// polu, z bezpiecznym zastepstwem - zadnego rzutowania wiersza na
// recznie napisany interfejs (`check:db-row-casts`).
//
// ZLY KSZTALT = `null`, a nie pol dokumentu. Ekran, ktory narysowalby
// fakture bez numeru i pozycji, bylby gorszy niz komunikat o bledzie.
import type { Json } from "@/integrations/supabase/types";
import {
  EVENT_INVOICE_CORRECTION_HINTS,
  EVENT_INVOICE_CORRECTION_MODES,
  EVENT_INVOICE_KINDS,
  EVENT_INVOICE_KSEF_STATUSES,
  EVENT_INVOICE_LOCALES,
  EVENT_INVOICE_PAYMENT_METHODS,
  EVENT_INVOICE_SOURCE_KINDS,
  EVENT_INVOICE_STATUSES,
  pickEnum,
  type EventInvoiceCorrectionHint,
  type EventInvoiceCorrectionMode,
  type EventInvoiceKind,
  type EventInvoiceKsefStatus,
  type EventInvoiceLocale,
  type EventInvoicePaymentMethod,
  type EventInvoiceSourceKind,
  type EventInvoiceStatus,
} from "@/lib/events/eventInvoiceEnums";
import {
  EVENT_INVOICE_VAT_RATES,
  isEventInvoiceVatRate,
  type EventInvoiceRateGross,
  type EventInvoiceVatRate,
  type EventInvoiceVatSummaryRow,
} from "@/lib/events/eventInvoiceMath";
import { buyerDraftFromColumns, type InvoiceBuyerDraft } from "@/lib/events/eventInvoiceBuyerDraft";

import {
  jsonBool,
  jsonList,
  jsonNumber,
  jsonRecord,
  jsonText,
  jsonTextOrNull,
} from "@/lib/events/eventInvoiceJson";

export { jsonBool, jsonList, jsonNumber, jsonRecord, jsonText, jsonTextOrNull };

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

/** Pozycja faktury PO wystawionych korektach (ilosc 0 = usunieta korekta). */
export interface EventInvoiceCurrentLine {
  /** Kotwica: pozycja faktury (albo dopisana korekta), na ktora wskazuje korekta. */
  lineId: string;
  description: string;
  unit: string;
  quantity: number;
  unitGrossCents: number;
  vatRate: EventInvoiceVatRate;
}

/** Wiersz podsumowania stawek ZAMROZONY na dokumencie (+ VAT w PLN przy walucie obcej). */
export interface EventInvoiceDocumentVatRow extends EventInvoiceVatSummaryRow {
  /** VAT w PLN po kursie NBP (art. 106e ust. 11) - tylko dokument w walucie obcej. */
  vatPlnCents: number | null;
}

/** Kurs sredni NBP z dokumentu (art. 31a ustawy o VAT). */
export interface EventInvoiceFx {
  rate: number;
  tableNo: string;
  effectiveDate: string;
  vatPlnCents: number;
}

/** Wpis dziennika stanu KSeF (`event_invoice_ksef_events`). */
export interface EventInvoiceKsefEvent {
  fromStatus: EventInvoiceKsefStatus | null;
  toStatus: EventInvoiceKsefStatus;
  fromNumber: string | null;
  toNumber: string | null;
  note: string;
  createdAt: string;
}

/** Wynik weryfikacji VIES nabywcy szkicu. */
export interface EventInvoiceVies {
  subject: string;
  valid: boolean;
  requestId: string | null;
  checkedAt: string;
}

/** Dzien kursu NBP potrzebny do wystawienia szkicu w walucie obcej. */
export interface EventInvoiceFxNeed {
  currency: string;
  rateDate: string;
  loaded: boolean;
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
  /** Podsumowanie stawek od SUMY w stawce (INV-16) - o kwocie podatku decyduje ono. */
  vatSummary: EventInvoiceDocumentVatRow[];
  /** Kurs NBP i VAT w PLN (INV-06); `null` = dokument w PLN albo szkic. */
  fx: EventInvoiceFx | null;
  /** Podstawa "np" zapisana na szkicu (pusta = z ustawien wystawcy). */
  npBasis: string;
  /** Podstawa "np", ktora trafi (albo trafila) na dokument. */
  npBasisEffective: string;
  /** Decyzja szkicu o odwrotnym obciazeniu (`null` = automatycznie). */
  reverseCharge: boolean | null;
  /** Czy dokument niesie adnotacje "odwrotne obciazenie". */
  reverseChargeEffective: boolean;
  buyerVies: EventInvoiceVies | null;
  /** Doreczenie nabywcy (INV-08): mail o wystawieniu / pobranie z profilu. */
  buyerNotifiedAt: string | null;
  buyerDownloadedAt: string | null;
  corrects: {
    id: string;
    number: string | null;
    issueDate: string | null;
    /** Numer KSeF faktury korygowanej (INV-17). */
    ksefNumber: string | null;
  } | null;
  sources: EventInvoiceDocumentSource[];
  corrections: EventInvoiceCorrectionRef[];
  currentLines: EventInvoiceCurrentLine[];
  /** Tylko panel: dlaczego wystawiona faktura wymaga korekty (NULL = nic). */
  correctionHint: EventInvoiceCorrectionHint | null;
  /** Tylko panel: dziennik stanu KSeF (najstarsze pierwsze). */
  ksefEvents: EventInvoiceKsefEvent[];
  /** Tylko panel, szkic korekty: brutto w stawce stanu przed korekta. */
  rateGrossBefore: EventInvoiceRateGross;
  /** Tylko panel: kurs NBP, ktorego wymaga wystawienie szkicu. */
  fxNeed: EventInvoiceFxNeed | null;
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

function parseCurrentLine(value: Json): EventInvoiceCurrentLine {
  const row = jsonRecord(value);
  return {
    lineId: jsonText(row.line_id),
    description: jsonText(row.description),
    unit: jsonText(row.unit),
    quantity: jsonNumber(row.quantity),
    unitGrossCents: jsonNumber(row.unit_gross_cents),
    vatRate: pickEnum(EVENT_INVOICE_VAT_RATES, row.vat_rate),
  };
}

/**
 * Wiersz podsumowania stawek. Nieznana stawka = wiersz POMINIETY, nie
 * "pierwsza stawka ze zbioru": podmiana dopisalaby kwoty do innej stawki
 * i wydrukowala na fakturze podatek, ktorego baza nie policzyla.
 */
function parseVatRow(value: Json): EventInvoiceDocumentVatRow[] {
  const row = jsonRecord(value);
  const rate = row.vat_rate;
  if (typeof rate !== "string" || !isEventInvoiceVatRate(rate)) return [];
  return [
    {
      vatRate: rate,
      netCents: jsonNumber(row.net_cents),
      vatCents: jsonNumber(row.vat_cents),
      grossCents: jsonNumber(row.gross_cents),
      vatPlnCents: typeof row.vat_pln_cents === "number" ? row.vat_pln_cents : null,
    },
  ];
}

function parseKsefEvent(value: Json): EventInvoiceKsefEvent {
  const row = jsonRecord(value);
  return {
    fromStatus:
      typeof row.from_status === "string"
        ? pickEnum(EVENT_INVOICE_KSEF_STATUSES, row.from_status)
        : null,
    toStatus: pickEnum(EVENT_INVOICE_KSEF_STATUSES, row.to_status),
    fromNumber: jsonTextOrNull(row.from_number),
    toNumber: jsonTextOrNull(row.to_number),
    note: jsonText(row.note),
    createdAt: jsonText(row.created_at),
  };
}

function parseRateGross(value: Json | undefined): EventInvoiceRateGross {
  const out: EventInvoiceRateGross = {};
  for (const [rate, gross] of Object.entries(jsonRecord(value))) {
    if (isEventInvoiceVatRate(rate) && typeof gross === "number") out[rate] = gross;
  }
  return out;
}

function parseFx(invoice: Record<string, Json | undefined>): EventInvoiceFx | null {
  const rate = invoice.fx_rate;
  const tableNo = jsonText(invoice.fx_table_no);
  const effectiveDate = jsonText(invoice.fx_effective_date);
  if (typeof rate !== "number" || rate <= 0 || tableNo === "" || effectiveDate === "") return null;
  return { rate, tableNo, effectiveDate, vatPlnCents: jsonNumber(invoice.vat_pln_cents) };
}

function parseVies(invoice: Record<string, Json | undefined>): EventInvoiceVies | null {
  const subject = jsonText(invoice.buyer_vies_subject);
  const checkedAt = jsonText(invoice.buyer_vies_checked_at);
  if (subject === "" || checkedAt === "") return null;
  return {
    subject,
    valid: jsonBool(invoice.buyer_vies_valid),
    requestId: jsonTextOrNull(invoice.buyer_vies_request_id),
    checkedAt,
  };
}

function parseFxNeed(value: Json | undefined): EventInvoiceFxNeed | null {
  const row = jsonRecord(value);
  const currency = jsonText(row.currency);
  const rateDate = jsonText(row.rate_date);
  if (currency === "" || rateDate === "") return null;
  return { currency, rateDate, loaded: jsonBool(row.loaded) };
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
    vatSummary: jsonList(root.vat_summary).flatMap(parseVatRow),
    fx: parseFx(invoice),
    npBasis: jsonText(invoice.np_basis),
    npBasisEffective: jsonText(invoice.np_basis_effective),
    reverseCharge: typeof invoice.reverse_charge === "boolean" ? invoice.reverse_charge : null,
    reverseChargeEffective: jsonBool(invoice.reverse_charge_effective),
    buyerVies: parseVies(invoice),
    buyerNotifiedAt: jsonTextOrNull(invoice.buyer_notified_at),
    buyerDownloadedAt: jsonTextOrNull(invoice.buyer_downloaded_at),
    corrects:
      correctsId === ""
        ? null
        : {
            id: correctsId,
            number: jsonTextOrNull(corrects.number),
            issueDate: jsonTextOrNull(corrects.issue_date),
            ksefNumber: jsonTextOrNull(corrects.ksef_number),
          },
    sources: jsonList(root.sources).map(parseSource),
    corrections: jsonList(root.corrections).map(parseCorrection),
    currentLines: jsonList(root.current_lines).map(parseCurrentLine),
    correctionHint:
      typeof root.correction_hint === "string"
        ? pickEnum(EVENT_INVOICE_CORRECTION_HINTS, root.correction_hint)
        : null,
    ksefEvents: jsonList(root.ksef_events).map(parseKsefEvent),
    rateGrossBefore: parseRateGross(root.rate_gross_before),
    fxNeed: parseFxNeed(root.fx_need),
  };
}
