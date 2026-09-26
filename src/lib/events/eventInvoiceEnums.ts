// Zamkniete zbiory modulu faktur wydarzen - lustro CHECK-ow migracji
// 20260926110000 (bramka `eventInvoicesDbEnumParity.test.ts`).
//
// OSOBNY PLIK, BO CZYTAJA GO DWIE POWIERZCHNIE. Studio organizatora i profil
// kupujacego pokazuja te same rodzaje, stany i stany KSeF, ale kazda swoim
// slownikiem (nakladka panelu nie wolno wciagac do publicznego pakietu).
// Tu sa wiec WYLACZNIE wartosci i straznicy - klucze etykiet trzyma kazda
// powierzchnia u siebie jako `Record<Enum, "pelny.klucz">`.

export const EVENT_INVOICE_KINDS = ["invoice", "proforma", "correction"] as const;
export type EventInvoiceKind = (typeof EVENT_INVOICE_KINDS)[number];

export const EVENT_INVOICE_STATUSES = ["draft", "issued", "cancelled"] as const;
export type EventInvoiceStatus = (typeof EVENT_INVOICE_STATUSES)[number];

export const EVENT_INVOICE_KSEF_STATUSES = [
  "not_applicable",
  "pending",
  "sent",
  "accepted",
  "rejected",
] as const;
export type EventInvoiceKsefStatus = (typeof EVENT_INVOICE_KSEF_STATUSES)[number];

export const EVENT_INVOICE_PAYMENT_METHODS = ["card", "transfer", "other"] as const;
export type EventInvoicePaymentMethod = (typeof EVENT_INVOICE_PAYMENT_METHODS)[number];

export const EVENT_INVOICE_LOCALES = ["pl", "en"] as const;
export type EventInvoiceLocale = (typeof EVENT_INVOICE_LOCALES)[number];

export const EVENT_INVOICE_REQUEST_STATUSES = ["pending", "invoiced", "cancelled"] as const;
export type EventInvoiceRequestStatus = (typeof EVENT_INVOICE_REQUEST_STATUSES)[number];

export const EVENT_INVOICE_SOURCE_KINDS = ["registration", "package_order"] as const;
export type EventInvoiceSourceKind = (typeof EVENT_INVOICE_SOURCE_KINDS)[number];

export const EVENT_INVOICE_CORRECTION_MODES = ["full", "partial"] as const;
export type EventInvoiceCorrectionMode = (typeof EVENT_INVOICE_CORRECTION_MODES)[number];

/** Czy wartosc nalezy do zamknietego zbioru (straznik typu, bez rzutowania). */
export function isEnumMember<T extends string>(values: readonly T[], value: unknown): value is T {
  return values.some((item) => item === value);
}

/** Wartosc z bazy albo pierwsza z listy (baza pilnuje CHECK-a; klient nie zgaduje dalej). */
export function pickEnum<T extends string>(values: readonly T[], value: unknown): T {
  return isEnumMember(values, value) ? value : values[0];
}
