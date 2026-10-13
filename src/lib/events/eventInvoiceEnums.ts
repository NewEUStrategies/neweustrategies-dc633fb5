// Zamkniete zbiory modulu faktur wydarzen - lustro CHECK-ow migracji
// 20260927000200 (bramka `eventInvoicesDbEnumParity.test.ts`).
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

/**
 * Dozwolone przejscia stanu KSeF (INV-02) - lustro `_event_invoice_ksef_transition_ok`
 * (migracja 20261012100000, parytet pilnuje `eventInvoicesDbEnumParity.test.ts`).
 * Ruch WYLACZNIE do przodu; `accepted` i `not_applicable` sa terminalne, wiec
 * dokumentu przyjetego w KSeF nie da sie "cofnac" do stanu, w ktorym wolno go
 * anulowac. Panel proponuje tylko te stany.
 */
export const EVENT_INVOICE_KSEF_TRANSITIONS: Readonly<
  Record<EventInvoiceKsefStatus, readonly EventInvoiceKsefStatus[]>
> = {
  not_applicable: [],
  pending: ["sent", "accepted", "rejected"],
  sent: ["accepted", "rejected"],
  accepted: [],
  rejected: ["pending", "sent", "accepted"],
};

/** Stany do wyboru w panelu: obecny + osiagalne z niego. */
export function ksefNextStatuses(current: EventInvoiceKsefStatus): EventInvoiceKsefStatus[] {
  return [current, ...EVENT_INVOICE_KSEF_TRANSITIONS[current]];
}

/**
 * Numer KSeF (INV-17): NIP sprzedawcy - data przyjecia RRRRMMDD - 12 znakow
 * szesnastkowych - 2 znaki sumy. Panel normalizuje (spacje, wielkie litery)
 * i podpowiada format; NIP sprzedawcy i date sprawdza baza.
 */
export const KSEF_NUMBER_PATTERN = /^[0-9]{10}-[0-9]{8}-[0-9A-F]{12}-[0-9A-F]{2}$/;

export function normalizeKsefNumber(value: string): string {
  return value.trim().toUpperCase();
}

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

/**
 * Dlaczego kupujacy NIE moze poprosic o fakture za zamowienie
 * (`event_my_invoice_sources.request_block`, kolejnosc galezi CASE w SQL):
 * faktura w toku albo wystawiona, organizator nie fakturuje, prosba innego
 * konta, po terminie, platnosc karta fakturuje operator.
 */
export const EVENT_INVOICE_REQUEST_BLOCKS = [
  "invoiced",
  "disabled",
  "other_requester",
  "window_closed",
  "operator_invoice",
] as const;
export type EventInvoiceRequestBlock = (typeof EVENT_INVOICE_REQUEST_BLOCKS)[number];

/**
 * Czy OPLACONY zapis-kandydat ma miejsce (`admin_event_invoice_candidates.admission`,
 * ta sama klasyfikacja co `paidAdmission.ts`): wplata w kolejce albo czekajaca
 * na decyzje organizatora moze jeszcze skonczyc sie zwrotem, wiec masowe
 * wystawienie z prosb ja pomija. Nieoplacony zapis i pakiet = `seated`.
 */
export const EVENT_INVOICE_ADMISSIONS = ["seated", "waitlisted", "awaitingDecision"] as const;
export type EventInvoiceAdmission = (typeof EVENT_INVOICE_ADMISSIONS)[number];

/**
 * Dlaczego wystawiona faktura wymaga korekty (`correction_hint` z
 * `_event_invoice_correction_hint`, kolejnosc wagi w SQL): zamowienie odwolane
 * albo zwrocone, zwrot z karty po wystawieniu, mniej miejsc niz na fakturze.
 * NULL = nic sie nie zmienilo. Podpowiedz - korekty nic nie wystawia samo.
 */
export const EVENT_INVOICE_CORRECTION_HINTS = [
  "source_closed",
  "refunded",
  "seats_reduced",
] as const;
export type EventInvoiceCorrectionHint = (typeof EVENT_INVOICE_CORRECTION_HINTS)[number];

/** Czy wartosc nalezy do zamknietego zbioru (straznik typu, bez rzutowania). */
export function isEnumMember<T extends string>(values: readonly T[], value: unknown): value is T {
  return values.some((item) => item === value);
}

/** Wartosc z bazy albo pierwsza z listy (baza pilnuje CHECK-a; klient nie zgaduje dalej). */
export function pickEnum<T extends string>(values: readonly T[], value: unknown): T {
  return isEnumMember(values, value) ? value : values[0];
}
