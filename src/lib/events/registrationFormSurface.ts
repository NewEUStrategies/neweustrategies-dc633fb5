// Parser publicznego formularza zapisu (`event_registration_form(p_event_slug)`).
//
// DLACZEGO PARSER, A NIE RZUTOWANIE. RPC oddaje `jsonb`, więc typ po stronie
// klienta jest deklaracją intencji, nie faktem. Rzutowanie `as` zamienia zmianę
// nazwy kolumny w SQL-u na pustą listę biletów wyrenderowaną bez jednego błędu
// w konsoli - czyli na wydarzenie, na które nikt nie może się zapisać, o czym
// dowiemy się od uczestników, a nie od testów.
//
// BRAK DANYCH DEGRADUJE DO STANU BEZPIECZNEGO. Nieczytelna odpowiedź to
// `isOpen: false` z powodem `unknown`: uczestnik nie zobaczy przycisku, który
// baza i tak odrzuci, a nie zobaczy też formularza udającego, że zapis działa.
//
// `null` W LIMITACH TO BRAK LIMITU, NIE ZERO. `capacity`/`seats_left` równe
// `null` znaczy „bez limitu miejsc"; sklejenie z zerem zamieniłoby wydarzenie
// otwarte w wyprzedane.
//
// KOLEJNOŚĆ USTALA BAZA (`ORDER BY sort_order, key`). Nie sortujemy ponownie -
// jedno źródło kolejności to jedna kolejność w podglądzie i na produkcji.
import type { Json } from "@/integrations/supabase/types";
import {
  REGISTRATION_FIELD_TYPES,
  type RegistrationFieldType,
} from "@/lib/events/registrationsApi";

/** Dostępność biletu wyliczona w SQL-u - nie liczymy jej z zegara przeglądarki. */
export const TICKET_AVAILABILITIES = ["on_sale", "scheduled", "ended", "sold_out"] as const;
export type TicketAvailability = (typeof TICKET_AVAILABILITIES)[number];

/** Powody zamknięcia zapisu, którymi odpowiada RPC (plus `unknown` awaryjnie). */
export const REGISTRATION_CLOSED_REASONS = [
  "event_cancelled",
  "registration_disabled",
  "registration_external",
  "registration_not_open",
  "membership_required",
  "sold_out",
  "unknown",
] as const;
export type RegistrationClosedReason = (typeof REGISTRATION_CLOSED_REASONS)[number];

export interface RegistrationFormOption {
  value: string;
  labelPl: string;
  labelEn: string;
}

export interface RegistrationFormField {
  id: string;
  key: string;
  fieldType: RegistrationFieldType;
  labelPl: string;
  labelEn: string;
  helpPl: string;
  helpEn: string;
  isRequired: boolean;
  options: RegistrationFormOption[];
}

export interface RegistrationFormTicket {
  id: string;
  key: string;
  namePl: string;
  nameEn: string;
  descriptionPl: string;
  descriptionEn: string;
  priceCents: number;
  currency: string;
  requiresApproval: boolean;
  minTierRank: number;
  salesFrom: string | null;
  salesTo: string | null;
  /** `null` = brak limitu miejsc na ten bilet. */
  seatsLeft: number | null;
  availability: TicketAvailability;
  /** Baza już porównała rangę widza - UI tylko podpisuje blokadę. */
  tierLocked: boolean;
}

export interface RegistrationFormTerm {
  id: string;
  key: string;
  labelPl: string;
  labelEn: string;
  bodyPl: string;
  bodyEn: string;
  externalUrl: string | null;
  isRequired: boolean;
  version: number;
}

export interface RegistrationFormEvent {
  id: string;
  slug: string;
  titlePl: string;
  titleEn: string;
  startsAt: string | null;
  endsAt: string | null;
  timezone: string | null;
  registrationMode: string;
  registrationFlow: string;
  externalRegistrationUrl: string | null;
  /** `null` = bez limitu miejsc. */
  capacity: number | null;
  seatsLeft: number | null;
  rsvpOpensAt: string | null;
}

export interface RegistrationForm {
  event: RegistrationFormEvent | null;
  isOpen: boolean;
  closedReason: RegistrationClosedReason | null;
  fields: RegistrationFormField[];
  tickets: RegistrationFormTicket[];
  terms: RegistrationFormTerm[];
}

export const EMPTY_REGISTRATION_FORM: RegistrationForm = {
  event: null,
  isOpen: false,
  closedReason: "unknown",
  fields: [],
  tickets: [],
  terms: [],
};

type Bag = Record<string, unknown>;

function bag(value: unknown): Bag | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Bag)
    : null;
}

function text(source: Bag, key: string): string {
  const value = source[key];
  return typeof value === "string" ? value : "";
}

function nullableText(source: Bag, key: string): string | null {
  const value = source[key];
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function bool(source: Bag, key: string): boolean {
  return source[key] === true;
}

function int(source: Bag, key: string): number {
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : 0;
}

/** Liczba albo `null` - rozróżnienie „brak limitu" od „zostało zero miejsc". */
function optionalInt(source: Bag, key: string): number | null {
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : null;
}

function rows(value: unknown): Bag[] {
  if (!Array.isArray(value)) return [];
  const out: Bag[] = [];
  for (const entry of value) {
    const record = bag(entry);
    if (record !== null) out.push(record);
  }
  return out;
}

function optionsOf(value: unknown): RegistrationFormOption[] {
  if (!Array.isArray(value)) return [];
  const out: RegistrationFormOption[] = [];
  for (const entry of value) {
    // Historyczne wiersze mogą trzymać zwykły napis - czytamy go jako wartość
    // bez tłumaczenia, zamiast cicho skrócić listę wyborów uczestnikowi.
    if (typeof entry === "string") {
      if (entry.trim() === "") continue;
      out.push({ value: entry, labelPl: entry, labelEn: entry });
      continue;
    }
    const record = bag(entry);
    if (record === null) continue;
    const value_ = text(record, "value");
    if (value_ === "") continue;
    out.push({
      value: value_,
      labelPl: nullableText(record, "label_pl") ?? value_,
      labelEn: nullableText(record, "label_en") ?? value_,
    });
  }
  return out;
}

function fieldTypeOf(source: Bag): RegistrationFieldType {
  const value = text(source, "field_type");
  return (REGISTRATION_FIELD_TYPES as readonly string[]).includes(value)
    ? (value as RegistrationFieldType)
    : "text";
}

function availabilityOf(source: Bag): TicketAvailability {
  const value = text(source, "availability");
  // Nieznana dostępność NIE degraduje do `on_sale`: lepiej pokazać bilet jako
  // niedostępny, niż zaprosić do zapisu, który baza odrzuci.
  return (TICKET_AVAILABILITIES as readonly string[]).includes(value)
    ? (value as TicketAvailability)
    : "ended";
}

function closedReasonOf(source: Bag, isOpen: boolean): RegistrationClosedReason | null {
  const value = nullableText(source, "closed_reason");
  if (value === null) return isOpen ? null : "unknown";
  return (REGISTRATION_CLOSED_REASONS as readonly string[]).includes(value)
    ? (value as RegistrationClosedReason)
    : "unknown";
}

function eventOf(value: unknown): RegistrationFormEvent | null {
  const source = bag(value);
  if (source === null) return null;
  const id = text(source, "id");
  if (id === "") return null;
  return {
    id,
    slug: text(source, "slug"),
    titlePl: text(source, "title_pl"),
    titleEn: text(source, "title_en"),
    startsAt: nullableText(source, "starts_at"),
    endsAt: nullableText(source, "ends_at"),
    timezone: nullableText(source, "timezone"),
    registrationMode: text(source, "registration_mode"),
    registrationFlow: text(source, "registration_flow"),
    externalRegistrationUrl: nullableText(source, "external_registration_url"),
    capacity: optionalInt(source, "capacity"),
    seatsLeft: optionalInt(source, "seats_left"),
    rsvpOpensAt: nullableText(source, "rsvp_opens_at"),
  };
}

export function parseRegistrationForm(payload: Json | null | undefined): RegistrationForm {
  const source = bag(payload);
  if (source === null) return EMPTY_REGISTRATION_FORM;

  const event = eventOf(source.event);
  if (event === null) return EMPTY_REGISTRATION_FORM;

  const isOpen = bool(source, "is_open");

  return {
    event,
    isOpen,
    closedReason: closedReasonOf(source, isOpen),
    fields: rows(source.fields).map((row) => ({
      id: text(row, "id"),
      key: text(row, "key"),
      fieldType: fieldTypeOf(row),
      labelPl: text(row, "label_pl"),
      labelEn: text(row, "label_en"),
      helpPl: text(row, "help_pl"),
      helpEn: text(row, "help_en"),
      isRequired: bool(row, "is_required"),
      options: optionsOf(row.options),
    })),
    tickets: rows(source.tickets).map((row) => ({
      id: text(row, "id"),
      key: text(row, "key"),
      namePl: text(row, "name_pl"),
      nameEn: text(row, "name_en"),
      descriptionPl: text(row, "description_pl"),
      descriptionEn: text(row, "description_en"),
      priceCents: int(row, "price_cents"),
      currency: nullableText(row, "currency") ?? "EUR",
      requiresApproval: bool(row, "requires_approval"),
      minTierRank: int(row, "min_tier_rank"),
      salesFrom: nullableText(row, "sales_from"),
      salesTo: nullableText(row, "sales_to"),
      seatsLeft: optionalInt(row, "seats_left"),
      availability: availabilityOf(row),
      tierLocked: bool(row, "tier_locked"),
    })),
    terms: rows(source.terms).map((row) => ({
      id: text(row, "id"),
      key: text(row, "key"),
      labelPl: text(row, "label_pl"),
      labelEn: text(row, "label_en"),
      bodyPl: text(row, "body_pl"),
      bodyEn: text(row, "body_en"),
      externalUrl: nullableText(row, "external_url"),
      isRequired: bool(row, "is_required"),
      version: int(row, "version"),
    })),
  };
}

/** Bilet, który uczestnik faktycznie może wybrać - reszta jest tylko pokazana. */
export function isTicketSelectable(ticket: RegistrationFormTicket): boolean {
  return ticket.availability === "on_sale" && !ticket.tierLocked;
}

/** Czy trzeba wybrać bilet: baza wymaga wyboru, gdy wydarzenie ma bilety. */
export function requiresTicketChoice(form: RegistrationForm): boolean {
  return form.tickets.length > 0;
}

/** Zgody obowiązkowe - bez nich `event_register()` rzuca `terms_required`. */
export function requiredTermIds(form: RegistrationForm): string[] {
  return form.terms.filter((term) => term.isRequired).map((term) => term.id);
}
