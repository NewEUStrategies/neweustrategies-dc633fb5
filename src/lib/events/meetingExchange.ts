// Odczyt stanu gieldy spotkan 1-1 dla UCZESTNIKA (`event_meeting_exchange`).
//
// DLACZEGO OSOBNY PARSER, A NIE `as MeetingExchange` W KOMPONENCIE. RPC oddaje
// `jsonb`, wiec typ po stronie klienta jest deklaracja intencji, a nie faktem.
// Rzutowanie znaczy, ze zmiana nazwy pola w SQL-u konczy sie `undefined`
// wrenderowanym jako "Pozostalo zaproszen: NaN" - bez bledu w konsoli i bez
// szansy, ze ktos to zauwazy przed kongresem. Tutaj kazde pole ma typ i wartosc
// awaryjna, a brak pola degraduje do stanu "gielda zamknieta", czyli do stanu
// BEZPIECZNEGO: uczestnik nie zobaczy przycisku, ktorego baza i tak odrzuci.
//
// `openNow` LICZY BAZA, NIE PRZEGLADARKA. Zegar przegladarki bywa przesuniety
// o godziny i nie jest zegarem, wedlug ktorego RPC odrzuca zaproszenie. Dlatego
// nie porownujemy tu `invites_open_at` z `Date.now()` - czytamy gotowa
// odpowiedz `open_now`, a daty sluza wylacznie do PODPISANIA jej uzytkownikowi.
//
// LIMIT `null` TO BRAK LIMITU, NIE ZERO. Sklejenie ich zamienialoby wydarzenie
// bez limitu zaproszen w wydarzenie, w ktorym nie wolno zaprosic nikogo.
import type { Json } from "@/integrations/supabase/types";
import { MEETING_VISIBILITIES, type MeetingVisibility } from "@/lib/events/meetingsApi";

/** Wlasne okno dostepnosci uczestnika - ksztalt z `jsonb_build_object` w RPC. */
export interface MyAvailabilityWindow {
  id: string;
  startsAt: string;
  endsAt: string;
  /** Okno zamkniete nadal rezerwuje czas, ale nie przyjmuje zaproszen. */
  isOpen: boolean;
  note: string | null;
}

/** Licznik wlasnych spotkan - to samo, co widzi zakladka "Moje spotkania". */
export interface MyMeetingsSummary {
  incomingPending: number;
  outgoingPending: number;
  accepted: number;
  held: number;
}

export interface MeetingExchange {
  eventId: string | null;
  configured: boolean;
  isEnabled: boolean;
  visibility: MeetingVisibility;
  /** Rozstrzygniecie bazy: czy w TEJ chwili wolno wysylac zaproszenia. */
  openNow: boolean;
  slotMinutes: number | null;
  breakMinutes: number | null;
  dayStartTime: string | null;
  dayEndTime: string | null;
  meetingDays: string[];
  timezone: string | null;
  invitesOpenAt: string | null;
  invitesCloseAt: string | null;
  introPl: string;
  introEn: string;
  inviteExpiresAfterHours: number | null;
  maxInvitesPerPerson: number | null;
  maxMeetingsPerDay: number | null;
  /** `null` = wolajacy nie jest zapisany na to wydarzenie. */
  myRegistrationId: string | null;
  /** Czy grupa uczestnika ma w ogole prawo umawiac spotkania. */
  canMeet: boolean;
  invitesUsed: number;
  /** `null` = brak limitu zaproszen, a nie "zero pozostalo". */
  invitesLeft: number | null;
  tablesCount: number;
  myAvailability: MyAvailabilityWindow[];
  summary: MyMeetingsSummary;
}

export const EMPTY_MEETING_EXCHANGE: MeetingExchange = {
  eventId: null,
  configured: false,
  isEnabled: false,
  visibility: "disabled",
  openNow: false,
  slotMinutes: null,
  breakMinutes: null,
  dayStartTime: null,
  dayEndTime: null,
  meetingDays: [],
  timezone: null,
  invitesOpenAt: null,
  invitesCloseAt: null,
  introPl: "",
  introEn: "",
  inviteExpiresAfterHours: null,
  maxInvitesPerPerson: null,
  maxMeetingsPerDay: null,
  myRegistrationId: null,
  canMeet: false,
  invitesUsed: 0,
  invitesLeft: null,
  tablesCount: 0,
  myAvailability: [],
  summary: { incomingPending: 0, outgoingPending: 0, accepted: 0, held: 0 },
};

type Bag = Record<string, unknown>;

function bag(value: unknown): Bag | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Bag)
    : null;
}

function int(source: Bag, key: string): number {
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : 0;
}

/** Liczba albo `null` - rozroznienie "brak limitu" od "limit rowny zero". */
function optionalInt(source: Bag, key: string): number | null {
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : null;
}

function str(source: Bag, key: string): string | null {
  const value = source[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function text(source: Bag, key: string): string {
  const value = source[key];
  return typeof value === "string" ? value : "";
}

function flag(source: Bag, key: string): boolean {
  return source[key] === true;
}

function strings(source: Bag, key: string): string[] {
  const value = source[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

const VISIBILITY_SET = new Set<string>(MEETING_VISIBILITIES);

function visibility(source: Bag): MeetingVisibility {
  const value = source["visibility"];
  return typeof value === "string" && VISIBILITY_SET.has(value)
    ? (value as MeetingVisibility)
    : "disabled";
}

function availability(source: Bag): MyAvailabilityWindow[] {
  const raw = source["my_availability"];
  if (!Array.isArray(raw)) return [];
  const out: MyAvailabilityWindow[] = [];
  for (const item of raw) {
    const row = bag(item);
    if (row === null) continue;
    const id = str(row, "id");
    const startsAt = str(row, "starts_at");
    const endsAt = str(row, "ends_at");
    // Okno bez identyfikatora albo bez granic nie da sie ani pokazac, ani
    // usunac - pomijamy je zamiast renderowac wiersz bez klucza.
    if (id === null || startsAt === null || endsAt === null) continue;
    out.push({ id, startsAt, endsAt, isOpen: row["is_open"] !== false, note: str(row, "note") });
  }
  return out;
}

function summary(source: Bag): MyMeetingsSummary {
  const row = bag(source["my_meetings_summary"]);
  if (row === null) return EMPTY_MEETING_EXCHANGE.summary;
  return {
    incomingPending: int(row, "incoming_pending"),
    outgoingPending: int(row, "outgoing_pending"),
    accepted: int(row, "accepted"),
    held: int(row, "held"),
  };
}

/** Zamienia surowa odpowiedz `event_meeting_exchange` na typowany stan ekranu. */
export function parseMeetingExchange(raw: Json | null | undefined): MeetingExchange {
  const root = bag(raw);
  if (root === null) return EMPTY_MEETING_EXCHANGE;

  return {
    eventId: str(root, "event_id"),
    configured: flag(root, "configured"),
    isEnabled: flag(root, "is_enabled"),
    visibility: visibility(root),
    openNow: flag(root, "open_now"),
    slotMinutes: optionalInt(root, "slot_minutes"),
    breakMinutes: optionalInt(root, "break_minutes"),
    dayStartTime: str(root, "day_start_time"),
    dayEndTime: str(root, "day_end_time"),
    meetingDays: strings(root, "meeting_days"),
    timezone: str(root, "timezone"),
    invitesOpenAt: str(root, "invites_open_at"),
    invitesCloseAt: str(root, "invites_close_at"),
    introPl: text(root, "intro_pl"),
    introEn: text(root, "intro_en"),
    inviteExpiresAfterHours: optionalInt(root, "invite_expires_after_hours"),
    maxInvitesPerPerson: optionalInt(root, "max_invites_per_person"),
    maxMeetingsPerDay: optionalInt(root, "max_meetings_per_day"),
    myRegistrationId: str(root, "my_registration_id"),
    canMeet: flag(root, "can_meet"),
    invitesUsed: int(root, "invites_used"),
    invitesLeft: optionalInt(root, "invites_left"),
    tablesCount: int(root, "tables_count"),
    myAvailability: availability(root),
    summary: summary(root),
  };
}

/** Wstep giełdy w jezyku interfejsu, z degradacja do drugiego jezyka. */
export function exchangeIntro(exchange: MeetingExchange, lang: string): string {
  const primary = lang === "en" ? exchange.introEn : exchange.introPl;
  const fallback = lang === "en" ? exchange.introPl : exchange.introEn;
  return primary.trim().length > 0 ? primary : fallback;
}

/** Powod, dla ktorego uczestnik nie moze wysylac zaproszen - albo `null`. */
export type ExchangeBlock =
  "notConfigured" | "disabled" | "notRegistered" | "notAllowed" | "closed";

export function exchangeBlock(exchange: MeetingExchange): ExchangeBlock | null {
  if (!exchange.configured) return "notConfigured";
  if (!exchange.isEnabled || exchange.visibility === "disabled") return "disabled";
  if (exchange.myRegistrationId === null) return "notRegistered";
  if (!exchange.canMeet) return "notAllowed";
  if (!exchange.openNow) return "closed";
  return null;
}
