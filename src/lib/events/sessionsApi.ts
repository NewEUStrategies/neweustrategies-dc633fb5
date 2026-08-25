// Dostep panelu organizatora do agendy wydarzenia: sesje, sciezki, sale,
// prelegenci, zapisy na sesje i raport kolizji.
//
// JEDEN PLIK NA CALY MODUL AGENDY. Sesja bez sali nie ma gdzie sie odbyc, bez
// sciezki nie da sie jej ulozyc w rownolegle pasma, a bez prelegenta nie ma
// tresci. Rozbicie na cztery pliki zdublowaloby typ sesji, a zdublowany typ
// rozjezdza sie przy pierwszej zmianie kolumny - dokladnie ten sam wniosek, co
// w module zapisow.
//
// TYPY WYPROWADZAMY Z WYGENEROWANYCH `Database`. Wiersz sesji ma ponad
// czterdziesci kolumn wyliczanych w SQL-u (`seats_left`, `speakers_count`,
// `children_count`); recznie przepisany interfejs bylby prawdziwy do najblizszej
// migracji.
//
// KLUCZE POMINIETE (`undefined`) NIE SA WYSYLANE. `admin_event_session_save`
// czyta `p_payload ? 'capacity'`, wiec brak klucza znaczy „zostaw jak bylo",
// a jawny `null` znaczy „zdejmij limit". Sklejenie obu odbieraloby organizatorowi
// mozliwosc zdjecia limitu miejsc albo odczepienia sesji od sali.
import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";

type Fns = Database["public"]["Functions"];

export type EventSessionRow = Fns["admin_event_sessions_list"]["Returns"][number];
export type EventSessionDetailRow = Fns["admin_event_session_detail"]["Returns"][number];
export type EventTrackRow = Fns["admin_event_tracks_list"]["Returns"][number];
export type EventRoomRow = Fns["admin_event_rooms_list"]["Returns"][number];
export type EventSessionSignupRow = Fns["admin_event_session_signups_list"]["Returns"][number];
export type AgendaConflictRow = Fns["admin_event_agenda_conflicts"]["Returns"][number];

/** `event_sessions_format_values` z migracji, jeden do jednego. */
export const SESSION_FORMATS = ["onsite", "online", "hybrid"] as const;
export type SessionFormat = (typeof SESSION_FORMATS)[number];

/** `event_sessions_status_values` - trzy stany, nie cztery. */
export const SESSION_STATUSES = ["draft", "published", "cancelled"] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

/** Filtr listy; `all` nie jest stanem w bazie, tylko brakiem filtra. */
export type SessionStatusFilter = SessionStatus | "all";

/** Role prelegenta. `host` nie wchodzi do raportu kolizji - prowadzi cale pasmo. */
export const SESSION_SPEAKER_ROLES = ["speaker", "moderator", "panelist", "host"] as const;
export type SessionSpeakerRole = (typeof SESSION_SPEAKER_ROLES)[number];

/** Stany zapisu na sesje. */
export const SESSION_SIGNUP_STATUSES = ["registered", "waitlist", "cancelled"] as const;
export type SessionSignupStatus = (typeof SESSION_SIGNUP_STATUSES)[number];

/** Rodzaje kolizji zwracane przez `admin_event_agenda_conflicts`. */
export const AGENDA_CONFLICT_KINDS = [
  "speaker_overlap",
  "outside_event_window",
  "capacity_over_room",
  "overbooked",
] as const;
export type AgendaConflictKind = (typeof AGENDA_CONFLICT_KINDS)[number];

type PayloadInput = Record<string, Json | undefined>;

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

function trimmedOrNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

// ---------------------------------------------------------------------------
// SCIEZKI
// ---------------------------------------------------------------------------

export async function fetchEventTracks(eventId: string): Promise<EventTrackRow[]> {
  const { data, error } = await supabase.rpc("admin_event_tracks_list", {
    p_event_id: eventId,
  });
  if (error) throw error;
  return data ?? [];
}

export interface EventTrackInput {
  id: string | null;
  eventId: string;
  /** Klucz techniczny; baza wymaga `^[a-z][a-z0-9_]{1,48}$` i nie pozwala go zmienic. */
  key: string;
  namePl: string;
  nameEn: string;
  accentColor: string | null;
  sortOrder: number;
  isActive: boolean;
}

export async function saveEventTrack(input: EventTrackInput): Promise<string> {
  const { data, error } = await supabase.rpc("admin_event_track_save", {
    p_payload: payload({
      // `null` w JSON-ie to nadal obecny klucz, a baza rozpoznaje edycje po
      // OBECNOSCI `id` - dlatego przy tworzeniu klucza nie wysylamy wcale.
      id: input.id ?? undefined,
      // Zmiana wydarzenia nie jest edycja sciezki - przy aktualizacji baza czyta
      // wydarzenie z wiersza, wiec klucz jest zbedny i mylacy.
      event_id: input.id === null ? input.eventId : undefined,
      key: input.id === null ? input.key : undefined,
      name_pl: input.namePl,
      name_en: input.nameEn,
      accent_color: input.accentColor,
      sort_order: input.sortOrder,
      is_active: input.isActive,
    }),
  });
  if (error) throw error;
  return String(data);
}

export async function deleteEventTrack(id: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("admin_event_track_delete", { _id: id });
  if (error) throw error;
  return Boolean(data);
}

// ---------------------------------------------------------------------------
// SALE
// ---------------------------------------------------------------------------

export async function fetchEventRooms(eventId: string): Promise<EventRoomRow[]> {
  const { data, error } = await supabase.rpc("admin_event_rooms_list", {
    p_event_id: eventId,
  });
  if (error) throw error;
  return data ?? [];
}

export interface EventRoomInput {
  id: string | null;
  eventId: string;
  name: string;
  /** `null` = sala bez podanej pojemnosci, nie sala na zero osob. */
  capacity: number | null;
  floor: string | null;
  locationNote: string | null;
  sortOrder: number;
  isActive: boolean;
}

export async function saveEventRoom(input: EventRoomInput): Promise<string> {
  const { data, error } = await supabase.rpc("admin_event_room_save", {
    p_payload: payload({
      // `null` w JSON-ie to nadal obecny klucz, a baza rozpoznaje edycje po
      // OBECNOSCI `id` - dlatego przy tworzeniu klucza nie wysylamy wcale.
      id: input.id ?? undefined,
      event_id: input.id === null ? input.eventId : undefined,
      name: input.name,
      capacity: input.capacity,
      floor: input.floor,
      location_note: input.locationNote,
      sort_order: input.sortOrder,
      is_active: input.isActive,
    }),
  });
  if (error) throw error;
  return String(data);
}

export async function deleteEventRoom(id: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("admin_event_room_delete", { _id: id });
  if (error) throw error;
  return Boolean(data);
}

// ---------------------------------------------------------------------------
// SESJE
// ---------------------------------------------------------------------------

export interface SessionsQuery {
  eventId: string;
  status: SessionStatusFilter;
  trackId: string | null;
  roomId: string | null;
  q: string;
}

export const DEFAULT_SESSIONS_QUERY: Omit<SessionsQuery, "eventId"> = {
  status: "all",
  trackId: null,
  roomId: null,
  q: "",
};

export async function fetchEventSessions(query: SessionsQuery): Promise<EventSessionRow[]> {
  const { data, error } = await supabase.rpc(
    "admin_event_sessions_list",
    args({
      p_event_id: query.eventId,
      p_status: query.status === "all" ? undefined : query.status,
      p_track_id: query.trackId ?? undefined,
      p_room_id: query.roomId ?? undefined,
      p_q: trimmedOrNull(query.q) ?? undefined,
    }),
  );
  if (error) throw error;
  return data ?? [];
}

export async function fetchSessionDetail(id: string): Promise<EventSessionDetailRow | null> {
  const { data, error } = await supabase.rpc("admin_event_session_detail", { _id: id });
  if (error) throw error;
  return data?.[0] ?? null;
}

export interface EventSessionInput {
  id: string | null;
  eventId: string;
  titlePl: string;
  titleEn: string;
  descriptionPl: string;
  descriptionEn: string;
  /** ISO z offsetem - strefa wydarzenia zyje w warstwie widoku, nie w bazie. */
  startsAt: string;
  endsAt: string;
  format: SessionFormat;
  status: SessionStatus;
  trackId: string | null;
  roomId: string | null;
  parentSessionId: string | null;
  requiresSignup: boolean;
  /** `null` = bez limitu miejsc; limit wymaga wlaczonych zapisow. */
  capacity: number | null;
  minTierRank: number;
  chathamHouse: boolean;
  isPrivate: boolean;
  /** `false` blokuje nachodzenie sie sesji dla tego samego uczestnika. */
  allowOverlap: boolean;
  streamUrl: string | null;
  recordingUrl: string | null;
  sortOrder: number;
}

export async function saveEventSession(input: EventSessionInput): Promise<string> {
  const { data, error } = await supabase.rpc("admin_event_session_save", {
    p_payload: payload({
      // `null` w JSON-ie to nadal obecny klucz, a baza rozpoznaje edycje po
      // OBECNOSCI `id` - dlatego przy tworzeniu klucza nie wysylamy wcale.
      id: input.id ?? undefined,
      // Baza odrzuca przeniesienie sesji do innego wydarzenia (`event_immutable`),
      // wiec wysylamy wydarzenie tylko przy tworzeniu.
      event_id: input.id === null ? input.eventId : undefined,
      title_pl: input.titlePl,
      title_en: input.titleEn,
      description_pl: input.descriptionPl,
      description_en: input.descriptionEn,
      starts_at: input.startsAt,
      ends_at: input.endsAt,
      format: input.format,
      status: input.status,
      track_id: input.trackId,
      room_id: input.roomId,
      parent_session_id: input.parentSessionId,
      requires_signup: input.requiresSignup,
      capacity: input.capacity,
      min_tier_rank: input.minTierRank,
      chatham_house: input.chathamHouse,
      is_private: input.isPrivate,
      allow_overlap: input.allowOverlap,
      stream_url: input.streamUrl,
      recording_url: input.recordingUrl,
      sort_order: input.sortOrder,
    }),
  });
  if (error) throw error;
  return String(data);
}

export async function deleteEventSession(id: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("admin_event_session_delete", { _id: id });
  if (error) throw error;
  return Boolean(data);
}

export interface SessionOrderItem {
  id: string;
  sortOrder: number;
}

/** Zwraca liczbe przestawionych wierszy. */
export async function reorderSessions(items: readonly SessionOrderItem[]): Promise<number> {
  const { data, error } = await supabase.rpc("admin_event_sessions_reorder", {
    p_payload: payload({
      items: items.map((item) => ({
        id: item.id,
        sort_order: item.sortOrder,
      })),
    }),
  });
  if (error) throw error;
  return Number(data ?? 0);
}

export interface SessionsStatusInput {
  ids: readonly string[];
  status: SessionStatus;
}

/** Zbiorcza zmiana stanu. Zwraca liczbe zmienionych sesji. */
export async function setSessionsStatus(input: SessionsStatusInput): Promise<number> {
  const { data, error } = await supabase.rpc("admin_event_sessions_set_status", {
    p_payload: payload({
      ids: [...input.ids],
      status: input.status,
    }),
  });
  if (error) throw error;
  return Number(data ?? 0);
}

// ---------------------------------------------------------------------------
// PRELEGENCI SESJI
// ---------------------------------------------------------------------------

export interface SessionSpeakerInput {
  speakerProfileId: string;
  role: SessionSpeakerRole;
  sortOrder: number;
  /** Zgoda na wystapienie w dwoch sesjach o tej samej godzinie - swiadoma decyzja. */
  allowOverlap: boolean;
}

/**
 * Podmiana CALEJ obsady sesji, nie dopisanie jednej osoby. Baza usuwa wiersze
 * nieobecne w tablicy, wiec wysylamy stan docelowy - inaczej dwie karty otwarte
 * jednoczesnie kasowalyby sobie prelegentow nawzajem.
 */
export async function setSessionSpeakers(
  sessionId: string,
  speakers: readonly SessionSpeakerInput[],
): Promise<number> {
  const { data, error } = await supabase.rpc("admin_event_session_speakers_set", {
    p_payload: payload({
      session_id: sessionId,
      speakers: speakers.map((speaker) => ({
        speaker_profile_id: speaker.speakerProfileId,
        role: speaker.role,
        sort_order: speaker.sortOrder,
        allow_overlap: speaker.allowOverlap,
      })),
    }),
  });
  if (error) throw error;
  return Number(data ?? 0);
}

// ---------------------------------------------------------------------------
// ZAPISY NA SESJE
// ---------------------------------------------------------------------------

export async function fetchSessionSignups(sessionId: string): Promise<EventSessionSignupRow[]> {
  const { data, error } = await supabase.rpc("admin_event_session_signups_list", {
    p_session_id: sessionId,
  });
  if (error) throw error;
  return data ?? [];
}

export interface SessionSignupInput {
  sessionId: string;
  userId: string;
  status: SessionSignupStatus;
  /** Wejscie ponad limit miejsc - baza wymaga jawnej zgody (`session_full`). */
  force: boolean;
}

export async function setSessionSignup(input: SessionSignupInput): Promise<Json> {
  const { data, error } = await supabase.rpc("admin_event_session_signup_set", {
    p_payload: payload({
      session_id: input.sessionId,
      user_id: input.userId,
      status: input.status,
      force: input.force,
    }),
  });
  if (error) throw error;
  return (data ?? {}) as Json;
}

// ---------------------------------------------------------------------------
// RAPORT KOLIZJI
// ---------------------------------------------------------------------------

export async function fetchAgendaConflicts(eventId: string): Promise<AgendaConflictRow[]> {
  const { data, error } = await supabase.rpc("admin_event_agenda_conflicts", {
    p_event_id: eventId,
  });
  if (error) throw error;
  return data ?? [];
}
