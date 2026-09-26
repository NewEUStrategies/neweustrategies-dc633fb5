// Dane NABYWCY faktury wydarzenia - stan formularza i jego walidacja.
//
// JEDEN FORMULARZ, TRZY MIEJSCA. Te same pola wypelnia kupujacy przy
// platnosci za zapis, przy zakupie pakietu i pozniej z profilu, a organizator
// poprawia je na szkicu w studiu. Reguly sa lustrem `_event_invoice_buyer_clean`
// (migracja 20260926110000) - baza i tak odrzuci niepoprawne dane, ale
// kupujacy ma zobaczyc blad przy polu, zanim przejdzie do kasy, a nie po
// powrocie z niej.
//
// NIP WALIDUJE `validateTaxId` z modulu rozliczen - ta sama suma kontrolna,
// ktora ma profil rozliczeniowy, a jej blizniak w SQL-u pilnuje zapisu.
//
// KLUCZE BLEDOW SA PELNYMI LITERALAMI (nakladka `i18n-event-invoices`), bo
// bramki i18n nie widza kluczy skladanych z szablonu.
import type { Json } from "@/integrations/supabase/types";
import type { BillingProfile, BillingProfileInput } from "@/lib/billing/types";
import { validateTaxId } from "@/lib/billing/nip";

export interface InvoiceBuyerDraft {
  isCompany: boolean;
  name: string;
  taxId: string;
  country: string;
  address: string;
  postalCode: string;
  city: string;
  email: string;
  poNumber: string;
  recipientName: string;
  recipientAddress: string;
}

export type InvoiceBuyerField = keyof InvoiceBuyerDraft;

export const BUYER_ERROR_KEYS = {
  nameRequired: "eventInvoices.buyer.errors.nameRequired",
  nameTooLong: "eventInvoices.buyer.errors.nameTooLong",
  countryInvalid: "eventInvoices.buyer.errors.countryInvalid",
  taxIdRequired: "eventInvoices.buyer.errors.taxIdRequired",
  taxIdFormat: "eventInvoices.buyer.errors.taxIdFormat",
  taxIdChecksum: "eventInvoices.buyer.errors.taxIdChecksum",
  addressRequired: "eventInvoices.buyer.errors.addressRequired",
  postalCodeRequired: "eventInvoices.buyer.errors.postalCodeRequired",
  postalCodeFormat: "eventInvoices.buyer.errors.postalCodeFormat",
  cityRequired: "eventInvoices.buyer.errors.cityRequired",
  emailInvalid: "eventInvoices.buyer.errors.emailInvalid",
  tooLong: "eventInvoices.buyer.errors.tooLong",
} as const;

export type InvoiceBuyerErrorKey = (typeof BUYER_ERROR_KEYS)[keyof typeof BUYER_ERROR_KEYS];
export type InvoiceBuyerErrors = Partial<Record<InvoiceBuyerField, InvoiceBuyerErrorKey>>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PL_POSTAL_PATTERN = /^\d{2}-\d{3}$/;
const COUNTRY_PATTERN = /^[A-Z]{2}$/;

export function emptyBuyerDraft(): InvoiceBuyerDraft {
  return {
    isCompany: true,
    name: "",
    taxId: "",
    country: "PL",
    address: "",
    postalCode: "",
    city: "",
    email: "",
    poNumber: "",
    recipientName: "",
    recipientAddress: "",
  };
}

function countryOf(draft: InvoiceBuyerDraft): string {
  const country = draft.country.trim().toUpperCase();
  return country === "" ? "PL" : country;
}

/** Bledy pol; pusty obiekt = dane gotowe do zapisu. */
export function validateBuyerDraft(draft: InvoiceBuyerDraft): InvoiceBuyerErrors {
  const errors: InvoiceBuyerErrors = {};
  const name = draft.name.trim();
  const country = countryOf(draft);
  if (name.length < 2) errors.name = BUYER_ERROR_KEYS.nameRequired;
  else if (name.length > 200) errors.name = BUYER_ERROR_KEYS.nameTooLong;
  if (!COUNTRY_PATTERN.test(country)) errors.country = BUYER_ERROR_KEYS.countryInvalid;
  const tax = validateTaxId(draft.taxId, country);
  if (!tax.ok) {
    errors.taxId =
      tax.reason === "checksum" ? BUYER_ERROR_KEYS.taxIdChecksum : BUYER_ERROR_KEYS.taxIdFormat;
  } else if (draft.isCompany && tax.normalized === "") {
    errors.taxId = BUYER_ERROR_KEYS.taxIdRequired;
  }
  const address = draft.address.trim();
  if (address === "") errors.address = BUYER_ERROR_KEYS.addressRequired;
  else if (address.length > 200) errors.address = BUYER_ERROR_KEYS.tooLong;
  const postal = draft.postalCode.trim();
  if (postal === "") errors.postalCode = BUYER_ERROR_KEYS.postalCodeRequired;
  else if (postal.length > 20) errors.postalCode = BUYER_ERROR_KEYS.tooLong;
  else if (country === "PL" && !PL_POSTAL_PATTERN.test(postal)) {
    errors.postalCode = BUYER_ERROR_KEYS.postalCodeFormat;
  }
  const city = draft.city.trim();
  if (city === "") errors.city = BUYER_ERROR_KEYS.cityRequired;
  else if (city.length > 100) errors.city = BUYER_ERROR_KEYS.tooLong;
  const email = draft.email.trim();
  if (email !== "" && (email.length > 254 || !EMAIL_PATTERN.test(email))) {
    errors.email = BUYER_ERROR_KEYS.emailInvalid;
  }
  if (draft.poNumber.trim().length > 100) errors.poNumber = BUYER_ERROR_KEYS.tooLong;
  if (draft.recipientName.trim().length > 200) errors.recipientName = BUYER_ERROR_KEYS.tooLong;
  if (draft.recipientAddress.trim().length > 300) {
    errors.recipientAddress = BUYER_ERROR_KEYS.tooLong;
  }
  return errors;
}

export function hasBuyerErrors(errors: InvoiceBuyerErrors): boolean {
  return Object.keys(errors).length > 0;
}

/** Ladunek `buyer` RPC (snake_case, NIP znormalizowany, napisy przyciete). */
export function buyerDraftToPayload(draft: InvoiceBuyerDraft): { [key: string]: Json } {
  const country = countryOf(draft);
  const tax = validateTaxId(draft.taxId, country);
  return {
    is_company: draft.isCompany,
    name: draft.name.trim(),
    tax_id: tax.ok ? tax.normalized : draft.taxId.trim(),
    country,
    address: draft.address.trim(),
    postal_code: draft.postalCode.trim(),
    city: draft.city.trim(),
    email: draft.email.trim().toLowerCase(),
    po_number: draft.poNumber.trim(),
    recipient_name: draft.recipientName.trim(),
    recipient_address: draft.recipientAddress.trim(),
  };
}

/** Kolumny nabywcy wspolne dla prosby i dokumentu (`buyer_*`, `po_number`, odbiorca). */
export interface InvoiceBuyerColumns {
  buyer_is_company: boolean | null;
  buyer_name: string | null;
  buyer_tax_id: string | null;
  buyer_country: string | null;
  buyer_address: string | null;
  buyer_postal_code: string | null;
  buyer_city: string | null;
  buyer_email: string | null;
  po_number: string | null;
  recipient_name?: string | null;
  recipient_address?: string | null;
}

export function buyerDraftFromColumns(row: InvoiceBuyerColumns): InvoiceBuyerDraft {
  return {
    isCompany: row.buyer_is_company ?? true,
    name: row.buyer_name ?? "",
    taxId: row.buyer_tax_id ?? "",
    country: row.buyer_country ?? "PL",
    address: row.buyer_address ?? "",
    postalCode: row.buyer_postal_code ?? "",
    city: row.buyer_city ?? "",
    email: row.buyer_email ?? "",
    poNumber: row.po_number ?? "",
    recipientName: row.recipient_name ?? "",
    recipientAddress: row.recipient_address ?? "",
  };
}

/** Podpowiedz z profilu rozliczeniowego kupujacego (pola puste zostaja puste). */
export function buyerDraftFromBillingProfile(profile: BillingProfile): InvoiceBuyerDraft {
  const address = [profile.address_line1, profile.address_line2]
    .map((part) => (part ?? "").trim())
    .filter((part) => part !== "")
    .join(", ");
  return {
    ...emptyBuyerDraft(),
    isCompany: profile.is_company,
    name: (profile.is_company ? profile.company : profile.full_name) ?? "",
    taxId: profile.tax_id ?? "",
    country: profile.country_code,
    address,
    postalCode: profile.postal_code ?? "",
    city: profile.city ?? "",
    email: profile.email ?? "",
  };
}

/**
 * Dane nabywcy -> profil rozliczeniowy ("zapamietaj moje dane"). Telefon i
 * region NIE sa czescia faktury, wiec przechodza z dotychczasowego profilu.
 */
export function billingProfileFromBuyerDraft(
  draft: InvoiceBuyerDraft,
  current: BillingProfile | null,
): BillingProfileInput {
  const country = countryOf(draft);
  const tax = validateTaxId(draft.taxId, country);
  const name = draft.name.trim();
  return {
    full_name: draft.isCompany ? (current?.full_name ?? null) : name,
    company: draft.isCompany ? name : (current?.company ?? null),
    tax_id: tax.ok && tax.normalized !== "" ? tax.normalized : null,
    email: draft.email.trim() === "" ? (current?.email ?? null) : draft.email.trim().toLowerCase(),
    phone: current?.phone ?? null,
    address_line1: draft.address.trim(),
    address_line2: null,
    city: draft.city.trim(),
    postal_code: draft.postalCode.trim(),
    region: current?.region ?? null,
    country_code: country,
    is_company: draft.isCompany,
  };
}
