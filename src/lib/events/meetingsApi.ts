// Dostep do gieldy spotkan 1-1 (Business Matching Exchange).
//
// JEDEN PLIK NA CALY MODUL, DWIE PLASZCZYZNY. Panel organizatora i ekran
// uczestnika wolaja rozne funkcje bazy, ale te same ksztalty wierszy - stolik
// w liscie panelu i stolik w podsumowaniu uczestnika to ten sam wiersz. Rozbicie
// na dwa pliki dublowaloby typy, a zdublowany typ rozjezdza sie przy pierwszej
// zmianie kolumny.
//
// TYPY BIERZEMY Z WYGENEROWANYCH `Database`, NIE PRZEPISUJEMY ICH RECZNIE.
// Recznie przepisany wiersz jest prawdziwy dokladnie do najblizszej migracji;
// wyprowadzony z `Functions[...]["Returns"]` przestaje sie kompilowac w tej samej
// minucie, w ktorej baza zmienia kontrakt - i o to chodzi.
//
// PAYLOAD JEST jsonb WSZEDZIE, GDZIE FUNKCJA MA WIECEJ NIZ JEDEN ARGUMENT.
// Postgres przeciaza po sygnaturze, wiec kazde nowe pole w wersji pozycyjnej
// to nowa funkcja i nowy grant. Tlumaczenie camelCase -> snake_case zyje
// wylacznie tutaj.
import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";

type Fns = Database["public"]["Functions"];

export type MeetingTableRow = Fns["admin_event_meeting_tables_list"]["Returns"][number];
export type AdminMeetingRow = Fns["admin_event_meetings_list"]["Returns"][number];
export type MeetingFreeSlot = Fns["admin_event_meeting_free_slots"]["Returns"][number];
export type MyMeetingRow = Fns["event_meetings_mine"]["Returns"][number];

/** Stany spotkania - odwzorowanie CHECK-a z migracji jeden do jednego. */
export const MEETING_STATUSES = [
  "invited",
  "accepted",
  "declined",
  "cancelled",
  "rescheduled",
  "held",
  "no_show",
] as const;
export type MeetingStatus = (typeof MEETING_STATUSES)[number];

/** Filtry listy panelu; `pending` i `expired` to widoki stanu `invited`, nie osobne stany w bazie. */
export type MeetingStatusFilter = MeetingStatus | "all" | "pending" | "expired";

export type MeetingSide = "requester" | "invitee";

type Payload = Record<string, Json>;

function payload(input: Payload): Json {
  // Klucze o wartosci `undefined` sa POMINIETE, a nie wyslane jako null:
  // RPC rozroznia "pole nieobecne" (zachowaj) od jawnego null (wyczysc).
  const out: Payload = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) out[key] = value;
  }
  return out as Json;
}

// ---------------------------------------------------------------------------
// PANEL ORGANIZATORA: STOLIKI
// ---------------------------------------------------------------------------

export async function fetchMeetingTables(eventId: string): Promise<MeetingTableRow[]> {
  const { data, error } = await supabase.rpc("admin_event_meeting_tables_list", {
    p_event_id: eventId,
  });
  if (error) throw error;
  return data ?? [];
}

export interface MeetingTableInput {
  id: string | null;
  eventId: string;
  label: string;
  zone: string | null;
  roomId: string | null;
  capacity: number;
  note: string | null;
  sortOrder: number;
  isActive: boolean;
}

export async function saveMeetingTable(input: MeetingTableInput): Promise<string> {
  const { data, error } = await supabase.rpc("admin_event_meeting_table_save", {
    p_payload: payload({
      id: input.id,
      event_id: input.eventId,
      label: input.label,
      zone: input.zone,
      room_id: input.roomId,
      capacity: input.capacity,
      note: input.note,
      sort_order: input.sortOrder,
      is_active: input.isActive,
    }),
  });
  if (error) throw error;
  return String(data);
}

export async function deleteMeetingTable(id: string): Promise<boolean> {
  const { error } = await supabase.rpc("admin_event_meeting_table_delete", { _id: id });
  if (error) throw error;
  return true;
}

// ---------------------------------------------------------------------------
// PANEL ORGANIZATORA: KONFIGURACJA GIELDY
// ---------------------------------------------------------------------------
//
// KLUCZE PAYLOADU SA DOKLADNIE TYMI, KTORE CZYTA `admin_event_meeting_settings_save`.
// Funkcja nie odrzuca nieznanego klucza - po prostu go IGNORUJE, wiec literowka
// w nazwie pola nie konczy sie bledem, tylko cicho niezapisana konfiguracja.
// Dlatego kontrakt jest zamkniety typem i pilnowany testem.

/** Reguly widocznosci gieldy - odwzorowanie CHECK-a `visibility` z migracji. */
export const MEETING_VISIBILITIES = [
  "everyone",
  "groups",
  "sponsors_to_attendees",
  "disabled",
] as const;
export type MeetingVisibility = (typeof MEETING_VISIBILITIES)[number];

/** Grupa uczestnikow w regule gieldy - ksztalt z `jsonb_build_object` w RPC. */
export interface MeetingRuleGroup {
  group_id: string;
  key: string;
  name_pl: string;
  name_en: string;
  can_meet: boolean;
  can_lead_retrieval: boolean;
}

/** Odpowiedz `admin_event_meeting_settings_get` - jeden do jednego z RPC. */
export interface MeetingSettings {
  configured: boolean;
  event_id: string;
  event_timezone: string | null;
  is_enabled: boolean;
  slot_minutes: number;
  break_minutes: number;
  day_start_time: string;
  day_end_time: string;
  meeting_days: string[];
  timezone: string;
  invites_open_at: string | null;
  invites_close_at: string | null;
  max_invites_per_person: number | null;
  max_meetings_per_day: number | null;
  invite_expires_after_hours: number;
  visibility: MeetingVisibility;
  intro_pl: string;
  intro_en: string;
  updated_at: string | null;
  requester_groups: MeetingRuleGroup[];
  invitee_groups: MeetingRuleGroup[];
  available_groups: MeetingRuleGroup[];
  tables_count: number;
  seats_count: number;
  participants_count: number;
  with_availability_count: number;
}

export async function fetchMeetingSettings(eventId: string): Promise<MeetingSettings> {
  const { data, error } = await supabase.rpc("admin_event_meeting_settings_get", {
    p_event_id: eventId,
  });
  if (error) throw error;
  return data as unknown as MeetingSettings;
}

export interface MeetingSettingsInput {
  eventId: string;
  isEnabled: boolean;
  timezone: string;
  slotMinutes: number;
  breakMinutes: number;
  /** Godzina otwarcia i zamkniecia gieldy w danym dniu, `HH:MM`. */
  dayStartTime: string;
  dayEndTime: string;
  /** Konkretne dni gieldy (`YYYY-MM-DD`), nie zakres. */
  meetingDays: string[];
  invitesOpenAt: string | null;
  invitesCloseAt: string | null;
  inviteExpiresAfterHours: number;
  maxInvitesPerPerson: number | null;
  maxMeetingsPerDay: number | null;
  visibility: MeetingVisibility;
  introPl: string;
  introEn: string;
  /** Wysylane tylko przy regule `groups`; pominiete = zachowaj obecny przydzial. */
  requesterGroupIds?: string[];
  inviteeGroupIds?: string[];
}

export async function saveMeetingSettings(input: MeetingSettingsInput): Promise<MeetingSettings> {
  const { data, error } = await supabase.rpc("admin_event_meeting_settings_save", {
    p_payload: payload({
      event_id: input.eventId,
      is_enabled: input.isEnabled,
      timezone: input.timezone,
      slot_minutes: input.slotMinutes,
      break_minutes: input.breakMinutes,
      day_start_time: input.dayStartTime,
      day_end_time: input.dayEndTime,
      meeting_days: input.meetingDays,
      invites_open_at: input.invitesOpenAt,
      invites_close_at: input.invitesCloseAt,
      invite_expires_after_hours: input.inviteExpiresAfterHours,
      max_invites_per_person: input.maxInvitesPerPerson,
      max_meetings_per_day: input.maxMeetingsPerDay,
      visibility: input.visibility,
      intro_pl: input.introPl,
      intro_en: input.introEn,
      requester_group_ids: input.requesterGroupIds,
      invitee_group_ids: input.inviteeGroupIds,
    }),
  });
  if (error) throw error;
  return data as unknown as MeetingSettings;
}


// ---------------------------------------------------------------------------
// PANEL ORGANIZATORA: LISTA, STATYSTYKI, DECYZJE
// ---------------------------------------------------------------------------

export interface AdminMeetingsQuery {
  eventId: string;
  status?: MeetingStatusFilter;
  tableId?: string | null;
  groupKey?: string | null;
  sponsorId?: string | null;
  day?: string | null;
  search?: string | null;
  limit?: number;
  offset?: number;
}

export async function fetchAdminMeetings(query: AdminMeetingsQuery): Promise<AdminMeetingRow[]> {
  const { data, error } = await supabase.rpc("admin_event_meetings_list", {
    p_payload: payload({
      event_id: query.eventId,
      status: query.status ?? "all",
      table_id: query.tableId ?? null,
      group_key: query.groupKey ?? null,
      sponsor_id: query.sponsorId ?? null,
      day: query.day ?? null,
      search: query.search ?? null,
      limit: query.limit ?? 50,
      offset: query.offset ?? 0,
    }),
  });
  if (error) throw error;
  return data ?? [];
}

export async function fetchMeetingStats(eventId: string): Promise<Json> {
  const { data, error } = await supabase.rpc("admin_event_meeting_stats", {
    p_event_id: eventId,
  });
  if (error) throw error;
  return data;
}

/** Frekwencja i odwolanie jedna sciezka - taka sama, jak w bazie. */
export async function setMeetingStatus(input: {
  meetingId: string;
  status: "held" | "no_show" | "cancelled";
  reason?: string | null;
}): Promise<Json> {
  const { data, error } = await supabase.rpc("admin_event_meeting_set_status", {
    p_payload: payload({
      meeting_id: input.meetingId,
      status: input.status,
      reason: input.reason ?? null,
    }),
  });
  if (error) throw error;
  return data;
}

export async function fetchAdminFreeSlots(input: {
  eventId: string;
  requesterRegistrationId: string;
  inviteeRegistrationId: string;
  limit?: number;
}): Promise<MeetingFreeSlot[]> {
  const { data, error } = await supabase.rpc("admin_event_meeting_free_slots", {
    p_payload: payload({
      event_id: input.eventId,
      requester_registration_id: input.requesterRegistrationId,
      invitee_registration_id: input.inviteeRegistrationId,
      limit: input.limit ?? 50,
    }),
  });
  if (error) throw error;
  return data ?? [];
}

/** Organizator umawia spotkanie od razu przyjete (pakiety sponsorskie). */
export async function arrangeMeeting(input: {
  eventId: string;
  requesterRegistrationId: string;
  inviteeRegistrationId: string;
  startsAt: string;
  tableId?: string | null;
  topic?: string | null;
  sponsorId?: string | null;
  message?: string | null;
}): Promise<Json> {
  const { data, error } = await supabase.rpc("admin_event_meeting_arrange", {
    p_payload: payload({
      event_id: input.eventId,
      requester_registration_id: input.requesterRegistrationId,
      invitee_registration_id: input.inviteeRegistrationId,
      starts_at: input.startsAt,
      table_id: input.tableId ?? null,
      topic: input.topic ?? null,
      sponsor_id: input.sponsorId ?? null,
      message: input.message ?? null,
    }),
  });
  if (error) throw error;
  return data;
}

// ---------------------------------------------------------------------------
// PANEL ORGANIZATORA: OKNA DOSTEPNOSCI UCZESTNIKA
// ---------------------------------------------------------------------------

export async function saveAdminAvailability(input: {
  id?: string | null;
  eventId: string;
  registrationId: string;
  startsAt: string;
  endsAt: string;
  note?: string | null;
}): Promise<string> {
  const { data, error } = await supabase.rpc("admin_event_meeting_availability_set", {
    p_payload: payload({
      id: input.id ?? null,
      event_id: input.eventId,
      registration_id: input.registrationId,
      starts_at: input.startsAt,
      ends_at: input.endsAt,
      note: input.note ?? null,
    }),
  });
  if (error) throw error;
  return String(data);
}

export async function deleteAdminAvailability(id: string): Promise<boolean> {
  const { error } = await supabase.rpc("admin_event_meeting_availability_delete", { _id: id });
  if (error) throw error;
  return true;
}

// ---------------------------------------------------------------------------
// PLASZCZYZNA UCZESTNIKA
// ---------------------------------------------------------------------------

/** Caly ekran gieldy jednym wywolaniem: siatka, limity, uprawnienie grupy, wlasne okna. */
export async function fetchMeetingExchange(input: {
  eventId?: string;
  eventSlug?: string;
}): Promise<Json> {
  const { data, error } = await supabase.rpc("event_meeting_exchange", {
    p_payload: payload({
      event_id: input.eventId ?? null,
      event_slug: input.eventSlug ?? null,
    }),
  });
  if (error) throw error;
  return data;
}

export async function saveMyAvailability(input: {
  id?: string | null;
  eventId?: string;
  eventSlug?: string;
  startsAt: string;
  endsAt: string;
  note?: string | null;
}): Promise<string> {
  const { data, error } = await supabase.rpc("event_meeting_availability_set", {
    p_payload: payload({
      id: input.id ?? null,
      event_id: input.eventId ?? null,
      event_slug: input.eventSlug ?? null,
      starts_at: input.startsAt,
      ends_at: input.endsAt,
      note: input.note ?? null,
    }),
  });
  if (error) throw error;
  return String(data);
}

export async function deleteMyAvailability(id: string): Promise<boolean> {
  const { error } = await supabase.rpc("event_meeting_availability_delete", {
    p_payload: payload({ id }),
  });
  if (error) throw error;
  return true;
}

export async function fetchMyFreeSlots(input: {
  eventId?: string;
  eventSlug?: string;
  inviteeRegistrationId: string;
  limit?: number;
}): Promise<MeetingFreeSlot[]> {
  const { data, error } = await supabase.rpc("event_meeting_free_slots", {
    p_payload: payload({
      event_id: input.eventId ?? null,
      event_slug: input.eventSlug ?? null,
      invitee_registration_id: input.inviteeRegistrationId,
      limit: input.limit ?? 50,
    }),
  });
  if (error) throw error;
  return data ?? [];
}

export async function inviteToMeeting(input: {
  eventId?: string;
  eventSlug?: string;
  inviteeRegistrationId: string;
  startsAt: string;
  topic?: string | null;
  message?: string | null;
  sponsorId?: string | null;
}): Promise<Json> {
  const { data, error } = await supabase.rpc("event_meeting_invite", {
    p_payload: payload({
      event_id: input.eventId ?? null,
      event_slug: input.eventSlug ?? null,
      invitee_registration_id: input.inviteeRegistrationId,
      starts_at: input.startsAt,
      topic: input.topic ?? null,
      message: input.message ?? null,
      sponsor_id: input.sponsorId ?? null,
    }),
  });
  if (error) throw error;
  return data;
}

export async function respondToMeeting(input: {
  meetingId: string;
  decision: "accept" | "decline";
  declineReason?: string | null;
  tableId?: string | null;
}): Promise<Json> {
  const { data, error } = await supabase.rpc("event_meeting_respond", {
    p_payload: payload({
      meeting_id: input.meetingId,
      decision: input.decision,
      decline_reason: input.declineReason ?? null,
      table_id: input.tableId ?? null,
    }),
  });
  if (error) throw error;
  return data;
}

export async function cancelMeeting(input: {
  meetingId: string;
  reason?: string | null;
}): Promise<Json> {
  const { data, error } = await supabase.rpc("event_meeting_cancel", {
    p_payload: payload({
      meeting_id: input.meetingId,
      reason: input.reason ?? null,
    }),
  });
  if (error) throw error;
  return data;
}

export async function rescheduleMeeting(input: {
  meetingId: string;
  startsAt: string;
  message?: string | null;
}): Promise<Json> {
  const { data, error } = await supabase.rpc("event_meeting_reschedule", {
    p_payload: payload({
      meeting_id: input.meetingId,
      starts_at: input.startsAt,
      message: input.message ?? null,
    }),
  });
  if (error) throw error;
  return data;
}

export async function fetchMyMeetings(input: {
  eventId?: string;
  eventSlug?: string;
  status?: MeetingStatusFilter;
  limit?: number;
}): Promise<MyMeetingRow[]> {
  const { data, error } = await supabase.rpc("event_meetings_mine", {
    p_payload: payload({
      event_id: input.eventId ?? null,
      event_slug: input.eventSlug ?? null,
      status: input.status ?? "all",
      limit: input.limit ?? 100,
    }),
  });
  if (error) throw error;
  return data ?? [];
}
