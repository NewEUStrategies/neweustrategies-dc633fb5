// Dostep panelu organizatora do zapisow, biletow i pol formularza wydarzenia.
//
// JEDEN PLIK NA CALY MODUL ZAPISOW. Bilety, pola formularza i lista zgloszen to
// trzy ekrany, ale JEDEN kontrakt danych: bilet wyznacza pule miejsc, pole
// formularza wyznacza werdykt (auto-zatwierdzenie / rezerwa / odrzucenie),
// a zgloszenie odwoluje sie do obu. Rozbicie na trzy pliki zdublowaloby typy
// wiersza, a zdublowany typ rozjezdza sie przy pierwszej zmianie kolumny.
//
// TYPY WYPROWADZAMY Z WYGENEROWANYCH `Database`, NIE PRZEPISUJEMY RECZNIE.
// Recznie przepisany wiersz jest prawdziwy do najblizszej migracji; wyprowadzony
// z `Functions[...]["Returns"]` przestaje sie kompilowac w tej samej minucie,
// w ktorej baza zmienia kontrakt - i o to chodzi.
//
// PAYLOAD JEST jsonb WSZEDZIE, GDZIE FUNKCJA MA WIECEJ NIZ JEDEN ARGUMENT.
// Postgres przeciaza po sygnaturze, wiec kazde nowe pole w wersji pozycyjnej to
// nowa funkcja i nowy grant. Tlumaczenie camelCase -> snake_case zyje tylko tu.
//
// KLUCZE POMINIETE (`undefined`) NIE SA WYSYLANE. Funkcje `*_upsert` czytaja
// `p_payload ? 'quota'`, wiec brak klucza znaczy „zostaw jak bylo", a jawny
// `null` znaczy „wyczysc". Sklejenie obu w jedno zachowanie odbieraloby
// organizatorowi mozliwosc zdjecia limitu.
import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";

type Fns = Database["public"]["Functions"];

export type EventRegistrationRow = Fns["admin_event_registrations_list"]["Returns"][number];
export type EventTicketRow = Fns["admin_event_tickets_list"]["Returns"][number];
export type EventRegistrationFieldRow =
  Fns["admin_event_registration_fields_list"]["Returns"][number];

/** Stany zapisu - odwzorowanie CHECK-a `status` z migracji jeden do jednego. */
export const REGISTRATION_STATUSES = [
  "draft",
  "pending",
  "approved",
  "rejected",
  "waitlist",
  "cancelled",
  "attended",
  "no_show",
] as const;
export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number];

/** Filtr listy; `all` nie jest stanem w bazie, tylko brakiem filtra. */
export type RegistrationStatusFilter = RegistrationStatus | "all";

/** Decyzje organizatora dopuszczone przez `admin_event_registration_decide`. */
export const REGISTRATION_ACTIONS = [
  "approve",
  "reject",
  "waitlist",
  "attended",
  "no_show",
  "cancel",
] as const;
export type RegistrationAction = (typeof REGISTRATION_ACTIONS)[number];

/**
 * Typy pol formularza - dokladnie `event_registration_fields_type_values`
 * z migracji. Wartosc, ktorej nie ma w CHECK-u, wraca z bazy jako `23514` bez
 * wskazania pola, wiec lista musi byc odwzorowaniem, nie propozycja.
 */
export const REGISTRATION_FIELD_TYPES = [
  "text",
  "textarea",
  "select",
  "multiselect",
  "checkbox",
  "switch",
  "number",
  "date",
  "file",
  "consent",
] as const;
export type RegistrationFieldType = (typeof REGISTRATION_FIELD_TYPES)[number];

/** Operatory kwalifikacji odpowiedzi. */
export const QUALIFY_OPERATORS = [
  "none",
  "equals",
  "not_equals",
  "in",
  "not_in",
  "gte",
  "lte",
  "is_true",
  "is_false",
  "not_empty",
] as const;
export type QualifyOperator = (typeof QUALIFY_OPERATORS)[number];

/** Werdykt, ktory pole narzuca zgloszeniu, gdy warunek jest spelniony. */
export const QUALIFY_OUTCOMES = ["auto_approve", "approval", "reject"] as const;
export type QualifyOutcome = (typeof QUALIFY_OUTCOMES)[number];

type PayloadInput = Record<string, Json | undefined>;

/**
 * Argumenty pozycyjne RPC bez kluczy `undefined`.
 *
 * `{ p_status: undefined }` NIE jest tym samym co brak klucza: klient Supabase
 * serializuje taki obiekt z polem `p_status: null`, a `null` w `p_status` to
 * jawny filtr, nie jego brak. Skutek byłby cichy - lista zwracałaby te same
 * wiersze, dopóki ktoś nie doda funkcji, która rozróżnia oba przypadki.
 */
function args<T extends Record<string, unknown>>(input: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) out[key] = value;
  }
  return out as T;
}

function payload(input: PayloadInput): Json {
  const out: Record<string, Json> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) out[key] = value;
  }
  return out as Json;
}

// ---------------------------------------------------------------------------
// BILETY
// ---------------------------------------------------------------------------

export async function fetchEventTickets(eventId: string): Promise<EventTicketRow[]> {
  const { data, error } = await supabase.rpc("admin_event_tickets_list", {
    p_event_id: eventId,
  });
  if (error) throw error;
  return data ?? [];
}

export interface EventTicketInput {
  /** `null` = nowy bilet; wtedy `key` jest obowiazkowy i niezmienny pozniej. */
  id: string | null;
  eventId: string;
  key: string;
  namePl: string;
  nameEn: string;
  descriptionPl: string;
  descriptionEn: string;
  priceCents: number;
  currency: string;
  /** `null` = bez limitu miejsc na tym bilecie. */
  quota: number | null;
  salesFrom: string | null;
  salesTo: string | null;
  minTierRank: number;
  requiresApproval: boolean;
  /** Grupa nadawana biletem; musi byc grupa TEGO wydarzenia. */
  groupId: string | null;
  isActive: boolean;
  sortOrder: number;
}

export async function saveEventTicket(input: EventTicketInput): Promise<string> {
  const { data, error } = await supabase.rpc("admin_event_ticket_upsert", {
    p_payload: payload({
      id: input.id,
      // Klucz jest niezmienny po zapisie - przy edycji nie wysylamy go wcale,
      // zeby literowka nie wygladala jak cicho zignorowana zmiana.
      event_id: input.id === null ? input.eventId : undefined,
      key: input.id === null ? input.key : undefined,
      name_pl: input.namePl,
      name_en: input.nameEn,
      description_pl: input.descriptionPl,
      description_en: input.descriptionEn,
      price_cents: input.priceCents,
      currency: input.currency,
      quota: input.quota,
      sales_from: input.salesFrom,
      sales_to: input.salesTo,
      min_tier_rank: input.minTierRank,
      requires_approval: input.requiresApproval,
      group_id: input.groupId,
      is_active: input.isActive,
      sort_order: input.sortOrder,
    }),
  });
  if (error) throw error;
  return String(data);
}

export async function deleteEventTicket(id: string): Promise<boolean> {
  const { error } = await supabase.rpc("admin_event_ticket_delete", { _id: id });
  if (error) throw error;
  return true;
}

// ---------------------------------------------------------------------------
// POLA FORMULARZA ZAPISU
// ---------------------------------------------------------------------------

export async function fetchRegistrationFields(
  eventId: string,
): Promise<EventRegistrationFieldRow[]> {
  const { data, error } = await supabase.rpc("admin_event_registration_fields_list", {
    p_event_id: eventId,
  });
  if (error) throw error;
  return data ?? [];
}

export interface RegistrationFieldInput {
  id: string | null;
  eventId: string;
  key: string;
  fieldType: RegistrationFieldType;
  labelPl: string;
  labelEn: string;
  helpPl: string;
  helpEn: string;
  isRequired: boolean;
  /** Warianty dla `select`/`multiselect`; dla reszty pusta lista. */
  options: Json;
  sortOrder: number;
  isQualifying: boolean;
  qualifyOperator: QualifyOperator;
  qualifyValue: Json;
  qualifyOutcome: QualifyOutcome;
  isActive: boolean;
}

export async function saveRegistrationField(input: RegistrationFieldInput): Promise<string> {
  const { data, error } = await supabase.rpc("admin_event_registration_field_upsert", {
    p_payload: payload({
      id: input.id,
      event_id: input.id === null ? input.eventId : undefined,
      key: input.id === null ? input.key : undefined,
      field_type: input.fieldType,
      label_pl: input.labelPl,
      label_en: input.labelEn,
      help_pl: input.helpPl,
      help_en: input.helpEn,
      is_required: input.isRequired,
      options: input.options,
      sort_order: input.sortOrder,
      is_qualifying: input.isQualifying,
      qualify_operator: input.qualifyOperator,
      qualify_value: input.qualifyValue,
      qualify_outcome: input.qualifyOutcome,
      is_active: input.isActive,
    }),
  });
  if (error) throw error;
  return String(data);
}

export async function deleteRegistrationField(id: string): Promise<boolean> {
  const { error } = await supabase.rpc("admin_event_registration_field_delete", { _id: id });
  if (error) throw error;
  return true;
}

// ---------------------------------------------------------------------------
// LISTA ZGLOSZEN
// ---------------------------------------------------------------------------

export interface RegistrationsQuery {
  eventId: string;
  status: RegistrationStatusFilter;
  ticketTypeId: string | null;
  groupId: string | null;
  q: string;
  from: string | null;
  to: string | null;
  limit: number;
  offset: number;
}

export const DEFAULT_REGISTRATIONS_QUERY: Omit<RegistrationsQuery, "eventId"> = {
  status: "all",
  ticketTypeId: null,
  groupId: null,
  q: "",
  from: null,
  to: null,
  limit: 25,
  offset: 0,
};

export interface RegistrationsPage {
  rows: EventRegistrationRow[];
  /** Liczba wierszy PO filtrach, nie liczba wierszy na stronie. */
  total: number;
}

function trimmedOrNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export async function fetchRegistrations(query: RegistrationsQuery): Promise<RegistrationsPage> {
  const { data, error } = await supabase.rpc(
    "admin_event_registrations_list",
    args({
      p_event_id: query.eventId,
      p_status: query.status === "all" ? undefined : query.status,
      p_ticket_type_id: query.ticketTypeId ?? undefined,
      p_group_id: query.groupId ?? undefined,
      p_q: trimmedOrNull(query.q) ?? undefined,
      p_from: query.from ?? undefined,
      p_to: query.to ?? undefined,
      p_limit: query.limit,
      p_offset: query.offset,
    }),
  );
  if (error) throw error;
  const rows = data ?? [];
  // `total_count` jest powtorzone w kazdym wierszu (okno nad zapytaniem). Pusta
  // strona nie zna sumy - i to jest poprawne: nie ma czego liczyc.
  const total = rows.length === 0 ? 0 : Number(rows[0]?.total_count ?? 0);
  return { rows, total };
}

export interface RegistrationCountsQuery {
  eventId: string;
  ticketTypeId: string | null;
  groupId: string | null;
  q: string;
  from: string | null;
  to: string | null;
}

export async function fetchRegistrationCounts(query: RegistrationCountsQuery): Promise<Json> {
  const { data, error } = await supabase.rpc(
    "admin_event_registrations_counts",
    args({
      p_event_id: query.eventId,
      p_ticket_type_id: query.ticketTypeId ?? undefined,
      p_group_id: query.groupId ?? undefined,
      p_q: trimmedOrNull(query.q) ?? undefined,
      p_from: query.from ?? undefined,
      p_to: query.to ?? undefined,
    }),
  );
  if (error) throw error;
  return (data ?? {}) as Json;
}

// ---------------------------------------------------------------------------
// DECYZJE ORGANIZATORA
// ---------------------------------------------------------------------------

export interface RegistrationDecisionInput {
  registrationId: string;
  action: RegistrationAction;
  /** Baza wymaga uzasadnienia przy odrzuceniu i anulowaniu (`reason_required`). */
  note: string | null;
}

export async function decideRegistration(input: RegistrationDecisionInput): Promise<Json> {
  const { data, error } = await supabase.rpc("admin_event_registration_decide", {
    p_payload: payload({
      registration_id: input.registrationId,
      action: input.action,
      note: input.note,
    }),
  });
  if (error) throw error;
  return (data ?? {}) as Json;
}

export interface RegistrationUpsertInput {
  id: string | null;
  eventId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  jobTitle: string | null;
  companyText: string | null;
  socialProfileUrl: string | null;
  ticketTypeId: string | null;
  groupId: string | null;
  status: RegistrationStatus | null;
  answers: Json | undefined;
  note: string | null;
}

export async function saveRegistration(input: RegistrationUpsertInput): Promise<string> {
  const { data, error } = await supabase.rpc("admin_event_registration_upsert", {
    p_payload: payload({
      // Ta funkcja identyfikuje wiersz przez `registration_id`, a nie `id` -
      // klucz `id` byłby po cichu zignorowany i utworzyłby drugi zapis.
      registration_id: input.id,
      event_id: input.id === null ? input.eventId : undefined,
      first_name: input.firstName,
      last_name: input.lastName,
      email: input.email,
      phone: input.phone,
      job_title: input.jobTitle,
      company_text: input.companyText,
      social_profile_url: input.socialProfileUrl,
      ticket_type_id: input.ticketTypeId,
      group_id: input.groupId,
      // `null` znaczy „nie ruszaj stanu" - baza ma własną wartość domyślną
      // (`approved`), a wysłanie null wyglądałoby jak próba wyczyszczenia stanu.
      status: input.status ?? undefined,
      answers: input.answers,
      note: input.note,
    }),
  });
  if (error) throw error;
  return String(data);
}

/** Odznaczenie wyslanego powiadomienia o promocji z rezerwy. Zwraca liczbe wierszy. */
export async function markRegistrationsNotified(ids: readonly string[]): Promise<number> {
  const { data, error } = await supabase.rpc("admin_event_registration_mark_notified", {
    p_payload: payload({ registration_ids: [...ids] }),
  });
  if (error) throw error;
  return Number(data ?? 0);
}

export interface WaitlistPromoteInput {
  eventId: string;
  /** Konkretny wiersz rezerwy albo `null` = promuj po kolejce. */
  registrationId: string | null;
  ticketTypeId: string | null;
  /** Ile osob promowac, gdy nie wskazano wiersza (baza tnie do 1..500). */
  count: number;
}

export async function promoteFromWaitlist(input: WaitlistPromoteInput): Promise<Json> {
  const { data, error } = await supabase.rpc("admin_event_waitlist_promote", {
    p_payload: payload({
      event_id: input.eventId,
      registration_id: input.registrationId,
      ticket_type_id: input.ticketTypeId,
      count: input.count,
    }),
  });
  if (error) throw error;
  return (data ?? {}) as Json;
}
