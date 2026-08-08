// Przestrzen robocza watku (A28) - hooki danych.
//
// DWIE REGULY, KTORE TRZYMAJA TEN PLIK:
//
// 1) KAZDA mutacja uniewaznia PREFIKS `clubKeys.workspace(threadId)`, a nie
//    liste kluczy do zapamietania. Powod jest twardy: liczniki na belce
//    zakladek zmieniaja sie po zapisie w KAZDYM panelu, wiec punktowa
//    inwalidacja i tak musialaby trafiac w dwa klucze naraz - a przy trzecim
//    ktos kiedys zapomni. Prefiks nie ma tego trybu awarii.
//
// 2) Panel, ktorego nie widac, NIE POBIERA DANYCH. `enabled` jest wiazane
//    z otwarta zakladka, bo osiem zapytan na wejsciu w watek to osiem
//    round-tripow po dane, ktorych czytelnik w wiekszosci nie otworzy.
//    Wyjatkiem jest `useClubThreadWorkspace` - liczniki musza byc od razu,
//    inaczej belka zakladek rysuje sie dwa razy.
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { clubKeys } from "./queryKeys";
import {
  addClubThreadLink,
  answerClubThreadQuestion,
  askClubThreadQuestion,
  createClubThreadPoll,
  detachClubThreadPoll,
  fetchClubThreadDocuments,
  fetchClubThreadInsights,
  fetchClubThreadLinks,
  fetchClubThreadMilestones,
  fetchClubThreadParticipants,
  fetchClubThreadPolls,
  fetchClubThreadQuestions,
  fetchClubThreadWorkspace,
  removeClubThreadDocument,
  removeClubThreadLink,
  removeClubThreadMilestone,
  searchClubThreadWorkspace,
  upsertClubThreadDocument,
  upsertClubThreadMilestone,
  voteClubThreadQuestion,
  type ClubDocumentInput,
  type ClubMilestoneInput,
} from "./threadWorkspaceApi";
import {
  toWorkspaceSummary,
  type ClubDocumentKind,
  type ClubQuestionSort,
  type ClubQuestionStatus,
  type ClubThreadDocumentRow,
  type ClubThreadInsightRow,
  type ClubThreadLinkRow,
  type ClubThreadMilestoneRow,
  type ClubThreadParticipantRow,
  type ClubThreadPollRow,
  type ClubThreadQuestionRow,
  type ClubThreadRelation,
  type ClubWorkspaceSearchRow,
  type ClubWorkspaceSummary,
} from "./threadWorkspaceTypes";

/** Liczniki i zawartosc paneli zmieniaja sie rzadko wzgledem dyskusji, ale nie
 *  sa statyczne - minuta jest kompromisem miedzy swiezoscia terminu a liczba
 *  zapytan przy przelaczaniu zakladek. */
const STALE_MS = 60_000;

/** Jedna inwalidacja na wszystkie panele - patrz regula 1 w naglowku. */
function invalidateWorkspace(qc: QueryClient, threadId: string): void {
  void qc.invalidateQueries({ queryKey: clubKeys.workspace(threadId) });
}

// ---------------------------------------------------------------------------
// Odczyt
// ---------------------------------------------------------------------------

/**
 * Spis tresci przestrzeni. Zwraca ZNORMALIZOWANY ksztalt (zera i zamkniete
 * uprawnienia zamiast `undefined`), zeby widok nie musial miec galezi
 * "jeszcze nie wiem" w kazdym miejscu, w ktorym czyta licznik.
 */
export function useClubThreadWorkspace(
  threadId: string | undefined,
): UseQueryResult<ClubWorkspaceSummary, Error> {
  return useQuery({
    queryKey: clubKeys.workspaceSummary(threadId ?? ""),
    queryFn: async () => toWorkspaceSummary(await fetchClubThreadWorkspace(threadId ?? "")),
    staleTime: STALE_MS,
    enabled: Boolean(threadId),
  });
}

export function useClubThreadParticipants(params: {
  threadId: string | undefined;
  enabled?: boolean;
  limit?: number;
}): UseQueryResult<ClubThreadParticipantRow[], Error> {
  const { threadId, enabled = true, limit = 50 } = params;
  return useQuery({
    queryKey: clubKeys.threadParticipants(threadId ?? ""),
    queryFn: () => fetchClubThreadParticipants({ threadId: threadId ?? "", limit }),
    staleTime: STALE_MS,
    enabled: Boolean(threadId) && enabled,
  });
}

export function useClubThreadDocuments(params: {
  threadId: string | undefined;
  kind?: ClubDocumentKind | null;
  enabled?: boolean;
}): UseQueryResult<ClubThreadDocumentRow[], Error> {
  const { threadId, kind = null, enabled = true } = params;
  return useQuery({
    queryKey: clubKeys.threadDocuments(threadId ?? "", kind),
    queryFn: () => fetchClubThreadDocuments({ threadId: threadId ?? "", kind }),
    staleTime: STALE_MS,
    enabled: Boolean(threadId) && enabled,
  });
}

/**
 * Harmonogram. `from`/`to` sa opcjonalne: lista bierze calosc, kalendarz -
 * wycinek miesiaca. Zakres wchodzi do klucza, wiec przewijanie miesiecy nie
 * nadpisuje w cache poprzedniej siatki (powrot do wrzesnia jest natychmiastowy).
 */
export function useClubThreadMilestones(params: {
  threadId: string | undefined;
  from?: string | null;
  to?: string | null;
  enabled?: boolean;
}): UseQueryResult<ClubThreadMilestoneRow[], Error> {
  const { threadId, from = null, to = null, enabled = true } = params;
  return useQuery({
    queryKey: clubKeys.threadMilestones(threadId ?? "", from, to),
    queryFn: () => fetchClubThreadMilestones({ threadId: threadId ?? "", from, to }),
    staleTime: STALE_MS,
    enabled: Boolean(threadId) && enabled,
  });
}

export function useClubThreadQuestions(params: {
  threadId: string | undefined;
  status?: ClubQuestionStatus | null;
  sort?: ClubQuestionSort;
  enabled?: boolean;
}): UseQueryResult<ClubThreadQuestionRow[], Error> {
  const { threadId, status = null, sort = "top", enabled = true } = params;
  return useQuery({
    queryKey: clubKeys.threadQuestions(threadId ?? "", status, sort),
    queryFn: () => fetchClubThreadQuestions({ threadId: threadId ?? "", status, sort }),
    staleTime: 20_000,
    enabled: Boolean(threadId) && enabled,
  });
}

export function useClubThreadLinks(params: {
  threadId: string | undefined;
  enabled?: boolean;
}): UseQueryResult<ClubThreadLinkRow[], Error> {
  const { threadId, enabled = true } = params;
  return useQuery({
    queryKey: clubKeys.threadLinks(threadId ?? ""),
    queryFn: () => fetchClubThreadLinks(threadId ?? ""),
    staleTime: STALE_MS,
    enabled: Boolean(threadId) && enabled,
  });
}

export function useClubThreadPolls(params: {
  threadId: string | undefined;
  enabled?: boolean;
}): UseQueryResult<ClubThreadPollRow[], Error> {
  const { threadId, enabled = true } = params;
  return useQuery({
    queryKey: clubKeys.threadPolls(threadId ?? ""),
    queryFn: () => fetchClubThreadPolls(threadId ?? ""),
    staleTime: STALE_MS,
    enabled: Boolean(threadId) && enabled,
  });
}

export function useClubThreadInsights(params: {
  threadId: string | undefined;
  buckets?: number;
  enabled?: boolean;
}): UseQueryResult<ClubThreadInsightRow[], Error> {
  const { threadId, buckets = 24, enabled = true } = params;
  return useQuery({
    queryKey: clubKeys.threadInsights(threadId ?? "", buckets),
    queryFn: () => fetchClubThreadInsights({ threadId: threadId ?? "", buckets }),
    staleTime: STALE_MS,
    enabled: Boolean(threadId) && enabled,
  });
}

/**
 * Szukanie wewnatrz watku. Wolajacy podaje juz ZDLAWIONA fraze (widok trzyma
 * `useDeferredValue`), a hook odcina zapytanie ponizej dwoch znakow: jedna
 * litera pasuje do wszystkiego i kosztuje pelne skanowanie czterech sekcji.
 */
export function useClubThreadSearch(params: {
  threadId: string | undefined;
  query: string;
}): UseQueryResult<ClubWorkspaceSearchRow[], Error> {
  const { threadId, query } = params;
  const trimmed = query.trim();
  return useQuery({
    queryKey: clubKeys.workspaceSearch(threadId ?? "", trimmed),
    queryFn: () => searchClubThreadWorkspace({ threadId: threadId ?? "", query: trimmed }),
    staleTime: 30_000,
    enabled: Boolean(threadId) && trimmed.length >= 2,
  });
}

// ---------------------------------------------------------------------------
// Zapis
// ---------------------------------------------------------------------------

export function useUpsertClubThreadDocument(
  threadId: string,
): UseMutationResult<string, Error, ClubDocumentInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: upsertClubThreadDocument,
    onSuccess: () => invalidateWorkspace(qc, threadId),
  });
}

export function useRemoveClubThreadDocument(
  threadId: string,
): UseMutationResult<void, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: removeClubThreadDocument,
    onSuccess: () => invalidateWorkspace(qc, threadId),
  });
}

export function useUpsertClubThreadMilestone(
  threadId: string,
): UseMutationResult<string, Error, ClubMilestoneInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: upsertClubThreadMilestone,
    onSuccess: () => invalidateWorkspace(qc, threadId),
  });
}

export function useRemoveClubThreadMilestone(
  threadId: string,
): UseMutationResult<void, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: removeClubThreadMilestone,
    onSuccess: () => invalidateWorkspace(qc, threadId),
  });
}

export function useAskClubThreadQuestion(
  threadId: string,
): UseMutationResult<string, Error, { body: string; anonymous?: boolean }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars) => askClubThreadQuestion({ threadId, ...vars }),
    onSuccess: () => invalidateWorkspace(qc, threadId),
  });
}

export function useAnswerClubThreadQuestion(
  threadId: string,
): UseMutationResult<
  void,
  Error,
  { questionId: string; body: string; status?: ClubQuestionStatus }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: answerClubThreadQuestion,
    onSuccess: () => invalidateWorkspace(qc, threadId),
  });
}

/**
 * Glos na waznosc pytania. RPC zwraca licznik PO zapisie, wiec nie zgadujemy
 * wyniku wyscigu dwoch glosow - ale i tak uniewazniamy przestrzen, bo glos
 * zmienia KOLEJNOSC w sorcie "najwazniejsze", a nie tylko liczbe przy jednym
 * wierszu.
 */
export function useVoteClubThreadQuestion(
  threadId: string,
): UseMutationResult<number, Error, { questionId: string; on: boolean }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: voteClubThreadQuestion,
    onSuccess: () => invalidateWorkspace(qc, threadId),
  });
}

export function useAddClubThreadLink(
  threadId: string,
): UseMutationResult<
  string,
  Error,
  { relatedThreadId: string; relation?: ClubThreadRelation; note?: string | null }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars) => addClubThreadLink({ threadId, ...vars }),
    onSuccess: () => invalidateWorkspace(qc, threadId),
  });
}

export function useRemoveClubThreadLink(threadId: string): UseMutationResult<void, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: removeClubThreadLink,
    onSuccess: () => invalidateWorkspace(qc, threadId),
  });
}

export function useCreateClubThreadPoll(
  threadId: string,
): UseMutationResult<
  string,
  Error,
  { questionPl: string; questionEn: string; options: string[]; endsAt?: string | null }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars) =>
      createClubThreadPoll({
        threadId,
        questionPl: vars.questionPl,
        questionEn: vars.questionEn,
        options: vars.options,
        endsAt: vars.endsAt ?? null,
      }),
    onSuccess: () => invalidateWorkspace(qc, threadId),
  });
}

export function useDetachClubThreadPoll(threadId: string): UseMutationResult<void, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: detachClubThreadPoll,
    onSuccess: () => invalidateWorkspace(qc, threadId),
  });
}
