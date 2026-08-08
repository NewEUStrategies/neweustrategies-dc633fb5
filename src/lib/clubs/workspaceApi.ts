// Przestrzen robocza watku (A28) - warstwa dostepu do danych.
//
// Jedna funkcja = jedno wywolanie RPC, zero zapytan tabelarycznych. Tabele
// A28 nie maja grantow dla klienta (RLS deny-all), wiec
// `supabase.from("club_thread_documents")` zwraca pusty zbior nawet adminowi -
// i tak ma byc: cala autoryzacja zyje w SECURITY DEFINER, po jednej stronie.
import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";
import type {
  ClubDocumentKind,
  ClubMilestoneKind,
  ClubMilestoneStatus,
  ClubQuestionSort,
  ClubQuestionStatus,
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
} from "./workspaceTypes";

/**
 * Argumenty RPC z DEFAULT NULL: generator opisuje je jako `string | undefined`,
 * chociaz w SQL `NULL` jest poprawna i ZNACZACA wartoscia ("wszystkie
 * rodzaje", "caly harmonogram"). Pominiecie klucza daje serwerowy DEFAULT,
 * wiec `undefined` nie jest zamiennikiem dla `null` - stad to jedno waskie
 * przejscie typow zamiast rzutowania w miejscu wywolania. Ta sama konstrukcja,
 * co `RpcArgs` w `api.ts`.
 */
type RpcArgs<K extends keyof Database["public"]["Functions"]> =
  Database["public"]["Functions"][K]["Args"];

/**
 * Wejscia mutacji ida do RPC jako jsonb. Przejscie przez JSON odsiewa
 * `undefined` - a wlasnie BRAK klucza znaczy w kontrakcie A28 "nie ruszaj
 * tego pola". Gdyby `undefined` przetrwalo, kazdy zapis czesciowy kasowalby
 * pola, ktorych formularz nie mial na ekranie.
 */
function toJsonPayload(input: object): Json {
  const parsed: unknown = JSON.parse(JSON.stringify(input));
  return parsed as Json;
}

// ---------------------------------------------------------------------------
// Odczyt
// ---------------------------------------------------------------------------

/** Spis tresci przestrzeni. `null` = brak prawa odczytu watku (albo watek
 *  nie istnieje) - RPC nie rozroznia tych przypadkow celowo. */
export async function fetchClubThreadWorkspace(threadId: string): Promise<ClubWorkspaceRow | null> {
  const { data, error } = await supabase.rpc("club_thread_workspace", {
    p_thread_id: threadId,
  });
  if (error) throw error;
  return data?.[0] ?? null;
}

export async function fetchClubThreadParticipants(params: {
  threadId: string;
  limit?: number;
}): Promise<ClubThreadParticipantRow[]> {
  const { data, error } = await supabase.rpc("club_thread_participants", {
    p_thread_id: params.threadId,
    p_limit: params.limit ?? 50,
  });
  if (error) throw error;
  return data ?? [];
}

export async function fetchClubThreadDocuments(params: {
  threadId: string;
  kind?: ClubDocumentKind | null;
  limit?: number;
}): Promise<ClubThreadDocumentRow[]> {
  const args: RpcArgs<"club_thread_documents_list"> = {
    p_thread_id: params.threadId,
    p_kind: params.kind ?? undefined,
    p_limit: params.limit ?? 100,
  };
  const { data, error } = await supabase.rpc("club_thread_documents_list", args);
  if (error) throw error;
  return data ?? [];
}

/**
 * Harmonogram. Bez zakresu zwraca CALOSC (widok listy); z zakresem - wycinek
 * pod siatke miesiaca. Jedno RPC dla obu prezentacji, bo to jeden zbior
 * danych - dwa RPC rozjechalyby sie przy pierwszej zmianie projekcji.
 */
export async function fetchClubThreadMilestones(params: {
  threadId: string;
  from?: string | null;
  to?: string | null;
  limit?: number;
}): Promise<ClubThreadMilestoneRow[]> {
  const args: RpcArgs<"club_thread_milestones_list"> = {
    p_thread_id: params.threadId,
    p_from: params.from ?? undefined,
    p_to: params.to ?? undefined,
    p_limit: params.limit ?? 200,
  };
  const { data, error } = await supabase.rpc("club_thread_milestones_list", args);
  if (error) throw error;
  return data ?? [];
}

export async function fetchClubThreadQuestions(params: {
  threadId: string;
  status?: ClubQuestionStatus | null;
  sort?: ClubQuestionSort;
  limit?: number;
}): Promise<ClubThreadQuestionRow[]> {
  const args: RpcArgs<"club_thread_questions_list"> = {
    p_thread_id: params.threadId,
    p_status: params.status ?? undefined,
    p_sort: params.sort ?? "top",
    p_limit: params.limit ?? 100,
  };
  const { data, error } = await supabase.rpc("club_thread_questions_list", args);
  if (error) throw error;
  return data ?? [];
}

export async function fetchClubThreadLinks(threadId: string): Promise<ClubThreadLinkRow[]> {
  const { data, error } = await supabase.rpc("club_thread_links_list", {
    p_thread_id: threadId,
  });
  if (error) throw error;
  return data ?? [];
}

export async function fetchClubThreadPolls(threadId: string): Promise<ClubThreadPollRow[]> {
  const { data, error } = await supabase.rpc("club_thread_polls_list", {
    p_thread_id: threadId,
  });
  if (error) throw error;
  return data ?? [];
}

/**
 * Wyszukiwanie WEWNATRZ watku. Pusta fraza nie jedzie do bazy: pusty tsquery
 * i tak nie dopasuje niczego, a round-trip po zerowy wynik przy kazdym
 * nacisnieciu klawisza to koszt bez zysku.
 */
export async function searchClubThreadWorkspace(params: {
  threadId: string;
  query: string;
  limit?: number;
}): Promise<ClubWorkspaceSearchRow[]> {
  const query = params.query.trim();
  if (query.length === 0) return [];
  const { data, error } = await supabase.rpc("club_thread_search", {
    p_thread_id: params.threadId,
    p_query: query,
    p_limit: params.limit ?? 30,
  });
  if (error) throw error;
  return data ?? [];
}

export async function fetchClubThreadInsights(params: {
  threadId: string;
  buckets?: number;
}): Promise<ClubThreadInsightRow[]> {
  const { data, error } = await supabase.rpc("club_thread_insights", {
    p_thread_id: params.threadId,
    p_buckets: params.buckets ?? 24,
  });
  if (error) throw error;
  return data ?? [];
}

// ---------------------------------------------------------------------------
// Zapis
// ---------------------------------------------------------------------------

/**
 * Patch zrodla. Pole NIEOBECNE = "nie ruszaj", pole ustawione na `null` =
 * "wyczysc" - dlatego typy opcjonalnych tekstow to `string | null`, a nie
 * `string | undefined`. Ta sama umowa, co w `ClubUpsertInput`.
 */
export interface ClubDocumentInput {
  id?: string;
  thread_id?: string;
  kind?: ClubDocumentKind;
  title?: string;
  description?: string | null;
  url?: string | null;
  source_label?: string | null;
  published_on?: string | null;
  mime_type?: string | null;
  byte_size?: number | null;
  is_primary?: boolean;
  sort_order?: number;
  status?: "visible" | "hidden";
}

export async function upsertClubThreadDocument(input: ClubDocumentInput): Promise<string> {
  const { data, error } = await supabase.rpc("club_thread_document_upsert", {
    p_payload: toJsonPayload(input),
  });
  if (error) throw error;
  return data ?? "";
}

export async function removeClubThreadDocument(documentId: string): Promise<void> {
  const { error } = await supabase.rpc("club_thread_document_remove", {
    p_document_id: documentId,
  });
  if (error) throw error;
}

export interface ClubMilestoneInput {
  id?: string;
  thread_id?: string;
  title?: string;
  description?: string | null;
  kind?: ClubMilestoneKind;
  status?: ClubMilestoneStatus;
  starts_at?: string;
  ends_at?: string | null;
  all_day?: boolean;
  location?: string | null;
  url?: string | null;
  owner_id?: string | null;
  event_id?: string | null;
  sort_order?: number;
}

export async function upsertClubThreadMilestone(input: ClubMilestoneInput): Promise<string> {
  const { data, error } = await supabase.rpc("club_thread_milestone_upsert", {
    p_payload: toJsonPayload(input),
  });
  if (error) throw error;
  return data ?? "";
}

export async function removeClubThreadMilestone(milestoneId: string): Promise<void> {
  const { error } = await supabase.rpc("club_thread_milestone_remove", {
    p_milestone_id: milestoneId,
  });
  if (error) throw error;
}

export async function askClubThreadQuestion(params: {
  threadId: string;
  body: string;
  anonymous?: boolean;
}): Promise<string> {
  const { data, error } = await supabase.rpc("club_thread_question_ask", {
    p_thread_id: params.threadId,
    p_body: params.body,
    p_anonymous: params.anonymous ?? false,
  });
  if (error) throw error;
  return data ?? "";
}

export async function answerClubThreadQuestion(params: {
  questionId: string;
  body: string;
  status?: ClubQuestionStatus;
}): Promise<void> {
  const { error } = await supabase.rpc("club_thread_question_answer", {
    p_question_id: params.questionId,
    p_body: params.body,
    p_status: params.status ?? "answered",
  });
  if (error) throw error;
}

/** Zwraca licznik PO zapisie - klient nie zgaduje wyniku wyscigu dwoch glosow. */
export async function voteClubThreadQuestion(params: {
  questionId: string;
  on: boolean;
}): Promise<number> {
  const { data, error } = await supabase.rpc("club_thread_question_vote", {
    p_question_id: params.questionId,
    p_on: params.on,
  });
  if (error) throw error;
  return Number(data ?? 0);
}

export async function addClubThreadLink(params: {
  threadId: string;
  relatedThreadId: string;
  relation?: ClubThreadRelation;
  note?: string | null;
}): Promise<string> {
  const args: RpcArgs<"club_thread_link_add"> = {
    p_thread_id: params.threadId,
    p_related_thread_id: params.relatedThreadId,
    p_relation: params.relation ?? "context",
    p_note: params.note ?? undefined,
  };
  const { data, error } = await supabase.rpc("club_thread_link_add", args);
  if (error) throw error;
  return data ?? "";
}

export async function removeClubThreadLink(linkId: string): Promise<void> {
  const { error } = await supabase.rpc("club_thread_link_remove", { p_link_id: linkId });
  if (error) throw error;
}

export async function createClubThreadPoll(params: {
  threadId: string;
  questionPl: string;
  questionEn: string;
  options: Json;
  endsAt?: string | null;
  label?: string | null;
}): Promise<string> {
  const args: RpcArgs<"club_thread_poll_create"> = {
    p_thread_id: params.threadId,
    p_question_pl: params.questionPl,
    p_question_en: params.questionEn,
    p_options: params.options,
    p_ends_at: params.endsAt ?? undefined,
    p_label: params.label ?? undefined,
  };
  const { data, error } = await supabase.rpc("club_thread_poll_create", args);
  if (error) throw error;
  return data ?? "";
}

export async function detachClubThreadPoll(linkId: string): Promise<void> {
  const { error } = await supabase.rpc("club_thread_poll_detach", { p_link_id: linkId });
  if (error) throw error;
}
