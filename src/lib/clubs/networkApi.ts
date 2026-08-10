// Discussion Club - warstwa dostepu do danych modulow SIECIUJACYCH (A32).
//
// Kazda funkcja to jedno wywolanie RPC. Zero zapytan tabelarycznych: tabele
// `club_board_notices`, `club_member_expertise`, `club_expert_pings`
// i `club_member_spotlight` nie maja grantow dla klienta, wiec
// `supabase.from("club_board_notices")` zwrocilby pusty zbior nawet
// prowadzacemu klub. To jest celowe - cala autoryzacja zyje w SECURITY
// DEFINER, a nie w tym pliku.
import { supabase } from "@/integrations/supabase/client";
import {
  parseOutputContributors,
  parseRosterFaces,
  type ClubBoardNoticeRow,
  type ClubEventAttendeeRow,
  type ClubNoticeKind,
  type ClubOutputContributor,
  type ClubOutputRow,
  type ClubRosterSignal,
  type ClubSpotlightRow,
  type ClubThreadExpertRow,
} from "./networkTypes";

// ---------------------------------------------------------------------------
// Ogloszenia "szukam / oferuje"
// ---------------------------------------------------------------------------

export interface ClubBoardPage {
  rows: ClubBoardNoticeRow[];
  total: number;
}

export interface ClubBoardQuery {
  clubId: string;
  kind?: ClubNoticeKind | null;
  topic?: string | null;
  limit?: number;
  offset?: number;
}

export async function fetchClubBoardNotices(params: ClubBoardQuery): Promise<ClubBoardPage> {
  const { data, error } = await supabase.rpc("club_board_notices_list", {
    p_club_id: params.clubId,
    p_kind: params.kind ?? undefined,
    p_topic: params.topic ?? undefined,
    p_limit: params.limit ?? 8,
    p_offset: params.offset ?? 0,
  });
  if (error) throw error;
  const rows = (data ?? []) as ClubBoardNoticeRow[];
  // `total_count` jest oknem liczonym PRZED limitem, wiec pochodzi z wiersza,
  // a nie z dlugosci strony. Pusta strona znaczy zero - i to jest prawda.
  return { rows, total: rows.length > 0 ? Number(rows[0].total_count) : 0 };
}

export interface ClubNoticeCreateInput {
  clubId: string;
  kind: ClubNoticeKind;
  body: string;
  topic?: string | null;
  days?: number;
}

export async function createClubBoardNotice(input: ClubNoticeCreateInput): Promise<string> {
  const { data, error } = await supabase.rpc("club_board_notice_create", {
    p_club_id: input.clubId,
    p_kind: input.kind,
    p_body: input.body,
    p_topic: input.topic ?? undefined,
    p_days: input.days ?? undefined,
  });
  if (error) throw error;
  return data;
}

export async function closeClubBoardNotice(noticeId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("club_board_notice_close", {
    p_notice_id: noticeId,
  });
  if (error) throw error;
  return data === true;
}

// ---------------------------------------------------------------------------
// Kompetencje
// ---------------------------------------------------------------------------

export async function fetchMyClubExpertise(clubId: string): Promise<string[]> {
  const { data, error } = await supabase.rpc("club_expertise_mine", { p_club_id: clubId });
  if (error) throw error;
  return (data ?? []).map((row) => row.topic);
}

/** Zapis ZASTEPUJE caly zbior deklaracji - patrz `club_expertise_set`. */
export async function setMyClubExpertise(
  clubId: string,
  topics: readonly string[],
): Promise<number> {
  const { data, error } = await supabase.rpc("club_expertise_set", {
    p_club_id: clubId,
    p_topics: [...topics],
  });
  if (error) throw error;
  return data ?? 0;
}

export async function fetchClubThreadExperts(
  threadId: string,
  limit = 6,
): Promise<ClubThreadExpertRow[]> {
  const { data, error } = await supabase.rpc("club_thread_experts", {
    p_thread_id: threadId,
    p_limit: limit,
  });
  if (error) throw error;
  return (data ?? []) as ClubThreadExpertRow[];
}

/**
 * `false` znaczy "prosba juz poszla wczesniej", a nie "nie udalo sie". RPC
 * deduplikuje po trojce (watek, adresat, pytajacy) i to jest poprawny wynik,
 * ktory interfejs ma pokazac jako stan, a nie jako blad.
 */
export async function pingClubThreadExpert(threadId: string, userId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("club_thread_expert_ping", {
    p_thread_id: threadId,
    p_user_id: userId,
  });
  if (error) throw error;
  return data === true;
}

// ---------------------------------------------------------------------------
// Kto bedzie na spotkaniu
// ---------------------------------------------------------------------------

export async function fetchClubEventAttendees(
  eventId: string,
  limit = 12,
): Promise<ClubEventAttendeeRow[]> {
  const { data, error } = await supabase.rpc("club_event_attendees", {
    p_event_id: eventId,
    p_limit: limit,
  });
  if (error) throw error;
  return (data ?? []) as ClubEventAttendeeRow[];
}

// ---------------------------------------------------------------------------
// Sklad z sygnalem obecnosci
// ---------------------------------------------------------------------------

/**
 * `null` znaczy "nie ma czego pokazac" - RPC oddaje ZERO wierszy wolajacemu
 * bez `can_read`. Ta sama doktryna, co przy `club_workspace_stats`: brak
 * wiersza to 404, nie 403.
 */
export async function fetchClubRosterSignal(
  clubId: string,
  limit = 12,
): Promise<ClubRosterSignal | null> {
  const { data, error } = await supabase.rpc("club_roster_signal", {
    p_club_id: clubId,
    p_limit: limit,
  });
  if (error) throw error;
  const row = (data ?? [])[0];
  if (row === undefined) return null;
  return {
    membersTotal: row.members_total,
    new7d: row.new_7d,
    active24h: row.active_24h,
    active7d: row.active_7d,
    peopleSeries: Array.isArray(row.people_series) ? row.people_series : [],
    faces: parseRosterFaces(row.faces),
  };
}

// ---------------------------------------------------------------------------
// Poznaj czlonka
// ---------------------------------------------------------------------------

export async function fetchClubSpotlight(clubId: string): Promise<ClubSpotlightRow | null> {
  const { data, error } = await supabase.rpc("club_member_spotlight_current", {
    p_club_id: clubId,
  });
  if (error) throw error;
  const rows = (data ?? []) as ClubSpotlightRow[];
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Dorobek jako wynik wspolnych rozmow
// ---------------------------------------------------------------------------

/** Produkt razem z rozmowa, z ktorej wyrosl, i jej uczestnikami. */
export interface ClubOutputEntry {
  row: ClubOutputRow;
  contributors: ClubOutputContributor[];
}

export interface ClubOutputPage {
  entries: ClubOutputEntry[];
  total: number;
}

export async function fetchClubOutput(clubId: string, limit = 4): Promise<ClubOutputPage> {
  const { data, error } = await supabase.rpc("club_output_list", {
    p_club_id: clubId,
    p_limit: limit,
  });
  if (error) throw error;
  const rows = (data ?? []) as ClubOutputRow[];
  return {
    entries: rows.map((row) => ({ row, contributors: parseOutputContributors(row.contributors) })),
    total: rows.length > 0 ? Number(rows[0].total_count) : 0,
  };
}
