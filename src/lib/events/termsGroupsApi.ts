// Dostep panelu organizatora do GRUP UCZESTNIKOW i ZGOD wydarzenia.
//
// JEDEN PLIK NA OBA KATALOGI. Grupa opisuje uprawnienia (kto kogo widzi, kto
// moze sie spotykac), zgoda opisuje dowod (kto co zaakceptowal i w ktorej
// wersji) - ale oba katalogi wisza na tym samym wydarzeniu, maja te sama
// mechanike klucza, kolejnosci i wylaczenia, i te same RPC-owe konwencje.
//
// TYPY WYPROWADZAMY Z WYGENEROWANYCH `Database`. Listy oddaja kolumny liczone w
// SQL-u (`members_count`, `acceptances_current`, `withdrawn_count`); recznie
// pisany interfejs bylby prawdziwy do najblizszej migracji.
//
// KLUCZE POMINIETE (`undefined`) NIE WCHODZA DO PAYLOADU: SQL czyta
// `p_payload ? 'color'`, wiec brak klucza znaczy „zostaw jak bylo", a jawny
// `null` znaczy „wyczysc". Sklejenie obu odebraloby mozliwosc wyczyszczenia.
//
// WERSJA ZGODY ROSNIE WYLACZNIE NA ZADANIE (`bumpVersion`). Podniesienie
// uniewaznia dotychczasowe akceptacje jako aktualne, wiec nie moze byc efektem
// ubocznym poprawki literowki.
import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";

type Fns = Database["public"]["Functions"];

export type EventGroupRow = Fns["admin_event_groups_list"]["Returns"][number];
export type EventTermRow = Fns["admin_event_terms_list"]["Returns"][number];

/** `event_groups_attendee_visibility` CHECK z migracji, jeden do jednego. */
export const GROUP_VISIBILITIES = ["none", "own_group", "registered", "everyone"] as const;
export type GroupVisibility = (typeof GROUP_VISIBILITIES)[number];

/** `event_terms_display` CHECK z migracji. */
export const TERM_DISPLAYS = ["registration", "access", "registration_and_access"] as const;
export type TermDisplay = (typeof TERM_DISPLAYS)[number];

export const TERMS_GROUPS_KEY_PATTERN = /^[a-z][a-z0-9_]{1,48}$/;

type PayloadInput = Record<string, Json | undefined>;

function payload(input: PayloadInput): Json {
  const out: Record<string, Json> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) out[key] = value;
  }
  return out as Json;
}

function unwrap<T>(data: T | null, error: { message: string } | null): T {
  if (error) throw new Error(error.message);
  return (data ?? []) as T;
}

/* ----------------------------------------------------------------- grupy --- */

export interface GroupInput {
  id?: string;
  eventId?: string;
  key?: string;
  namePl: string;
  nameEn: string;
  descriptionPl?: string;
  descriptionEn?: string;
  /** `null` = brak koloru; `undefined` = nie ruszaj. */
  color?: string | null;
  attendeeVisibility?: GroupVisibility;
  canSeeAttendees?: boolean;
  canMeet?: boolean;
  canChat?: boolean;
  canLeadRetrieval?: boolean;
  canSeeRecording?: boolean;
  minTierRank?: number;
  sortOrder?: number;
  isDefault?: boolean;
}

export async function fetchEventGroups(eventId: string): Promise<EventGroupRow[]> {
  const { data, error } = await supabase.rpc("admin_event_groups_list", {
    p_event_id: eventId,
  });
  return unwrap<EventGroupRow[]>(data, error);
}

export async function saveEventGroup(input: GroupInput): Promise<string> {
  const { data, error } = await supabase.rpc("admin_event_group_upsert", {
    p_payload: payload({
      id: input.id,
      event_id: input.eventId,
      key: input.key,
      name_pl: input.namePl,
      name_en: input.nameEn,
      description_pl: input.descriptionPl,
      description_en: input.descriptionEn,
      color: input.color,
      attendee_visibility: input.attendeeVisibility,
      can_see_attendees: input.canSeeAttendees,
      can_meet: input.canMeet,
      can_chat: input.canChat,
      can_lead_retrieval: input.canLeadRetrieval,
      can_see_recording: input.canSeeRecording,
      min_tier_rank: input.minTierRank,
      sort_order: input.sortOrder,
      is_default: input.isDefault,
    }),
  });
  if (error) throw new Error(error.message);
  return String(data);
}

export async function deleteEventGroup(id: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("admin_event_group_delete", { _id: id });
  if (error) throw new Error(error.message);
  return data === true;
}

export interface GroupMemberInput {
  groupId: string;
  personId: string;
  /** `true` = dodaj do grupy dodatkowej, `false` = odejmij. Idempotentne. */
  isMember: boolean;
}

export async function setEventGroupMember(input: GroupMemberInput): Promise<boolean> {
  const { data, error } = await supabase.rpc("admin_event_group_member_set", {
    p_payload: payload({
      group_id: input.groupId,
      person_id: input.personId,
      is_member: input.isMember,
    }),
  });
  if (error) throw new Error(error.message);
  return data === true;
}

/* ------------------------------------------------------------------ zgody --- */

export interface TermInput {
  id?: string;
  eventId?: string;
  key?: string;
  labelPl: string;
  labelEn: string;
  bodyPl?: string;
  bodyEn?: string;
  /** `null` = zgoda bez odnosnika zewnetrznego. */
  externalUrl?: string | null;
  display?: TermDisplay;
  isRequired?: boolean;
  sortOrder?: number;
  isActive?: boolean;
  /** Wersja rosnie tylko przy `true` - patrz naglowek pliku. */
  bumpVersion?: boolean;
}

export async function fetchEventTerms(eventId: string): Promise<EventTermRow[]> {
  const { data, error } = await supabase.rpc("admin_event_terms_list", {
    p_event_id: eventId,
  });
  return unwrap<EventTermRow[]>(data, error);
}

export async function saveEventTerm(input: TermInput): Promise<string> {
  const { data, error } = await supabase.rpc("admin_event_term_upsert", {
    p_payload: payload({
      id: input.id,
      event_id: input.eventId,
      key: input.key,
      label_pl: input.labelPl,
      label_en: input.labelEn,
      body_pl: input.bodyPl,
      body_en: input.bodyEn,
      external_url: input.externalUrl,
      display: input.display,
      is_required: input.isRequired,
      sort_order: input.sortOrder,
      is_active: input.isActive,
      bump_version: input.bumpVersion,
    }),
  });
  if (error) throw new Error(error.message);
  return String(data);
}

export async function deleteEventTerm(id: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("admin_event_term_delete", { _id: id });
  if (error) throw new Error(error.message);
  return data === true;
}
