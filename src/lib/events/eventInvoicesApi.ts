// Warstwa danych FAKTUR WYDARZENIA w studiu organizatora.
//
// WSZYSTKO IDZIE PRZEZ RPC Z BRAMKA W BAZIE. Kazda funkcja `admin_event_invoice_*`
// zaczyna od `assert_event_admin_tenant()` (admin albo super_admin, nigdy
// redaktor), liczy sumy i numer u siebie i sama pilnuje niezmiennosci
// wystawionego dokumentu. Ten modul tylko tlumaczy camelCase na klucze
// ladunku i odczytuje odpowiedzi - kwot, numerow ani stanow nie liczy.
//
// KONWENCJA LADUNKU (jak w reszcie studia): klucz pominiety = "bez zmian",
// jawny `null` = "wyczysc". Blad RPC wraca jako `Error(message)`, zeby glowa
// komunikatu (`already_invoiced: ...`) dotarla do mapy bledow.
import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";
import {
  jsonList,
  jsonRecord,
  jsonText,
  jsonTextOrNull,
  parseInvoiceDocument,
  type EventInvoiceDocument,
} from "@/lib/events/eventInvoiceDocument";
import {
  EVENT_INVOICE_LOCALES,
  pickEnum,
  type EventInvoiceCorrectionMode,
  type EventInvoiceKsefStatus,
  type EventInvoiceLocale,
  type EventInvoicePaymentMethod,
  type EventInvoiceSourceKind,
} from "@/lib/events/eventInvoiceEnums";
import { EVENT_INVOICE_VAT_RATES, type EventInvoiceVatRate } from "@/lib/events/eventInvoiceMath";
import { buyerDraftToPayload, type InvoiceBuyerDraft } from "@/lib/events/eventInvoiceBuyerDraft";

type Fns = Database["public"]["Functions"];

/**
 * Kolumny `RETURNS TABLE`, ktore baza oddaje jako NULL, a generator typow
 * obiecuje jako wartosc (znany falsz generatora - wzorzec `EventTicketRow`
 * w `registrationsApi.ts`). Zawezenie kontraktu: kto siegnie po taka kolumne
 * bez sprawdzenia pustki, dostaje blad typu, a atrapy testow nie musza
 * przemycac `null` rzutowaniem.
 */
export type WithNullable<T, K extends keyof T> = Omit<T, K> & { [P in K]: T[P] | null };

/** LEFT JOIN-y prosby, faktury i proformy + zamowienie bez zaplaty. */
export type EventInvoiceCandidateRow = WithNullable<
  Fns["admin_event_invoice_candidates"]["Returns"][number],
  | "request_id"
  | "request_status"
  | "buyer_is_company"
  | "buyer_name"
  | "buyer_tax_id"
  | "buyer_email"
  | "invoice_id"
  | "invoice_number"
  | "invoice_status"
  | "proforma_id"
  | "proforma_number"
  | "tax_key"
  | "ticket_type_id"
  | "paid_at"
>;

/** Szkic nie ma numeru ani dat wystawienia; faktura nie ma korekty ani proformy. */
export type EventInvoiceListRow = WithNullable<
  Fns["admin_event_invoices_list"]["Returns"][number],
  | "number"
  | "issue_date"
  | "sale_date"
  | "due_date"
  | "ksef_number"
  | "paid_at"
  | "corrects_invoice_id"
  | "corrects_number"
  | "correction_mode"
  | "source_proforma_id"
  | "converted_invoice_id"
  | "issued_at"
  | "cancelled_at"
>;

function payload(input: Record<string, Json | undefined>): Json {
  const out: { [key: string]: Json } = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function fail(error: { message: string } | null): void {
  if (error !== null) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// Ustawienia wystawcy (wspolne dla wszystkich wydarzen najemcy).
// ---------------------------------------------------------------------------
export interface EventInvoiceSettings {
  enabled: boolean;
  confirmedAt: string | null;
  sellerName: string;
  sellerTaxId: string;
  sellerAddress: string;
  sellerPostalCode: string;
  sellerCity: string;
  sellerCountry: string;
  sellerEmail: string;
  sellerPhone: string;
  sellerBankAccount: string;
  sellerBankSwift: string;
  seriesInvoice: string;
  seriesProforma: string;
  seriesCorrection: string;
  paymentDays: number;
  defaultVatRate: EventInvoiceVatRate;
  vatExemptBasis: string;
  footerNote: string;
  defaultLocale: EventInvoiceLocale;
}

export function parseInvoiceSettings(value: Json | null): EventInvoiceSettings {
  const row = jsonRecord(value ?? undefined);
  return {
    enabled: row.enabled === true,
    confirmedAt: jsonTextOrNull(row.confirmed_at),
    sellerName: jsonText(row.seller_name),
    sellerTaxId: jsonText(row.seller_tax_id),
    sellerAddress: jsonText(row.seller_address),
    sellerPostalCode: jsonText(row.seller_postal_code),
    sellerCity: jsonText(row.seller_city),
    sellerCountry: jsonText(row.seller_country) || "PL",
    sellerEmail: jsonText(row.seller_email),
    sellerPhone: jsonText(row.seller_phone),
    sellerBankAccount: jsonText(row.seller_bank_account),
    sellerBankSwift: jsonText(row.seller_bank_swift),
    seriesInvoice: jsonText(row.series_invoice) || "FV",
    seriesProforma: jsonText(row.series_proforma) || "PRO",
    seriesCorrection: jsonText(row.series_correction) || "KOR",
    paymentDays: typeof row.payment_days === "number" ? row.payment_days : 14,
    defaultVatRate: pickEnum(EVENT_INVOICE_VAT_RATES, row.default_vat_rate),
    vatExemptBasis: jsonText(row.vat_exempt_basis),
    footerNote: jsonText(row.footer_note),
    defaultLocale: pickEnum(EVENT_INVOICE_LOCALES, row.default_locale),
  };
}

export async function fetchInvoiceSettings(): Promise<EventInvoiceSettings> {
  const { data, error } = await supabase.rpc("admin_event_invoice_settings_get");
  fail(error);
  return parseInvoiceSettings(data);
}

export interface EventInvoiceSettingsInput {
  enabled: boolean;
  sellerName: string;
  sellerTaxId: string;
  sellerAddress: string;
  sellerPostalCode: string;
  sellerCity: string;
  sellerCountry: string;
  sellerEmail: string;
  sellerPhone: string;
  sellerBankAccount: string;
  sellerBankSwift: string;
  seriesInvoice: string;
  seriesProforma: string;
  seriesCorrection: string;
  paymentDays: number;
  defaultVatRate: EventInvoiceVatRate;
  vatExemptBasis: string;
  footerNote: string;
  defaultLocale: EventInvoiceLocale;
  /** Jednorazowe potwierdzenie "organizator jest sprzedawca" przy pierwszym wlaczeniu. */
  confirmSeller: boolean;
}

export async function saveInvoiceSettings(
  input: EventInvoiceSettingsInput,
): Promise<EventInvoiceSettings> {
  const { data, error } = await supabase.rpc("admin_event_invoice_settings_save", {
    p_payload: payload({
      enabled: input.enabled,
      seller_name: input.sellerName,
      seller_tax_id: input.sellerTaxId,
      seller_address: input.sellerAddress,
      seller_postal_code: input.sellerPostalCode,
      seller_city: input.sellerCity,
      seller_country: input.sellerCountry,
      seller_email: input.sellerEmail,
      seller_phone: input.sellerPhone,
      seller_bank_account: input.sellerBankAccount,
      seller_bank_swift: input.sellerBankSwift,
      series_invoice: input.seriesInvoice,
      series_proforma: input.seriesProforma,
      series_correction: input.seriesCorrection,
      payment_days: input.paymentDays,
      default_vat_rate: input.defaultVatRate,
      vat_exempt_basis: input.vatExemptBasis,
      footer_note: input.footerNote,
      default_locale: input.defaultLocale,
      confirm_seller: input.confirmSeller ? true : undefined,
    }),
  });
  fail(error);
  return parseInvoiceSettings(data);
}

// ---------------------------------------------------------------------------
// Listy wydarzenia.
// ---------------------------------------------------------------------------
export async function fetchInvoiceCandidates(eventId: string): Promise<EventInvoiceCandidateRow[]> {
  const { data, error } = await supabase.rpc("admin_event_invoice_candidates", {
    p_event_id: eventId,
  });
  fail(error);
  return data ?? [];
}

export async function fetchEventInvoices(eventId: string): Promise<EventInvoiceListRow[]> {
  const { data, error } = await supabase.rpc("admin_event_invoices_list", { p_event_id: eventId });
  fail(error);
  return data ?? [];
}

export async function fetchEventInvoice(id: string): Promise<EventInvoiceDocument> {
  const { data, error } = await supabase.rpc("admin_event_invoice_get", { p_id: id });
  fail(error);
  const doc = parseInvoiceDocument(data);
  if (doc === null) throw new Error("unknown: document response is not readable");
  return doc;
}

// ---------------------------------------------------------------------------
// Szkic, wystawienie, korekta, proforma.
// ---------------------------------------------------------------------------
export interface InvoiceSourceRef {
  kind: EventInvoiceSourceKind;
  id: string;
}

export type EventInvoiceAggregate = "per_source" | "per_ticket_type";

export interface CreateInvoiceDraftInput {
  eventId: string;
  kind: "invoice" | "proforma";
  sources: readonly InvoiceSourceRef[];
  aggregate: EventInvoiceAggregate;
  requestId?: string | null;
}

export async function createInvoiceDraft(input: CreateInvoiceDraftInput): Promise<string> {
  const { data, error } = await supabase.rpc("admin_event_invoice_draft_create", {
    p_payload: payload({
      event_id: input.eventId,
      kind: input.kind,
      aggregate: input.aggregate,
      request_id: input.requestId ?? undefined,
      sources: input.sources.map((source) => ({ kind: source.kind, id: source.id })),
    }),
  });
  fail(error);
  return String(data);
}

export interface InvoiceLineInput {
  description: string;
  unit: string;
  quantity: number;
  unitGrossCents: number;
  vatRate: EventInvoiceVatRate;
  ticketTypeId: string | null;
  correctsLineId: string | null;
}

export interface UpdateInvoiceDraftInput {
  id: string;
  buyer?: InvoiceBuyerDraft;
  saleDate?: string | null;
  dueDate?: string | null;
  paymentMethod?: EventInvoicePaymentMethod;
  paidAt?: string | null;
  locale?: EventInvoiceLocale;
  note?: string;
  correctionReason?: string;
  lines?: readonly InvoiceLineInput[];
}

export async function updateInvoiceDraft(input: UpdateInvoiceDraftInput): Promise<string> {
  const { data, error } = await supabase.rpc("admin_event_invoice_draft_update", {
    p_payload: payload({
      id: input.id,
      buyer: input.buyer === undefined ? undefined : buyerDraftToPayload(input.buyer),
      sale_date: input.saleDate,
      due_date: input.dueDate,
      payment_method: input.paymentMethod,
      paid_at: input.paidAt,
      locale: input.locale,
      note: input.note,
      correction_reason: input.correctionReason,
      lines: input.lines?.map((line) => ({
        description: line.description,
        unit: line.unit,
        quantity: line.quantity,
        unit_gross_cents: line.unitGrossCents,
        vat_rate: line.vatRate,
        ticket_type_id: line.ticketTypeId,
        corrects_line_id: line.correctsLineId,
      })),
    }),
  });
  fail(error);
  return String(data);
}

export interface IssuedInvoice {
  id: string;
  number: string;
}

export async function issueInvoice(id: string): Promise<IssuedInvoice> {
  const { data, error } = await supabase.rpc("admin_event_invoice_issue", { p_id: id });
  fail(error);
  const row = jsonRecord(data ?? undefined);
  return { id: jsonText(row.id) || id, number: jsonText(row.number) };
}

export interface IssuePendingResult {
  issued: IssuedInvoice[];
  /** Kod odmowy (glowa bledu SQL) na grupe prosb, ktorej nie udalo sie wystawic. */
  failed: { requestIds: string[]; code: string }[];
}

export async function issuePendingInvoices(
  eventId: string,
  collective: boolean,
): Promise<IssuePendingResult> {
  const { data, error } = await supabase.rpc("admin_event_invoice_issue_pending", {
    p_payload: { event_id: eventId, collective },
  });
  fail(error);
  const row = jsonRecord(data ?? undefined);
  return {
    issued: jsonList(row.issued).map((item) => {
      const entry = jsonRecord(item);
      return { id: jsonText(entry.invoice_id), number: jsonText(entry.number) };
    }),
    failed: jsonList(row.failed).map((item) => {
      const entry = jsonRecord(item);
      return {
        requestIds: jsonList(entry.request_ids).map((value) => jsonText(value)),
        code: jsonText(entry.code),
      };
    }),
  };
}

export async function cancelInvoice(id: string, reason: string): Promise<string> {
  const { data, error } = await supabase.rpc("admin_event_invoice_cancel", {
    p_payload: { id, reason },
  });
  fail(error);
  return String(data);
}

export interface CorrectionLineChange {
  lineId: string;
  quantity: number;
  unitGrossCents: number;
  vatRate: EventInvoiceVatRate;
}

export interface CreateCorrectionInput {
  invoiceId: string;
  mode: EventInvoiceCorrectionMode;
  reason: string;
  lines?: readonly CorrectionLineChange[];
}

export async function createInvoiceCorrection(input: CreateCorrectionInput): Promise<string> {
  const { data, error } = await supabase.rpc("admin_event_invoice_correction_create", {
    p_payload: payload({
      invoice_id: input.invoiceId,
      mode: input.mode,
      reason: input.reason,
      lines: input.lines?.map((line) => ({
        line_id: line.lineId,
        quantity: line.quantity,
        unit_gross_cents: line.unitGrossCents,
        vat_rate: line.vatRate,
      })),
    }),
  });
  fail(error);
  return String(data);
}

export async function invoiceFromProforma(id: string): Promise<string> {
  const { data, error } = await supabase.rpc("admin_event_invoice_from_proforma", { p_id: id });
  fail(error);
  return String(data);
}

export async function updateInvoiceKsef(input: {
  id: string;
  status: EventInvoiceKsefStatus;
  number: string;
}): Promise<string> {
  const { data, error } = await supabase.rpc("admin_event_invoice_ksef_update", {
    p_payload: { id: input.id, status: input.status, number: input.number },
  });
  fail(error);
  return String(data);
}

export async function setInvoicePaid(input: { id: string; paidAt: string | null }): Promise<string> {
  const { data, error } = await supabase.rpc("admin_event_invoice_set_paid", {
    p_payload: { id: input.id, paid_at: input.paidAt },
  });
  fail(error);
  return String(data);
}

/** Sumy liczb zrodel (dla ostrzezenia "pozycje rozjechaly sie z zamowieniami"). */
export function sourcesGrossCents(doc: EventInvoiceDocument): number {
  return doc.sources.reduce((sum, source) => sum + source.grossCents, 0);
}
