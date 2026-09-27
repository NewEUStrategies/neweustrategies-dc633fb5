// Warstwa danych KLONU EDYCJI - wywolania RPC z przegladarki.
//
// AUTORYZACJA ZYJE W SQL. `admin_event_clone`, `admin_event_clone_preview`
// i `admin_event_editions` zaczynaja od `assert_event_admin_tenant()` (admin
// albo super_admin, nigdy redaktor) i czytaja zrodlo WYLACZNIE w najemcy
// wolajacego; ten modul jest tylko transportem. Wyszukiwarka zrodla korzysta
// z listy wydarzen (`admin_events_list`), wiec widzi dokladnie to, co lista.
//
// JEDNO MIEJSCE REGULY. Przesuniecie dat, domyslne przelaczniki i ostrzezenia
// liczy baza (ta sama funkcja dla podgladu i dla klonu). Tutaj NIE MA drugiej
// implementacji przesuniecia - formularz pokazuje daty, ktore oddal podglad.
//
// KONWENCJA LADUNKU: klucz pominiety = "nie podano" (baza bierze wartosc
// zrodla albo domyslna), mapowanie camelCase -> snake_case jest TUTAJ i nigdzie
// indziej. Bledy wychodza jako `new Error(error.message)`, zeby glowa
// komunikatu plpgsql (`slug_taken: ...`) dotarla do `adminCloneErrors.ts`.
//
// ODPOWIEDZI `jsonb` PRZECHODZA PRZEZ CZYSTE PARSERY: nieznane pole degraduje
// do zera albo `null`, a nie wywraca ekranu - `jsonb` z bazy jest z definicji
// nietypowany, a podglad bez jednej daty jest lepszy niz podglad, ktory sie
// nie renderuje.
import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";

type Fns = Database["public"]["Functions"];

/** Wiersz listy edycji - ksztalt WPROST z sygnatury RPC. */
export type EventEditionRow = Fns["admin_event_editions"]["Returns"][number];

/** Wiersz wyszukiwarki zrodla - ten sam, co na liscie wydarzen. */
export type CloneSourceRow = Fns["admin_events_list"]["Returns"][number];

/**
 * Przelaczniki sekcji klonu. Klucze 1:1 z `include` w `_event_clone_settings`
 * (camelCase po stronie TS, snake_case w ladunku - `CLONE_INCLUDE_SQL_KEYS`).
 */
export const CLONE_INCLUDE_KEYS = [
  "agenda",
  "speakers",
  "registration",
  "tickets",
  "sponsors",
  "sponsorMaterials",
  "homeAds",
  "pages",
  "onsite",
  "meetings",
  "cfp",
  "seating",
  "adCampaigns",
  "codes",
] as const;
export type CloneIncludeKey = (typeof CLONE_INCLUDE_KEYS)[number];
export type CloneInclude = Record<CloneIncludeKey, boolean>;

export const CLONE_INCLUDE_SQL_KEYS: Record<CloneIncludeKey, string> = {
  agenda: "agenda",
  speakers: "speakers",
  registration: "registration",
  tickets: "tickets",
  sponsors: "sponsors",
  sponsorMaterials: "sponsor_materials",
  homeAds: "home_ads",
  pages: "pages",
  onsite: "onsite",
  meetings: "meetings",
  cfp: "cfp",
  seating: "seating",
  adCampaigns: "ad_campaigns",
  codes: "codes",
};

/** Opcje logiczne klonu - 1:1 z `options` w `_event_clone_settings`. */
export const CLONE_FLAG_KEYS = [
  "includeCancelledSessions",
  "sessionsAsDraft",
  "sponsorsUnpublished",
  "keepAccessCodes",
  "refreshSponsorSnapshots",
  "crmRenewalTasks",
  "cfpReviewers",
] as const;
export type CloneFlagKey = (typeof CLONE_FLAG_KEYS)[number];
export type CloneFlags = Record<CloneFlagKey, boolean>;

export const CLONE_FLAG_SQL_KEYS: Record<CloneFlagKey, string> = {
  includeCancelledSessions: "include_cancelled_sessions",
  sessionsAsDraft: "sessions_as_draft",
  sponsorsUnpublished: "sponsors_unpublished",
  keepAccessCodes: "keep_access_codes",
  refreshSponsorSnapshots: "refresh_sponsor_snapshots",
  crmRenewalTasks: "crm_renewal_tasks",
  cfpReviewers: "cfp_reviewers",
};

export interface CloneOptions extends CloneFlags {
  /** Przyrostek kopii kodow (`VIP` -> `VIP-2027`); `null` = brak. */
  codeSuffix: string | null;
  /** Termin zadan odnowienia w dniach od dzis. */
  crmTaskDueDays: number;
}

/** Wejscie klonu i podgladu. Pole `undefined` nie trafia do ladunku. */
export interface EventCloneInput {
  sourceEventId: string;
  titlePl?: string;
  titleEn?: string;
  /** ISO; brak w podgladzie = podpowiedz bazy (ta sama godzina rok pozniej). */
  startsAt?: string;
  /** ISO; brak = koniec przesuniety jak cala reszta. */
  endsAt?: string;
  timezone?: string;
  slug?: string;
  /** Tylko dla zrodla z zapisami zewnetrznymi; brak = adres zrodla. */
  externalRegistrationUrl?: string;
  /** Tylko klon - jeden na akcje uzytkownika (`newIdempotencyKey`). */
  idempotencyKey?: string;
  include?: CloneInclude;
  options?: CloneOptions;
}

/** Ostrzezenie albo blokada: kod z bazy i liczba wierszy, ktorych dotyczy. */
export interface CloneNotice {
  code: string;
  count: number;
}

export interface CloneShift {
  delta: string;
  dayShift: number;
  sourceTz: string;
  timezone: string;
}

export interface CloneSourceSummary {
  id: string;
  slug: string;
  titlePl: string;
  titleEn: string;
  startsAt: string | null;
  endsAt: string | null;
  timezone: string;
  status: string;
  registrationMode: string;
  externalRegistrationUrl: string | null;
}

export interface CloneTarget {
  startsAt: string | null;
  endsAt: string | null;
  timezone: string;
  suggestedStartsAt: string | null;
  slug: string;
  slugValid: boolean;
  slugAvailable: boolean;
}

export interface CloneDates {
  rsvpOpensAt: string | null;
  salesFrom: string | null;
  salesTo: string | null;
  cfpOpensAt: string | null;
  cfpClosesAt: string | null;
  /** Dni kalendarzowe (`YYYY-MM-DD`), nie chwile. */
  meetingDaysFirst: string | null;
  meetingDaysLast: string | null;
  firstSessionStartsAt: string | null;
  lastSessionEndsAt: string | null;
}

export interface EventClonePreview {
  source: CloneSourceSummary;
  target: CloneTarget;
  shift: CloneShift;
  include: CloneInclude;
  options: CloneOptions;
  counts: Record<string, number>;
  notCopied: Record<string, number>;
  dates: CloneDates;
  warnings: CloneNotice[];
  blockers: CloneNotice[];
}

export interface EventCloneResult {
  eventId: string;
  slug: string;
  sourceEventId: string;
  replayed: boolean;
  shift: CloneShift;
  copied: Record<string, number>;
  skipped: Record<string, number>;
  warnings: CloneNotice[];
}

// ---------------------------------------------------------------------------
// Parsery odpowiedzi jsonb
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordOf(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/**
 * Chwila z `jsonb` (`2027-04-02T07:00:00+00:00`) jako ISO w UTC - ten sam
 * ksztalt, ktory oddaje i przyjmuje nasz kalendarz (`AdminFormDateTimeRow`).
 */
function instant(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function counts(value: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(recordOf(value))) out[key] = count(raw);
  return out;
}

function notices(value: unknown): CloneNotice[] {
  const out: CloneNotice[] = [];
  for (const item of Array.isArray(value) ? value : []) {
    if (!isRecord(item) || typeof item.code !== "string") continue;
    out.push({ code: item.code, count: count(item.count) });
  }
  return out;
}

function parseShift(value: unknown): CloneShift {
  const raw = recordOf(value);
  return {
    delta: text(raw.delta),
    dayShift: count(raw.day_shift),
    sourceTz: text(raw.source_tz),
    timezone: text(raw.timezone),
  };
}

function parseInclude(value: unknown): CloneInclude {
  const raw = recordOf(value);
  const out = {} as CloneInclude;
  for (const key of CLONE_INCLUDE_KEYS) out[key] = raw[CLONE_INCLUDE_SQL_KEYS[key]] === true;
  return out;
}

function parseOptions(value: unknown): CloneOptions {
  const raw = recordOf(value);
  const flags = {} as CloneFlags;
  for (const key of CLONE_FLAG_KEYS) flags[key] = raw[CLONE_FLAG_SQL_KEYS[key]] === true;
  return {
    ...flags,
    codeSuffix: textOrNull(raw.code_suffix),
    crmTaskDueDays: count(raw.crm_task_due_days),
  };
}

export function parseClonePreview(data: unknown): EventClonePreview {
  const raw = recordOf(data);
  const source = recordOf(raw.source);
  const target = recordOf(raw.target);
  const dates = recordOf(raw.dates);
  return {
    source: {
      id: text(source.id),
      slug: text(source.slug),
      titlePl: text(source.title_pl),
      titleEn: text(source.title_en),
      startsAt: instant(source.starts_at),
      endsAt: instant(source.ends_at),
      timezone: text(source.timezone),
      status: text(source.status),
      registrationMode: text(source.registration_mode),
      externalRegistrationUrl: textOrNull(source.external_registration_url),
    },
    target: {
      startsAt: instant(target.starts_at),
      endsAt: instant(target.ends_at),
      timezone: text(target.timezone),
      suggestedStartsAt: instant(target.suggested_starts_at),
      slug: text(target.slug),
      slugValid: target.slug_valid !== false,
      slugAvailable: target.slug_available !== false,
    },
    shift: parseShift(raw.shift),
    include: parseInclude(raw.include),
    options: parseOptions(raw.options),
    counts: counts(raw.counts),
    notCopied: counts(raw.not_copied),
    dates: {
      rsvpOpensAt: instant(dates.rsvp_opens_at),
      salesFrom: instant(dates.sales_from),
      salesTo: instant(dates.sales_to),
      cfpOpensAt: instant(dates.cfp_opens_at),
      cfpClosesAt: instant(dates.cfp_closes_at),
      meetingDaysFirst: textOrNull(dates.meeting_days_first),
      meetingDaysLast: textOrNull(dates.meeting_days_last),
      firstSessionStartsAt: instant(dates.first_session_starts_at),
      lastSessionEndsAt: instant(dates.last_session_ends_at),
    },
    warnings: notices(raw.warnings),
    blockers: notices(raw.blockers),
  };
}

export function parseCloneResult(data: unknown): EventCloneResult {
  const raw = recordOf(data);
  return {
    eventId: text(raw.event_id),
    slug: text(raw.slug),
    sourceEventId: text(raw.source_event_id),
    replayed: raw.replayed === true,
    shift: parseShift(raw.shift),
    copied: counts(raw.copied),
    skipped: counts(raw.skipped),
    warnings: notices(raw.warnings),
  };
}

// ---------------------------------------------------------------------------
// Ladunek i wywolania
// ---------------------------------------------------------------------------

/** Ladunek `p_payload`: pola `undefined` pominiete, klucze w snake_case. */
export function clonePayload(input: EventCloneInput): { [key: string]: Json } {
  const out: { [key: string]: Json } = { source_event_id: input.sourceEventId };
  const scalars: [string, string | undefined][] = [
    ["title_pl", input.titlePl],
    ["title_en", input.titleEn],
    ["starts_at", input.startsAt],
    ["ends_at", input.endsAt],
    ["timezone", input.timezone],
    ["slug", input.slug],
    ["external_registration_url", input.externalRegistrationUrl],
    ["idempotency_key", input.idempotencyKey],
  ];
  for (const [key, value] of scalars) {
    if (value !== undefined) out[key] = value;
  }
  if (input.include !== undefined) {
    const include: { [key: string]: Json } = {};
    for (const key of CLONE_INCLUDE_KEYS) {
      include[CLONE_INCLUDE_SQL_KEYS[key]] = input.include[key];
    }
    out.include = include;
  }
  if (input.options !== undefined) {
    const options: { [key: string]: Json } = {};
    for (const key of CLONE_FLAG_KEYS) options[CLONE_FLAG_SQL_KEYS[key]] = input.options[key];
    if (input.options.codeSuffix !== null) options.code_suffix = input.options.codeSuffix;
    options.crm_task_due_days = input.options.crmTaskDueDays;
    out.options = options;
  }
  return out;
}

/**
 * Podglad dla gotowego ladunku. Hook podgladu odracza ZSERIALIZOWANY ladunek
 * (napis porownuje sie po wartosci), wiec do bazy jedzie ladunek, nie wejscie.
 */
export async function requestClonePreview(payload: Json): Promise<EventClonePreview> {
  const { data, error } = await supabase.rpc("admin_event_clone_preview", { p_payload: payload });
  if (error) throw new Error(error.message);
  return parseClonePreview(data);
}

export function previewEventClone(input: EventCloneInput): Promise<EventClonePreview> {
  return requestClonePreview(clonePayload(input));
}

export async function cloneEvent(input: EventCloneInput): Promise<EventCloneResult> {
  const { data, error } = await supabase.rpc("admin_event_clone", {
    p_payload: clonePayload(input),
  });
  if (error) throw new Error(error.message);
  return parseCloneResult(data);
}

export async function fetchEventEditions(eventId: string): Promise<EventEditionRow[]> {
  const { data, error } = await supabase.rpc("admin_event_editions", { p_event_id: eventId });
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Wynikow wyszukiwarki zrodla - dosc, zeby wybrac, za malo, zeby przewijac. */
export const CLONE_SOURCE_SEARCH_LIMIT = 10;

export async function searchCloneSources(q: string): Promise<CloneSourceRow[]> {
  const { data, error } = await supabase.rpc("admin_events_list", {
    p_q: q,
    p_limit: CLONE_SOURCE_SEARCH_LIMIT,
    p_offset: 0,
  });
  if (error) throw new Error(error.message);
  return data ?? [];
}
