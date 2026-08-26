// Model PUBLICZNEJ agendy wydarzenia (RPC `event_agenda`).
//
// JEDNO WYWOŁANIE, JEDNA CHWILA W CZASIE. Baza liczy w tym samym zapytaniu
// zajętość sesji, mój zapis i `access_state` - gdyby front składał to z trzech
// źródeł, uczestnik zobaczyłby „wolne miejsca" obok przycisku, który odmawia.
//
// `access_state` JEST DECYZJĄ BAZY, NIE PODPOWIEDZIĄ. Front nie liczy go
// ponownie z `capacity`, `min_tier_rank` i `requires_signup`: te same kolumny
// dałyby inny wynik w innym momencie, a rozjazd między plakietką a odmową RPC
// jest dokładnie tym, czego uczestnik nie umie sobie wytłumaczyć.
//
// DZIEŃ LICZY SIĘ W STREFIE WYDARZENIA. Kongres w Brukseli ma dwa dni po
// czasie Brukseli, także dla uczestnika, który ogląda program z Warszawy -
// dlatego klucz dnia bierze się z `eventDayKey`, a nie z `Date` przeglądarki.
import type { Database, Json } from "@/integrations/supabase/types";
import { eventDayKey } from "@/lib/events/timezone";
import { foldQuery } from "@/lib/search/fuzzy";
import type { UiLang } from "@/lib/i18n/format";
import { pickLocalized } from "@/lib/i18n/pickLocalized";

type Fns = Database["public"]["Functions"];

/** Wiersz RPC - kształt WPROST z sygnatury, nie przepisany ręcznie. */
export type EventAgendaRow = Fns["event_agenda"]["Returns"][number];

/** Stany wyliczane przez `event_agenda` - słownik domknięty w SQL. */
export const AGENDA_ACCESS_STATES = [
  "open",
  "signup_required",
  "signed_up",
  "waitlisted",
  "full",
  "tier_required",
  "cancelled",
] as const;
export type AgendaAccessState = (typeof AGENDA_ACCESS_STATES)[number];

/** Stan MOJEGO zapisu na sesję (`event_session_signups.status`). */
export const AGENDA_SIGNUP_STATUSES = ["registered", "waitlist", "cancelled"] as const;
export type AgendaSignupStatus = (typeof AGENDA_SIGNUP_STATUSES)[number];

export const AGENDA_FORMATS = ["onsite", "online", "hybrid"] as const;
export type AgendaFormat = (typeof AGENDA_FORMATS)[number];

export const AGENDA_SESSION_STATUSES = ["published", "cancelled"] as const;
export type AgendaSessionStatus = (typeof AGENDA_SESSION_STATUSES)[number];

export interface AgendaTrack {
  id: string;
  key: string | null;
  namePl: string | null;
  nameEn: string | null;
  accentColor: string | null;
}

export interface AgendaRoom {
  id: string;
  name: string | null;
  floor: string | null;
}

export interface AgendaSpeaker {
  userId: string;
  slug: string | null;
  displayName: string;
  avatarUrl: string | null;
  headlinePl: string | null;
  headlineEn: string | null;
  role: string | null;
  sortOrder: number;
}

export interface AgendaSession {
  id: string;
  eventId: string;
  parentSessionId: string | null;
  titlePl: string | null;
  titleEn: string | null;
  descriptionPl: string | null;
  descriptionEn: string | null;
  startsAt: string;
  endsAt: string;
  timezone: string | null;
  format: AgendaFormat;
  status: AgendaSessionStatus;
  sortOrder: number;
  chathamHouse: boolean;
  minTierRank: number;
  requiresSignup: boolean;
  /** `null` = bez limitu miejsc. */
  capacity: number | null;
  registeredCount: number;
  seatsLeft: number | null;
  track: AgendaTrack | null;
  room: AgendaRoom | null;
  hasStream: boolean;
  hasRecording: boolean;
  mySignupStatus: AgendaSignupStatus | null;
  accessState: AgendaAccessState;
  speakers: AgendaSpeaker[];
}

export interface AgendaDay {
  /** `YYYY-MM-DD` w strefie wydarzenia - stabilny klucz zakładki. */
  key: string;
  /** Pierwsza sesja dnia: źródło etykiety, żeby widok nie parsował klucza. */
  startsAt: string;
  timezone: string | null;
  sessions: AgendaSession[];
}

export interface AgendaTrackOption extends AgendaTrack {
  /** Ile sesji ma ten nurt - filtr bez liczby nie mówi, czego się spodziewać. */
  count: number;
}

export const EMPTY_AGENDA: readonly AgendaSession[] = [];

/* -------------------------------------------------------------- parsowanie --- */

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function int(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : fallback;
}

function nullableInt(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : null;
}

function accessStateOf(value: unknown): AgendaAccessState {
  const raw = text(value);
  // Nieznany stan czytamy jako „potrzebny zapis": to jedyna odpowiedź, która
  // niczego nie obiecuje i nie odbiera - uczestnik dostaje przycisk, a decyzję
  // i tak podejmuje baza przy wywołaniu.
  return raw !== null && (AGENDA_ACCESS_STATES as readonly string[]).includes(raw)
    ? (raw as AgendaAccessState)
    : "signup_required";
}

function signupStatusOf(value: unknown): AgendaSignupStatus | null {
  const raw = text(value);
  return raw !== null && (AGENDA_SIGNUP_STATUSES as readonly string[]).includes(raw)
    ? (raw as AgendaSignupStatus)
    : null;
}

function formatOf(value: unknown): AgendaFormat {
  const raw = text(value);
  return raw !== null && (AGENDA_FORMATS as readonly string[]).includes(raw)
    ? (raw as AgendaFormat)
    : "onsite";
}

function sessionStatusOf(value: unknown): AgendaSessionStatus {
  return text(value) === "cancelled" ? "cancelled" : "published";
}

function parseSpeakers(value: Json | null): AgendaSpeaker[] {
  if (!Array.isArray(value)) return [];
  const out: AgendaSpeaker[] = [];
  value.forEach((item, index) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return;
    const row = item as Record<string, unknown>;
    const userId = text(row.user_id);
    if (userId === null) return;
    out.push({
      userId,
      slug: text(row.slug),
      // Prelegent bez nazwy do wyświetlenia nie ma jak być klikalny, ale nadal
      // liczy się do „ilu ich jest" - stąd pusty napis, a nie odrzucenie wiersza.
      displayName: text(row.display_name) ?? "",
      avatarUrl: text(row.avatar_url),
      headlinePl: text(row.headline_pl),
      headlineEn: text(row.headline_en),
      role: text(row.role),
      sortOrder: int(row.sort_order, index),
    });
  });
  return out.sort(
    (a, b) => a.sortOrder - b.sortOrder || a.displayName.localeCompare(b.displayName),
  );
}

function parseTrack(row: EventAgendaRow): AgendaTrack | null {
  const id = text(row.track_id);
  if (id === null) return null;
  return {
    id,
    key: text(row.track_key),
    namePl: text(row.track_name_pl),
    nameEn: text(row.track_name_en),
    accentColor: text(row.track_accent_color),
  };
}

function parseRoom(row: EventAgendaRow): AgendaRoom | null {
  const id = text(row.room_id);
  if (id === null) return null;
  return { id, name: text(row.room_name), floor: text(row.room_floor) };
}

/**
 * Wiersze RPC -> model widoku. Sesja bez identyfikatora albo bez daty wypada:
 * nie da się jej ani zapisać, ani umieścić w dniu, więc byłaby pustym wierszem.
 */
export function parseEventAgenda(rows: readonly EventAgendaRow[] | null): AgendaSession[] {
  if (rows === null) return [];
  const out: AgendaSession[] = [];
  for (const row of rows) {
    const id = text(row.id);
    const startsAt = text(row.starts_at);
    if (id === null || startsAt === null) continue;
    const capacity = nullableInt(row.capacity);
    out.push({
      id,
      eventId: text(row.event_id) ?? "",
      parentSessionId: text(row.parent_session_id),
      titlePl: text(row.title_pl),
      titleEn: text(row.title_en),
      descriptionPl: text(row.description_pl),
      descriptionEn: text(row.description_en),
      startsAt,
      endsAt: text(row.ends_at) ?? startsAt,
      timezone: text(row.timezone),
      format: formatOf(row.format),
      status: sessionStatusOf(row.status),
      sortOrder: int(row.sort_order, 0),
      chathamHouse: row.chatham_house === true,
      minTierRank: int(row.min_tier_rank, 0),
      requiresSignup: row.requires_signup === true,
      capacity,
      registeredCount: int(row.registered_count, 0),
      seatsLeft: nullableInt(row.seats_left),
      track: parseTrack(row),
      room: parseRoom(row),
      hasStream: row.has_stream === true,
      hasRecording: row.has_recording === true,
      mySignupStatus: signupStatusOf(row.my_signup_status),
      accessState: accessStateOf(row.access_state),
      speakers: parseSpeakers(row.speakers),
    });
  }
  return out.sort(
    (a, b) =>
      Date.parse(a.startsAt) - Date.parse(b.startsAt) ||
      a.sortOrder - b.sortOrder ||
      a.id.localeCompare(b.id),
  );
}

/* ------------------------------------------------------------ grupowanie --- */

/** Sesje pogrupowane w dni wydarzenia, w kolejności rozpoczęcia. */
export function groupAgendaByDay(sessions: readonly AgendaSession[]): AgendaDay[] {
  const days = new Map<string, AgendaDay>();
  for (const session of sessions) {
    const key = eventDayKey(session.startsAt, session.timezone);
    const day = days.get(key);
    if (day === undefined) {
      days.set(key, {
        key,
        startsAt: session.startsAt,
        timezone: session.timezone,
        sessions: [session],
      });
      continue;
    }
    day.sessions.push(session);
  }
  return [...days.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/** Nurty obecne w agendzie - do filtra, razem z liczbą sesji. */
export function agendaTrackOptions(sessions: readonly AgendaSession[]): AgendaTrackOption[] {
  const tracks = new Map<string, AgendaTrackOption>();
  for (const session of sessions) {
    if (session.track === null) continue;
    const known = tracks.get(session.track.id);
    if (known === undefined) tracks.set(session.track.id, { ...session.track, count: 1 });
    else known.count += 1;
  }
  return [...tracks.values()].sort(
    (a, b) => (a.key ?? "").localeCompare(b.key ?? "") || b.count - a.count,
  );
}

/**
 * Czy uczestnik ma na tej sesji MIEJSCE - zapis albo rezerwę.
 *
 * DLACZEGO REZYGNACJA NIE LICZY SIĘ DO „MOICH SESJI”. `event_agenda` oddaje
 * `my_signup_status` także dla zapisu ODWOŁANEGO - to ślad historii, nie
 * miejsce na sali. `agendaSignupControl` już dzisiaj czyta go tak samo:
 * po rezygnacji podaje z powrotem przycisk zapisu. Gdyby „tylko moje sesje”
 * i „Twój harmonogram” liczyły to inaczej, uczestnik zobaczyłby sesję na
 * swojej liście i przycisk „zapisz się” pod nią - dwie odpowiedzi na jedno
 * pytanie w jednym bloku.
 */
export function hasSeat(session: AgendaSession): boolean {
  return session.mySignupStatus === "registered" || session.mySignupStatus === "waitlist";
}

/**
 * Tekst, po którym szuka pole „Wyszukiwanie” nad programem.
 *
 * OBA JĘZYKI, NIE TYLKO JĘZYK INTERFEJSU. Program dwujęzycznego kongresu ma
 * tytuły wpisane raz po polsku, raz po angielsku, a nazwiska prelegentów są
 * takie same w obu. Szukanie tylko w kolumnie języka interfejsu kazałoby
 * uczestnikowi zgadywać, w którym języku redakcja wpisała sesję.
 */
function searchHaystack(session: AgendaSession): string {
  const parts: string[] = [session.titlePl ?? "", session.titleEn ?? ""];
  if (session.track !== null) parts.push(session.track.namePl ?? "", session.track.nameEn ?? "");
  if (session.room !== null) parts.push(session.room.name ?? "", session.room.floor ?? "");
  for (const speaker of session.speakers) {
    parts.push(speaker.displayName, speaker.headlinePl ?? "", speaker.headlineEn ?? "");
  }
  return parts.join(" ");
}

/**
 * Czy sesja pasuje do wpisanej frazy. Pusta fraza pasuje do wszystkiego -
 * pole wyszukiwania w spoczynku nie może ukrywać programu.
 *
 * Składanie diakrytyków idzie przez `foldQuery` po OBU stronach, więc „prelegent
 * Zabłocki” znajduje się po wpisaniu „zablocki”, a wklejona fraza z ogonkami
 * nadal znajduje tekst bez nich.
 */
export function matchesAgendaQuery(session: AgendaSession, query: string): boolean {
  const needle = foldQuery(query.trim().toLowerCase());
  if (needle === "") return true;
  return foldQuery(searchHaystack(session).toLowerCase()).includes(needle);
}

export interface AgendaFilter {
  /** `null` = wszystkie nurty. */
  trackId: string | null;
  /** Tylko sesje, na które uczestnik jest zapisany (także rezerwa). */
  onlyMine: boolean;
  /** Fraza z pola „Wyszukiwanie”; brak albo pusta = bez filtra. */
  query?: string;
}

export const EMPTY_AGENDA_FILTER: AgendaFilter = { trackId: null, onlyMine: false, query: "" };

export function filterAgenda(
  sessions: readonly AgendaSession[],
  filter: AgendaFilter,
): AgendaSession[] {
  return sessions.filter((session) => {
    if (filter.trackId !== null && session.track?.id !== filter.trackId) return false;
    if (filter.onlyMine && !hasSeat(session)) return false;
    if (filter.query !== undefined && !matchesAgendaQuery(session, filter.query)) return false;
    return true;
  });
}

/** Czy uczestnik ma cokolwiek w „mojej agendzie" - decyduje o pokazaniu filtra. */
export function hasOwnAgenda(sessions: readonly AgendaSession[]): boolean {
  return sessions.some(hasSeat);
}

/**
 * „Twój harmonogram”: sesje uczestnika ze WSZYSTKICH dni, chronologicznie.
 *
 * Kolumna z harmonogramem stoi obok zakładek dni i ma odpowiadać na pytanie
 * „gdzie mam dziś być”, a nie „co mam w wybranej zakładce” - dlatego bierze
 * całą agendę, nie dzień aktywny. Sortowanie jest tutaj, a nie u wołającego:
 * lista terminów nieuporządkowana po godzinie nie jest harmonogramem.
 */
export function ownAgenda(sessions: readonly AgendaSession[]): AgendaSession[] {
  return sessions.filter(hasSeat).sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}

/* --------------------------------------------------------------- napisy --- */

/**
 * Tytuł sesji w języku interfejsu - JEDNA reguła na wszystkie miejsca,
 * w których tytuł się pojawia (blok programu i kolumna „Twój harmonogram”).
 * Rozpisana dwa razy rozjechałaby się przy pierwszej sesji wpisanej tylko
 * po angielsku: jedna lista pokazywałaby tytuł, druga pustkę.
 */
export function agendaSessionTitle(session: AgendaSession, lang: UiLang): string {
  return pickLocalized({ title_pl: session.titlePl, title_en: session.titleEn }, "title", lang);
}

const ACCESS_STATE_CAMEL: Record<AgendaAccessState, string> = {
  open: "open",
  signup_required: "signupRequired",
  signed_up: "signedUp",
  waitlisted: "waitlisted",
  full: "full",
  tier_required: "tierRequired",
  cancelled: "cancelled",
};

/** Plakietka stanu sesji - jeden klucz na stan, bez składania zdań w JSX. */
export function agendaStateKey(state: AgendaAccessState): string {
  return `eventFront.agenda.states.${ACCESS_STATE_CAMEL[state]}`;
}

export function agendaFormatKey(format: AgendaFormat): string {
  return `eventFront.formats.${format}`;
}

/* ------------------------------------------------------------- kontrolka --- */

export type AgendaSignupAction = "signup" | "cancel";

export interface AgendaSignupControl {
  action: AgendaSignupAction;
  labelKey: string;
  /** Wariant przycisku - rezygnacja nie może wyglądać jak zapis. */
  variant: "default" | "secondary" | "ghost";
}

/**
 * Kształt kontrolki zapisu na sesję - albo `null`, gdy sesja jej nie ma.
 *
 * DLACZEGO TO NIE JEST `if` W KOMPONENCIE. Ta sama reguła obowiązuje w karcie
 * sesji, w „mojej agendzie" i w podglądzie dnia; rozpisana trzy razy rozjedzie
 * się przy pierwszej zmianie stanu w SQL. Test tej funkcji jest jednocześnie
 * testem wszystkich trzech widoków.
 *
 * Gość bez konta dostaje kontrolkę zapisu MIMO braku sesji: `event_session_signup`
 * wymaga logowania, więc klik prowadzi do logowania z powrotem tutaj - a to jest
 * lepsze niż przycisk, którego nie ma i którego istnienia nikt się nie domyśli.
 */
export function agendaSignupControl(session: AgendaSession): AgendaSignupControl | null {
  if (session.status === "cancelled") return null;
  if (!session.requiresSignup) return null;
  if (session.mySignupStatus === "registered" || session.mySignupStatus === "waitlist") {
    return {
      action: "cancel",
      labelKey: "eventFront.agenda.actions.cancel",
      variant: "ghost",
    };
  }
  if (session.accessState === "tier_required") return null;
  if (session.accessState === "full") {
    return {
      action: "signup",
      labelKey: "eventFront.agenda.actions.joinWaitlist",
      variant: "secondary",
    };
  }
  return { action: "signup", labelKey: "eventFront.agenda.actions.signup", variant: "default" };
}

/**
 * Liczba wolnych miejsc do pokazania obok przycisku albo `null`, gdy nie ma
 * czego pokazywać (sesja bez zapisów albo bez limitu).
 */
export function agendaSeatsLeft(session: AgendaSession): number | null {
  if (!session.requiresSignup) return null;
  return session.seatsLeft;
}
