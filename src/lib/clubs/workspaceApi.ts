// Discussion Club - warstwa dostepu do danych przestrzeni roboczej (A28).
//
// Kazda funkcja to jedno wywolanie RPC. Zero zapytan tabelarycznych: tabele
// `club_documents`, `club_events`, `club_event_rsvps` i `club_milestones` nie
// maja grantow dla klienta, wiec `supabase.from("club_documents")` zwrocilby
// pusty zbior nawet dla kuratora. To jest celowe - cala autoryzacja zyje
// w SECURITY DEFINER, a nie w tym pliku.
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import type {
  ClubActivityPoint,
  ClubDocumentRow,
  ClubDocumentUpsertInput,
  ClubEventRow,
  ClubEventUpsertInput,
  ClubMilestoneRow,
  ClubMilestoneUpsertInput,
  ClubRsvpState,
  ClubWorkspaceStatsRow,
} from "./workspaceTypes";

/**
 * Wejscia mutacji ida do RPC jako jsonb. Konwersja przez JSON zamiast przez
 * `as unknown as Json`: obiekt patcha ma wylacznie pola serializowalne, wiec
 * przejscie jest poprawne typowo i - co wazniejsze - ODSIEWA `undefined`,
 * a wlasnie brak klucza znaczy w tym kontrakcie "nie ruszaj pola".
 *
 * `null` przezywa te droge nietkniety, bo `null` znaczy "wyczysc" i to jest
 * inna odpowiedz niz pominiecie.
 */
function toJsonPayload(input: object): Json {
  const parsed: unknown = JSON.parse(JSON.stringify(input));
  return parsed as Json;
}

// ---------------------------------------------------------------------------
// Biblioteka dokumentow
// ---------------------------------------------------------------------------

export interface ClubDocumentsPage {
  rows: ClubDocumentRow[];
  total: number;
}

export interface ClubDocumentsQuery {
  clubId: string;
  groupId?: string | null;
  kind?: string | null;
  search?: string | null;
  limit?: number;
  offset?: number;
}

export async function fetchClubDocuments(params: ClubDocumentsQuery): Promise<ClubDocumentsPage> {
  const { data, error } = await supabase.rpc("club_documents_list", {
    p_club_id: params.clubId,
    p_group_id: params.groupId ?? undefined,
    p_kind: params.kind ?? undefined,
    p_search: params.search ?? undefined,
    p_limit: params.limit ?? 50,
    p_offset: params.offset ?? 0,
  });
  if (error) throw error;
  const rows = (data ?? []) as ClubDocumentRow[];
  // `total_count` jest oknem liczonym PRZED limitem, wiec pochodzi z wiersza,
  // a nie z dlugosci strony. Pusta strona znaczy zero - i to jest prawda.
  return { rows, total: rows.length > 0 ? Number(rows[0].total_count) : 0 };
}

export async function upsertClubDocument(
  clubId: string,
  input: ClubDocumentUpsertInput,
): Promise<string> {
  const { data, error } = await supabase.rpc("club_document_upsert", {
    p_club_id: clubId,
    p_payload: toJsonPayload(input),
  });
  if (error) throw error;
  return data;
}

export async function deleteClubDocument(documentId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("club_document_delete", {
    p_document_id: documentId,
  });
  if (error) throw error;
  return data === true;
}

/**
 * Licznik pobran. Swiadomie NIE rzuca: nieudany licznik nie ma prawa przerwac
 * otwierania pliku, ktory uzytkownik wlasnie kliknal. RPC z tego samego powodu
 * zwraca `false` zamiast wyjatku, gdy bramka nie przepuszcza.
 */
export async function registerClubDocumentDownload(documentId: string): Promise<void> {
  await supabase.rpc("club_document_register_download", { p_document_id: documentId });
}

// ---------------------------------------------------------------------------
// Kalendarz
// ---------------------------------------------------------------------------

export interface ClubEventsQuery {
  clubId: string;
  /** ISO 8601. Zakres domyka sie po `ends_at`, wiec wydarzenie trwajace przez
   *  granice okna nie znika z widoku miesiaca. */
  from?: string | null;
  to?: string | null;
  kind?: string | null;
  limit?: number;
}

export async function fetchClubEvents(params: ClubEventsQuery): Promise<ClubEventRow[]> {
  const { data, error } = await supabase.rpc("club_events_list", {
    p_club_id: params.clubId,
    p_from: params.from ?? undefined,
    p_to: params.to ?? undefined,
    p_kind: params.kind ?? undefined,
    p_limit: params.limit ?? 200,
  });
  if (error) throw error;
  return (data ?? []) as ClubEventRow[];
}

export async function upsertClubEvent(
  clubId: string,
  input: ClubEventUpsertInput,
): Promise<string> {
  const { data, error } = await supabase.rpc("club_event_upsert", {
    p_club_id: clubId,
    p_payload: toJsonPayload(input),
  });
  if (error) throw error;
  return data;
}

export async function deleteClubEvent(eventId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("club_event_delete", { p_event_id: eventId });
  if (error) throw error;
  return data === true;
}

export async function setClubEventRsvp(eventId: string, state: ClubRsvpState): Promise<boolean> {
  const { data, error } = await supabase.rpc("club_event_rsvp", {
    p_event_id: eventId,
    p_state: state,
  });
  if (error) throw error;
  return data === true;
}

// ---------------------------------------------------------------------------
// Harmonogram prac
// ---------------------------------------------------------------------------

export async function fetchClubMilestones(clubId: string): Promise<ClubMilestoneRow[]> {
  const { data, error } = await supabase.rpc("club_milestones_list", { p_club_id: clubId });
  if (error) throw error;
  return (data ?? []) as ClubMilestoneRow[];
}

export async function upsertClubMilestone(
  clubId: string,
  input: ClubMilestoneUpsertInput,
): Promise<string> {
  const { data, error } = await supabase.rpc("club_milestone_upsert", {
    p_club_id: clubId,
    p_payload: toJsonPayload(input),
  });
  if (error) throw error;
  return data;
}

export async function deleteClubMilestone(milestoneId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("club_milestone_delete", {
    p_milestone_id: milestoneId,
  });
  if (error) throw error;
  return data === true;
}

// ---------------------------------------------------------------------------
// Pomiar
// ---------------------------------------------------------------------------

export async function fetchClubActivitySeries(
  clubId: string,
  days: number,
): Promise<ClubActivityPoint[]> {
  const { data, error } = await supabase.rpc("club_activity_series", {
    p_club_id: clubId,
    p_days: days,
  });
  if (error) throw error;
  return data ?? [];
}

/**
 * `null` znaczy "nie ma czego pokazac" - RPC oddaje ZERO wierszy wolajacemu bez
 * `can_read`. To jest ta sama doktryna, co przy `club_view`: brak wiersza to
 * 404, nie 403, i pomiar tak samo nie ma prawa zdradzic ksztaltu klubu.
 */
export async function fetchClubWorkspaceStats(
  clubId: string,
  days: number,
): Promise<ClubWorkspaceStatsRow | null> {
  const { data, error } = await supabase.rpc("club_workspace_stats", {
    p_club_id: clubId,
    p_days: days,
  });
  if (error) throw error;
  const rows = (data ?? []) as ClubWorkspaceStatsRow[];
  return rows[0] ?? null;
}

// Warstwa WATKU (A28) - patrz `threadWorkspaceApi`.
export * from "./threadWorkspaceApi";
