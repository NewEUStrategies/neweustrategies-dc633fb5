// Wiersze i dokumenty FAKTUR WYDARZEN dla testow warstwy danych i ekranow.
//
// KSZTALT Z SYGNATURY RPC. `EventInvoiceCandidateRow` i `EventInvoiceListRow`
// to aliasy na `Returns[number]` wygenerowanych typow, a dokument jest JSON-em
// w ksztalcie `_event_invoice_document` + dodatki `admin_event_invoice_get`
// (migracja 20260926110000) - dokladnie to, co oddaje PostgREST.
//
// KOLUMNY NULL-OWALNE IDA ZA BAZA, NIE ZA GENERATOREM (jak `adminSalesRows.ts`):
// generator obiecuje `string` takze tam, gdzie `RETURNS TABLE` oddaje `null`
// (brak prosby, brak faktury, szkic bez numeru). Front ma na to jawne
// warunki, wiec fixtura musi umiec oddac `null`.
//
// Kwoty w groszach; identyfikatory w ksztalcie UUID; adresy wylacznie
// `example.com` / `example.org` (dane syntetyczne).
import type { Json } from "@/integrations/supabase/types";
import type { EventInvoiceCandidateRow, EventInvoiceListRow } from "@/lib/events/eventInvoicesApi";
import type { MyInvoiceRow, MyInvoiceSourceRow } from "@/lib/events/myEventInvoicesApi";

const NULLOWALNY_NAPIS: string | null = null;

export const INVOICE_IDS = {
  event: "27e00000-0000-4000-8000-0000000000e1",
  invoice: "27f00000-0000-4000-8000-000000000001",
  proforma: "27f00000-0000-4000-8000-000000000002",
  correction: "27f00000-0000-4000-8000-000000000003",
  draft: "27f00000-0000-4000-8000-000000000004",
  line1: "27f10000-0000-4000-8000-000000000001",
  line2: "27f10000-0000-4000-8000-000000000002",
  registration: "27400000-0000-4000-8000-000000000001",
  registration2: "27400000-0000-4000-8000-000000000002",
  packageOrder: "27900000-0000-4000-8000-000000000001",
  request: "27a00000-0000-4000-8000-000000000001",
  ticketType: "27100000-0000-4000-8000-000000000001",
} as const;

export function invoiceCandidateRow(
  overrides: Partial<EventInvoiceCandidateRow> = {},
): EventInvoiceCandidateRow {
  return {
    amount_source: "order",
    buyer_email: "ksiegowosc@acme.example.com",
    buyer_is_company: true,
    buyer_name: "Acme Sp. z o.o.",
    buyer_tax_id: "5260250274",
    company_text: "Acme",
    created_at: "2026-09-20T10:00:00.000Z",
    currency: "PLN",
    gross_cents: 24601,
    invoice_id: NULLOWALNY_NAPIS,
    invoice_number: NULLOWALNY_NAPIS,
    invoice_status: NULLOWALNY_NAPIS,
    label_en: "Standard",
    label_pl: "Standard",
    paid_at: "2026-09-20T10:05:00.000Z",
    paid_via: "card",
    payment_state: "paid",
    person_email: "anna@example.com",
    person_name: "Anna Kupujaca",
    proforma_id: NULLOWALNY_NAPIS,
    proforma_number: NULLOWALNY_NAPIS,
    request_id: INVOICE_IDS.request,
    request_status: "pending",
    seats: 2,
    source_id: INVOICE_IDS.registration,
    source_kind: "registration",
    tax_key: "5260250274",
    ticket_type_id: INVOICE_IDS.ticketType,
    ...overrides,
  };
}

export function invoiceListRow(overrides: Partial<EventInvoiceListRow> = {}): EventInvoiceListRow {
  return {
    buyer_email: "ksiegowosc@acme.example.com",
    buyer_is_company: true,
    buyer_name: "Acme Sp. z o.o.",
    buyer_tax_id: "5260250274",
    cancelled_at: NULLOWALNY_NAPIS,
    converted_invoice_id: NULLOWALNY_NAPIS,
    correction_mode: NULLOWALNY_NAPIS,
    corrects_invoice_id: NULLOWALNY_NAPIS,
    corrects_number: NULLOWALNY_NAPIS,
    created_at: "2026-09-20T10:00:00.000Z",
    currency: "PLN",
    due_date: "2026-09-20",
    gross_cents: 24601,
    id: INVOICE_IDS.invoice,
    issue_date: "2026-09-20",
    issued_at: "2026-09-20T10:10:00.000Z",
    kind: "invoice",
    ksef_number: NULLOWALNY_NAPIS,
    ksef_status: "pending",
    locale: "pl",
    net_cents: 20001,
    number: "FV/2026/09/0001",
    paid_at: "2026-09-20T10:05:00.000Z",
    sale_date: "2026-09-20",
    source_count: 1,
    source_proforma_id: NULLOWALNY_NAPIS,
    status: "issued",
    vat_cents: 4600,
    ...overrides,
  };
}

export function myInvoiceSourceRow(overrides: Partial<MyInvoiceSourceRow> = {}): MyInvoiceSourceRow {
  return {
    buyer_address: NULLOWALNY_NAPIS,
    buyer_city: NULLOWALNY_NAPIS,
    buyer_country: NULLOWALNY_NAPIS,
    buyer_email: NULLOWALNY_NAPIS,
    buyer_is_company: true,
    buyer_name: NULLOWALNY_NAPIS,
    buyer_postal_code: NULLOWALNY_NAPIS,
    buyer_tax_id: NULLOWALNY_NAPIS,
    can_request: true,
    created_at: "2026-09-20T10:00:00.000Z",
    currency: "PLN",
    event_id: INVOICE_IDS.event,
    event_slug: "kongres-27",
    event_title_en: "Congress 27",
    event_title_pl: "Kongres 27",
    gross_cents: 24601,
    invoice_id: NULLOWALNY_NAPIS,
    invoice_number: NULLOWALNY_NAPIS,
    label_en: "Standard",
    label_pl: "Standard",
    paid_at: "2026-09-20T10:05:00.000Z",
    payment_state: "paid",
    po_number: NULLOWALNY_NAPIS,
    request_deadline: "2026-12-31",
    request_id: NULLOWALNY_NAPIS,
    request_status: NULLOWALNY_NAPIS,
    seats: 2,
    source_id: INVOICE_IDS.registration,
    source_kind: "registration",
    ...overrides,
  };
}

export function myInvoiceRow(overrides: Partial<MyInvoiceRow> = {}): MyInvoiceRow {
  return {
    buyer_name: "Acme Sp. z o.o.",
    corrects_number: NULLOWALNY_NAPIS,
    currency: "PLN",
    due_date: "2026-09-20",
    event_id: INVOICE_IDS.event,
    event_slug: "kongres-27",
    event_title_en: "Congress 27",
    event_title_pl: "Kongres 27",
    gross_cents: 24601,
    id: INVOICE_IDS.invoice,
    issue_date: "2026-09-20",
    kind: "invoice",
    number: "FV/2026/09/0001",
    paid_at: "2026-09-20T10:05:00.000Z",
    status: "issued",
    ...overrides,
  };
}

type JsonObject = { [key: string]: Json };

/** Wiersz `event_invoices` w `invoice` dokumentu (bez tenant_id i migawki sprzedawcy). */
export function invoiceJson(overrides: JsonObject = {}): JsonObject {
  return {
    id: INVOICE_IDS.invoice,
    event_id: INVOICE_IDS.event,
    event_slug: "kongres-27",
    event_title_pl: "Kongres 27",
    event_title_en: "Congress 27",
    kind: "invoice",
    status: "issued",
    series: "FV",
    period: "2026-09",
    seq: 1,
    number: "FV/2026/09/0001",
    issue_date: "2026-09-20",
    sale_date: "2026-09-20",
    due_date: "2026-10-04",
    payment_method: "transfer",
    paid_at: null,
    currency: "PLN",
    net_cents: 20001,
    vat_cents: 4600,
    gross_cents: 24601,
    vat_exempt_basis: "",
    buyer_is_company: true,
    buyer_name: "Acme Sp. z o.o.",
    buyer_tax_id: "5260250274",
    buyer_country: "PL",
    buyer_address: "ul. Morska 5",
    buyer_postal_code: "80-001",
    buyer_city: "Gdansk",
    buyer_email: "ksiegowosc@acme.example.com",
    po_number: "PO-27",
    recipient_name: "",
    recipient_address: "",
    corrects_invoice_id: null,
    correction_mode: null,
    correction_reason: "",
    source_proforma_id: null,
    locale: "pl",
    note: "",
    ksef_status: "pending",
    ksef_number: null,
    cancel_reason: "",
    ...overrides,
  };
}

export function invoiceLineJson(overrides: JsonObject = {}): JsonObject {
  return {
    id: INVOICE_IDS.line1,
    position: 1,
    description: "Bilet: Standard - Kongres 27",
    unit: "szt.",
    quantity: 1,
    unit_gross_cents: 12300,
    unit_net_cents: 10000,
    vat_rate: "23",
    net_cents: 10000,
    vat_cents: 2300,
    gross_cents: 12300,
    ticket_type_id: INVOICE_IDS.ticketType,
    corrects_line_id: null,
    ...overrides,
  };
}

export const SELLER_JSON: JsonObject = {
  seller_name: "Organizator 27 Sp. z o.o.",
  seller_tax_id: "7011278375",
  seller_address: "ul. Dluga 1",
  seller_postal_code: "00-001",
  seller_city: "Warszawa",
  seller_country: "PL",
  seller_email: "faktury@org27.example.com",
  seller_phone: "+48 22 000 00 00",
  seller_bank_account: "PL61109010140000071219812874",
  seller_bank_swift: "WBKPPLPP",
  footer_note: "Dziekujemy",
};

/** Pelna odpowiedz `admin_event_invoice_get` (dwie pozycje, jedno zrodlo). */
export function invoiceDocumentJson(overrides: { invoice?: JsonObject } & JsonObject = {}): JsonObject {
  const { invoice, ...rest } = overrides;
  return {
    invoice: invoiceJson(invoice ?? {}),
    seller: SELLER_JSON,
    footer_note: "Dziekujemy za udzial",
    lines: [
      invoiceLineJson(),
      invoiceLineJson({
        id: INVOICE_IDS.line2,
        position: 2,
        unit_gross_cents: 12301,
        net_cents: 10001,
        vat_cents: 2300,
        gross_cents: 12301,
        unit_net_cents: 10001,
      }),
    ],
    vat_summary: [{ vat_rate: "23", net_cents: 20001, vat_cents: 4600, gross_cents: 24601 }],
    corrects: null,
    sources: [
      {
        id: "27f20000-0000-4000-8000-000000000001",
        source_kind: "registration",
        registration_id: INVOICE_IDS.registration,
        package_order_id: null,
        payment_order_id: null,
        seats: 2,
        gross_cents: 24601,
        paid_at: "2026-09-20T10:05:00.000Z",
        covers: true,
        released_at: null,
      },
    ],
    corrections: [],
    ...rest,
  };
}

/** Odpowiedz `admin_event_invoice_settings_get` (wlaczone, kompletne). */
export function invoiceSettingsJson(overrides: JsonObject = {}): JsonObject {
  return {
    enabled: true,
    confirmed_at: "2026-09-01T08:00:00.000Z",
    seller_name: "Organizator 27 Sp. z o.o.",
    seller_tax_id: "7011278375",
    seller_address: "ul. Dluga 1",
    seller_postal_code: "00-001",
    seller_city: "Warszawa",
    seller_country: "PL",
    seller_email: "faktury@org27.example.com",
    seller_phone: "",
    seller_bank_account: "PL61109010140000071219812874",
    seller_bank_swift: "WBKPPLPP",
    series_invoice: "FV",
    series_proforma: "PRO",
    series_correction: "KOR",
    payment_days: 14,
    default_vat_rate: "23",
    vat_exempt_basis: "",
    footer_note: "",
    default_locale: "pl",
    updated_at: "2026-09-01T08:00:00.000Z",
    ...overrides,
  };
}
