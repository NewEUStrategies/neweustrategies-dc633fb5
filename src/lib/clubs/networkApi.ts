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
  parseRosterFaces,
  type ClubBoardNoticeRow,
  type ClubEventAttendeeRow,
  type ClubEventViewRow,
  type ClubExpertiseArea,
  type ClubExpertRow,
  type ClubNoticeKind,
  type ClubRosterSignal,
  type ClubSpotlightHistoryRow,
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
  /** Zawezenie do ogloszen wolajacego - zakladka "moje" na pelnej tablicy. */
  mine?: boolean;
  /** Archiwum: zalatwione, wygasle i (dla moderacji) zdjete. */
  includeClosed?: boolean;
}

export async function fetchClubBoardNotices(params: ClubBoardQuery): Promise<ClubBoardPage> {
  const { data, error } = await supabase.rpc("club_board_notices_list", {
    p_club_id: params.clubId,
    p_kind: params.kind ?? undefined,
    p_topic: params.topic ?? undefined,
    p_limit: params.limit ?? 8,
    p_offset: params.offset ?? 0,
    p_mine: params.mine ?? undefined,
    p_include_closed: params.includeClosed ?? undefined,
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

// --- katalog ekspertow KLUBU (A33) ---
//
// Osobne od `fetchClubThreadExperts`: tam pytanie brzmi "kto zna sie na tym,
// o czym mowa w tym watku" i wychodzi szesc osob, tutaj - "kto tu sie na czym
// zna" i wychodzi lista z paginacja, filtrem obszaru i fraza.

export interface ClubExpertsPage {
  rows: ClubExpertRow[];
  total: number;
}

export interface ClubExpertsQuery {
  clubId: string;
  topic?: string | null;
  search?: string | null;
  limit?: number;
  offset?: number;
}

export async function fetchClubExperts(params: ClubExpertsQuery): Promise<ClubExpertsPage> {
  const { data, error } = await supabase.rpc("club_experts_list", {
    p_club_id: params.clubId,
    p_topic: params.topic ?? undefined,
    // Fraza krotsza niz dwa znaki nie zaweza niczego sensownie, a kosztuje
    // pelne skanowanie ILIKE po trzech kolumnach profilu.
    p_search:
      params.search !== null && params.search !== undefined && params.search.trim().length >= 2
        ? params.search.trim()
        : undefined,
    p_limit: params.limit ?? 24,
    p_offset: params.offset ?? 0,
  });
  if (error) throw error;
  const rows = (data ?? []) as ClubExpertRow[];
  return { rows, total: rows.length > 0 ? Number(rows[0].total_count) : 0 };
}

export async function fetchClubExpertiseAreas(clubId: string): Promise<ClubExpertiseArea[]> {
  const { data, error } = await supabase.rpc("club_expertise_areas", { p_club_id: clubId });
  if (error) throw error;
  return data ?? [];
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

/**
 * Jedno spotkanie po slugu. `null` znaczy "nie ma czego pokazac" - klub
 * nieczytelny i nieistniejacy slug daja ten sam wynik, bo klub `secret` nie
 * ma prawa zdradzic, ze wydarzenie istnieje.
 */
export async function fetchClubEvent(
  clubId: string,
  slug: string,
): Promise<ClubEventViewRow | null> {
  const { data, error } = await supabase.rpc("club_event_view", {
    p_club_id: clubId,
    p_slug: slug,
  });
  if (error) throw error;
  const rows = (data ?? []) as ClubEventViewRow[];
  return rows[0] ?? null;
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
  limit = 24,
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

/**
 * Archiwum przedstawien. Zawiera WYLACZNIE przypiecia redakcyjne - rotacja
 * jest liczona, a nie zapisywana, wiec nie zostawia sladu z definicji.
 */
export async function fetchClubSpotlightHistory(
  clubId: string,
  limit = 12,
): Promise<ClubSpotlightHistoryRow[]> {
  const { data, error } = await supabase.rpc("club_member_spotlight_history", {
    p_club_id: clubId,
    p_limit: limit,
  });
  if (error) throw error;
  return (data ?? []) as ClubSpotlightHistoryRow[];
}

export interface ClubSpotlightPinInput {
  userId: string;
  /** `YYYY-MM-DD`; RPC i tak znormalizuje do poniedzialku tego tygodnia. */
  weekStart?: string | null;
  blurbPl?: string | null;
  blurbEn?: string | null;
}

export async function pinClubSpotlight(
  clubId: string,
  input: ClubSpotlightPinInput,
): Promise<string> {
  const { data, error } = await supabase.rpc("club_member_spotlight_upsert", {
    p_club_id: clubId,
    p_user_id: input.userId,
    p_week_start: input.weekStart ?? undefined,
    p_blurb_pl: input.blurbPl ?? undefined,
    p_blurb_en: input.blurbEn ?? undefined,
  });
  if (error) throw error;
  return data;
}

export async function deleteClubSpotlight(id: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("club_member_spotlight_delete", { p_id: id });
  if (error) throw error;
  return data === true;
}

// Modul "Dorobek klubu" zostal wycofany w A34 razem z RPC `club_output_list` -
// nie ma tu odpowiednika, bo nie ma czego wolac.
