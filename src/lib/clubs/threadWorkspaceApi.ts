// Discussion Club - dostep do danych PRZESTRZENI ROBOCZEJ WATKU (A28).
//
// Kazda funkcja to jedno wywolanie RPC. Tabele watku (`club_thread_documents`,
// `club_thread_milestones`, `club_thread_questions`, `club_thread_links`) nie
// maja grantow dla klienta - cala autoryzacja siedzi w SECURITY DEFINER wokol
// `club_thread_access`, a nie w tym pliku.
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import type {
  ClubThreadDocumentRow,
  ClubThreadInsightRow,
  ClubThreadLinkRow,
  ClubThreadMilestoneRow,
  ClubThreadParticipantRow,
  ClubThreadPollRow,
  ClubThreadQuestionRow,
  ClubThreadRelation,
  ClubWorkspaceRow,
  ClubWorkspaceSearchRow,
} from "./threadWorkspaceTypes";

/** Patch jedzie do RPC jako jsonb. Przejscie przez JSON ODSIEWA `undefined`
 *  (czyli "nie ruszaj pola") i zostawia `null` (czyli "wyczysc"). */
function toJsonPayload(input: object): Json {
  const parsed: unknown = JSON.parse(JSON.stringify(input));
  return parsed as Json;
}

function unwrap<T>(data: T[] | null, error: { message: string } | null): T[] {
  if (error !== null) throw new Error(error.message);
  return data ?? [];
}

// ---------------------------------------------------------------------------
// Zrodla watku
// ---------------------------------------------------------------------------

export interface ClubDocumentInput {
  id?: string;
  thread_id: string;
  kind: string;
  title: string;
  url: string | null;
  description: string | null;
  source_label: string | null;
  published_on: string | null;
  is_primary?: boolean;
  sort_order?: number;
}

export async function fetchClubThreadDocuments(params: {
  threadId: string;
  kind?: string | null;
  limit?: number;
}): Promise<ClubThreadDocumentRow[]> {
  const { data, error } = await supabase.rpc("club_thread_documents_list", {
    p_thread_id: params.threadId,
    p_kind: params.kind ?? undefined,
    p_limit: params.limit ?? 100,
  });
  return unwrap<ClubThreadDocumentRow>(data as ClubThreadDocumentRow[] | null, error);
}

export async function upsertClubThreadDocument(input: ClubDocumentInput): Promise<string> {
  const { data, error } = await supabase.rpc("club_thread_document_upsert", {
    p_payload: toJsonPayload(input),
  });
  if (error !== null) throw new Error(error.message);
  return data as string;
}

export async function removeClubThreadDocument(documentId: string): Promise<void> {
  const { error } = await supabase.rpc("club_thread_document_remove", {
    p_document_id: documentId,
  });
  if (error !== null) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// Harmonogram watku
// ---------------------------------------------------------------------------

export interface ClubMilestoneInput {
  id?: string;
  thread_id: string;
  kind: string;
  status: string;
  title: string;
  description: string | null;
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
  location: string | null;
  url: string | null;
  owner_id?: string | null;
  event_id?: string | null;
  sort_order?: number;
}

export async function fetchClubThreadMilestones(params: {
  threadId: string;
  from?: string | null;
  to?: string | null;
  limit?: number;
}): Promise<ClubThreadMilestoneRow[]> {
  const { data, error } = await supabase.rpc("club_thread_milestones_list", {
    p_thread_id: params.threadId,
    p_from: params.from ?? undefined,
    p_to: params.to ?? undefined,
    p_limit: params.limit ?? 200,
  });
  return unwrap<ClubThreadMilestoneRow>(data as ClubThreadMilestoneRow[] | null, error);
}

export async function upsertClubThreadMilestone(input: ClubMilestoneInput): Promise<string> {
  const { data, error } = await supabase.rpc("club_thread_milestone_upsert", {
    p_payload: toJsonPayload(input),
  });
  if (error !== null) throw new Error(error.message);
  return data as string;
}

export async function removeClubThreadMilestone(milestoneId: string): Promise<void> {
  const { error } = await supabase.rpc("club_thread_milestone_remove", {
    p_milestone_id: milestoneId,
  });
  if (error !== null) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// Pytania do prowadzenia
// ---------------------------------------------------------------------------

export async function fetchClubThreadQuestions(params: {
  threadId: string;
  status?: string | null;
  sort?: string;
  limit?: number;
}): Promise<ClubThreadQuestionRow[]> {
  const { data, error } = await supabase.rpc("club_thread_questions_list", {
    p_thread_id: params.threadId,
    p_status: params.status ?? undefined,
    p_sort: params.sort ?? "top",
    p_limit: params.limit ?? 100,
  });
  return unwrap<ClubThreadQuestionRow>(data as ClubThreadQuestionRow[] | null, error);
}

export async function askClubThreadQuestion(input: {
  threadId: string;
  body: string;
  anonymous: boolean;
}): Promise<string> {
  const { data, error } = await supabase.rpc("club_thread_question_ask", {
    p_thread_id: input.threadId,
    p_body: input.body,
    p_anonymous: input.anonymous,
  });
  if (error !== null) throw new Error(error.message);
  return data as string;
}

export async function answerClubThreadQuestion(input: {
  questionId: string;
  body: string;
  status?: string;
}): Promise<void> {
  const { error } = await supabase.rpc("club_thread_question_answer", {
    p_question_id: input.questionId,
    p_body: input.body,
    p_status: input.status ?? undefined,
  });
  if (error !== null) throw new Error(error.message);
}

/** Zwraca licznik po zmianie - widok nie musi zgadywac wyniku przelacznika. */
export async function voteClubThreadQuestion(input: {
  questionId: string;
  on: boolean;
}): Promise<number> {
  const { data, error } = await supabase.rpc("club_thread_question_vote", {
    p_question_id: input.questionId,
    p_on: input.on,
  });
  if (error !== null) throw new Error(error.message);
  return typeof data === "number" ? data : 0;
}

// ---------------------------------------------------------------------------
// Glosowania
// ---------------------------------------------------------------------------

export async function fetchClubThreadPolls(threadId: string): Promise<ClubThreadPollRow[]> {
  const { data, error } = await supabase.rpc("club_thread_polls_list", {
    p_thread_id: threadId,
  });
  return unwrap<ClubThreadPollRow>(data as ClubThreadPollRow[] | null, error);
}

/** Ankieta i krawedz powstaja w JEDNEJ transakcji - rozdzielenie zostawialoby
 *  przy bledzie ankiete-sierote bez wlasciciela. */
export async function createClubThreadPoll(input: {
  threadId: string;
  questionPl: string;
  questionEn: string;
  options: string[];
  label?: string | null;
  endsAt?: string | null;
}): Promise<string> {
  const { data, error } = await supabase.rpc("club_thread_poll_create", {
    p_thread_id: input.threadId,
    p_question_pl: input.questionPl,
    p_question_en: input.questionEn,
    p_options: toJsonPayload(input.options),
    p_label: input.label ?? undefined,
    p_ends_at: input.endsAt ?? undefined,
  });
  if (error !== null) throw new Error(error.message);
  return data as string;
}

export async function detachClubThreadPoll(linkId: string): Promise<void> {
  const { error } = await supabase.rpc("club_thread_poll_detach", { p_link_id: linkId });
  if (error !== null) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// Powiazania watek -> watek
// ---------------------------------------------------------------------------

export async function fetchClubThreadLinks(threadId: string): Promise<ClubThreadLinkRow[]> {
  const { data, error } = await supabase.rpc("club_thread_links_list", {
    p_thread_id: threadId,
  });
  return unwrap<ClubThreadLinkRow>(data as ClubThreadLinkRow[] | null, error);
}

export async function addClubThreadLink(input: {
  threadId: string;
  relatedThreadId: string;
  relation: ClubThreadRelation;
  note?: string | null;
}): Promise<string> {
  const { data, error } = await supabase.rpc("club_thread_link_add", {
    p_thread_id: input.threadId,
    p_related_thread_id: input.relatedThreadId,
    p_relation: input.relation,
    p_note: input.note ?? undefined,
  });
  if (error !== null) throw new Error(error.message);
  return data as string;
}

export async function removeClubThreadLink(linkId: string): Promise<void> {
  const { error } = await supabase.rpc("club_thread_link_remove", { p_link_id: linkId });
  if (error !== null) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// Sklad, pomiar, szukanie, przekroj
// ---------------------------------------------------------------------------

export async function fetchClubThreadParticipants(params: {
  threadId: string;
  limit?: number;
}): Promise<ClubThreadParticipantRow[]> {
  const { data, error } = await supabase.rpc("club_thread_participants", {
    p_thread_id: params.threadId,
    p_limit: params.limit ?? 100,
  });
  return unwrap<ClubThreadParticipantRow>(data as ClubThreadParticipantRow[] | null, error);
}

export async function fetchClubThreadInsights(params: {
  threadId: string;
  buckets?: number;
}): Promise<ClubThreadInsightRow[]> {
  const { data, error } = await supabase.rpc("club_thread_insights", {
    p_thread_id: params.threadId,
    p_buckets: params.buckets ?? 24,
  });
  return unwrap<ClubThreadInsightRow>(data as ClubThreadInsightRow[] | null, error);
}

export async function searchClubThread(params: {
  threadId: string;
  query: string;
  limit?: number;
}): Promise<ClubWorkspaceSearchRow[]> {
  const { data, error } = await supabase.rpc("club_thread_search", {
    p_thread_id: params.threadId,
    p_query: params.query,
    p_limit: params.limit ?? 30,
  });
  return unwrap<ClubWorkspaceSearchRow>(data as ClubWorkspaceSearchRow[] | null, error);
}

/** Brak wiersza to nie blad: znaczy "watek jest poza zasiegiem tej osoby".
 *  Warstwa typow zamienia to na przekroj z zamknietymi uprawnieniami. */
export async function fetchClubThreadWorkspace(threadId: string): Promise<ClubWorkspaceRow | null> {
  const { data, error } = await supabase.rpc("club_thread_workspace", {
    p_thread_id: threadId,
  });
  if (error !== null) throw new Error(error.message);
  const rows = (data ?? []) as ClubWorkspaceRow[];
  return rows.length > 0 ? rows[0] : null;
}
