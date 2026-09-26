// Formularz USTAWIEN WYSTAWCY faktur wydarzen - czysty stan i walidacja.
//
// USTAWIENIA SA WSPOLNE DLA NAJEMCY, nie dla wydarzenia: dane sprzedawcy,
// rachunek, prefiksy serii i domyslna stawka obowiazuja kazde wydarzenie
// organizatora. Reguly sa lustrem `admin_event_invoice_settings_save`
// (migracja 20260926110000): wlaczenie wymaga kompletu danych sprzedawcy
// i - przy PIERWSZYM wlaczeniu - jawnego potwierdzenia, ze organizator jest
// sprzedawca biletow. Baza odrzuci niepelne dane i tak; formularz ma
// powiedziec to przy polu.
import { validateTaxId } from "@/lib/billing/nip";
import type { EventInvoiceLocale } from "@/lib/events/eventInvoiceEnums";
import type { EventInvoiceVatRate } from "@/lib/events/eventInvoiceMath";
import type {
  EventInvoiceSettings,
  EventInvoiceSettingsInput,
} from "@/lib/events/eventInvoicesApi";

export interface InvoiceSettingsDraft {
  enabled: boolean;
  confirmSeller: boolean;
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
  paymentDays: string;
  defaultVatRate: EventInvoiceVatRate;
  vatExemptBasis: string;
  footerNote: string;
  defaultLocale: EventInvoiceLocale;
}

export type InvoiceSettingsField = keyof InvoiceSettingsDraft;

export const SETTINGS_ERROR_KEYS = {
  required: "adminEventInvoices.settings.errors.required",
  taxId: "adminEventInvoices.settings.errors.taxId",
  country: "adminEventInvoices.settings.errors.country",
  email: "adminEventInvoices.settings.errors.email",
  series: "adminEventInvoices.settings.errors.series",
  seriesDistinct: "adminEventInvoices.settings.errors.seriesDistinct",
  paymentDays: "adminEventInvoices.settings.errors.paymentDays",
  exemptBasis: "adminEventInvoices.settings.errors.exemptBasis",
  confirm: "adminEventInvoices.settings.errors.confirm",
  tooLong: "adminEventInvoices.settings.errors.tooLong",
} as const;

export type InvoiceSettingsErrorKey =
  (typeof SETTINGS_ERROR_KEYS)[keyof typeof SETTINGS_ERROR_KEYS];
export type InvoiceSettingsErrors = Partial<Record<InvoiceSettingsField, InvoiceSettingsErrorKey>>;

const SERIES_PATTERN = /^[A-Z0-9]{1,10}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

type LimitedField =
  | "sellerName"
  | "sellerAddress"
  | "sellerPostalCode"
  | "sellerCity"
  | "sellerEmail"
  | "sellerPhone"
  | "sellerBankAccount"
  | "sellerBankSwift"
  | "vatExemptBasis"
  | "footerNote";

const LIMITS: ReadonlyArray<readonly [LimitedField, number]> = [
  ["sellerName", 200],
  ["sellerAddress", 200],
  ["sellerPostalCode", 20],
  ["sellerCity", 100],
  ["sellerEmail", 254],
  ["sellerPhone", 40],
  ["sellerBankAccount", 64],
  ["sellerBankSwift", 20],
  ["vatExemptBasis", 300],
  ["footerNote", 500],
];

export function settingsDraftFromSettings(settings: EventInvoiceSettings): InvoiceSettingsDraft {
  return {
    enabled: settings.enabled,
    confirmSeller: false,
    sellerName: settings.sellerName,
    sellerTaxId: settings.sellerTaxId,
    sellerAddress: settings.sellerAddress,
    sellerPostalCode: settings.sellerPostalCode,
    sellerCity: settings.sellerCity,
    sellerCountry: settings.sellerCountry,
    sellerEmail: settings.sellerEmail,
    sellerPhone: settings.sellerPhone,
    sellerBankAccount: settings.sellerBankAccount,
    sellerBankSwift: settings.sellerBankSwift,
    seriesInvoice: settings.seriesInvoice,
    seriesProforma: settings.seriesProforma,
    seriesCorrection: settings.seriesCorrection,
    paymentDays: String(settings.paymentDays),
    defaultVatRate: settings.defaultVatRate,
    vatExemptBasis: settings.vatExemptBasis,
    footerNote: settings.footerNote,
    defaultLocale: settings.defaultLocale,
  };
}

function series(value: string): string {
  return value.trim().toUpperCase();
}

/**
 * Bledy pol. `confirmedAt` = czy potwierdzenie sprzedawcy juz zapadlo
 * (drugie wlaczenie nie pyta ponownie).
 */
export function validateSettingsDraft(
  draft: InvoiceSettingsDraft,
  confirmedAt: string | null,
): InvoiceSettingsErrors {
  const errors: InvoiceSettingsErrors = {};
  for (const [field, limit] of LIMITS) {
    if (draft[field].trim().length > limit) errors[field] = SETTINGS_ERROR_KEYS.tooLong;
  }
  const country = draft.sellerCountry.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) errors.sellerCountry = SETTINGS_ERROR_KEYS.country;
  const tax = validateTaxId(draft.sellerTaxId, country);
  if (!tax.ok) errors.sellerTaxId = SETTINGS_ERROR_KEYS.taxId;
  const email = draft.sellerEmail.trim();
  if (email !== "" && !EMAIL_PATTERN.test(email)) errors.sellerEmail = SETTINGS_ERROR_KEYS.email;
  for (const field of ["seriesInvoice", "seriesProforma", "seriesCorrection"] as const) {
    if (!SERIES_PATTERN.test(series(draft[field]))) errors[field] = SETTINGS_ERROR_KEYS.series;
  }
  const prefixes = [draft.seriesInvoice, draft.seriesProforma, draft.seriesCorrection].map(series);
  if (errors.seriesCorrection === undefined && new Set(prefixes).size < prefixes.length) {
    errors.seriesCorrection = SETTINGS_ERROR_KEYS.seriesDistinct;
  }
  const days = draft.paymentDays.trim();
  if (!/^\d{1,3}$/.test(days) || Number(days) > 120) {
    errors.paymentDays = SETTINGS_ERROR_KEYS.paymentDays;
  }
  if (draft.defaultVatRate === "zw" && draft.vatExemptBasis.trim() === "") {
    errors.vatExemptBasis = SETTINGS_ERROR_KEYS.exemptBasis;
  }
  if (draft.enabled) {
    for (const field of [
      "sellerName",
      "sellerAddress",
      "sellerPostalCode",
      "sellerCity",
      "sellerTaxId",
    ] as const) {
      if (errors[field] === undefined && draft[field].trim() === "") {
        errors[field] = SETTINGS_ERROR_KEYS.required;
      }
    }
    if (confirmedAt === null && !draft.confirmSeller) {
      errors.confirmSeller = SETTINGS_ERROR_KEYS.confirm;
    }
  }
  return errors;
}

export function settingsDraftToInput(draft: InvoiceSettingsDraft): EventInvoiceSettingsInput {
  const country = draft.sellerCountry.trim().toUpperCase();
  const tax = validateTaxId(draft.sellerTaxId, country);
  return {
    enabled: draft.enabled,
    confirmSeller: draft.confirmSeller,
    sellerName: draft.sellerName.trim(),
    sellerTaxId: tax.ok ? tax.normalized : draft.sellerTaxId.trim(),
    sellerAddress: draft.sellerAddress.trim(),
    sellerPostalCode: draft.sellerPostalCode.trim(),
    sellerCity: draft.sellerCity.trim(),
    sellerCountry: country,
    sellerEmail: draft.sellerEmail.trim().toLowerCase(),
    sellerPhone: draft.sellerPhone.trim(),
    sellerBankAccount: draft.sellerBankAccount.replace(/\s/g, "").toUpperCase(),
    sellerBankSwift: draft.sellerBankSwift.trim().toUpperCase(),
    seriesInvoice: series(draft.seriesInvoice),
    seriesProforma: series(draft.seriesProforma),
    seriesCorrection: series(draft.seriesCorrection),
    paymentDays: Number(draft.paymentDays.trim()),
    defaultVatRate: draft.defaultVatRate,
    vatExemptBasis: draft.vatExemptBasis.trim(),
    footerNote: draft.footerNote.trim(),
    defaultLocale: draft.defaultLocale,
  };
}

export function isSettingsDraftDirty(
  current: InvoiceSettingsDraft,
  initial: InvoiceSettingsDraft,
): boolean {
  return JSON.stringify(current) !== JSON.stringify(initial);
}
