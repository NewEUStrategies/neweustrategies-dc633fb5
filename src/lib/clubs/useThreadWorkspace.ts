// Discussion Club - hooki PRZESTRZENI ROBOCZEJ WATKU (A28).
//
// Kazda mutacja uniewaznia CALY prefiks `clubKeys.workspace(threadId)`, a nie
// pojedyncza galaz. Liczniki na belce zakladek (`club_thread_workspace`)
// zmieniaja sie po KAZDYM zapisie w KAZDYM panelu, wiec punktowa inwalidacja
// i tak musialaby trafiac w dwa klucze naraz - a trzeci zostalby kiedys
// pominiety i belka pokazywalaby nieaktualna liczbe.
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
  searchClubThread,
  upsertClubThreadDocument,
  upsertClubThreadMilestone,
  voteClubThreadQuestion,
  type ClubDocumentInput,
  type ClubMilestoneInput,
} from "./threadWorkspaceApi";
import {
  toWorkspaceSummary,
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

function invalidateThread(qc: QueryClient, threadId: string): void {
  void qc.invalidateQueries({ queryKey: clubKeys.workspace(threadId) });
}

/** Watek bez identyfikatora = ekran jeszcze nie wie, co czyta. Zapytanie
 *  czeka zamiast strzelac w RPC z pustym argumentem. */
const enabledFor = (threadId: string | undefined | null): boolean =>
  typeof threadId === "string" && threadId.length > 0;

// ---------------------------------------------------------------------------
// Przekroj
// ---------------------------------------------------------------------------

export function useClubThreadWorkspace(
  threadId: string | undefined,
): UseQueryResult<ClubWorkspaceSummary, Error> {
  return useQuery({
    queryKey: clubKeys.workspaceSummary(threadId ?? "none"),
    enabled: enabledFor(threadId),
    queryFn: async () => toWorkspaceSummary(await fetchClubThreadWorkspace(threadId ?? "")),
    staleTime: 30_000,
  });
}

// ---------------------------------------------------------------------------
// Zrodla
// ---------------------------------------------------------------------------

export function useClubThreadDocuments(params: {
  threadId: string | undefined;
  kind?: string | null;
  limit?: number;
}): UseQueryResult<ClubThreadDocumentRow[], Error> {
  const kind = params.kind ?? null;
  return useQuery({
    queryKey: clubKeys.documents(params.threadId ?? "none", kind),
    enabled: enabledFor(params.threadId),
    queryFn: () =>
      fetchClubThreadDocuments({ threadId: params.threadId ?? "", kind, limit: params.limit }),
    staleTime: 30_000,
  });
}

export function useUpsertClubThreadDocument(
  threadId: string,
): UseMutationResult<string, Error, ClubDocumentInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: upsertClubThreadDocument,
    onSuccess: () => invalidateThread(qc, threadId),
  });
}

export function useRemoveClubThreadDocument(
  threadId: string,
): UseMutationResult<void, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: removeClubThreadDocument,
    onSuccess: () => invalidateThread(qc, threadId),
  });
}

// ---------------------------------------------------------------------------
// Harmonogram
// ---------------------------------------------------------------------------

export function useClubThreadMilestones(params: {
  threadId: string | undefined;
  from?: string | null;
  to?: string | null;
}): UseQueryResult<ClubThreadMilestoneRow[], Error> {
  const from = params.from ?? null;
  const to = params.to ?? null;
  return useQuery({
    queryKey: clubKeys.milestones(params.threadId ?? "none", from, to),
    enabled: enabledFor(params.threadId),
    queryFn: () => fetchClubThreadMilestones({ threadId: params.threadId ?? "", from, to }),
    staleTime: 30_000,
  });
}

export function useUpsertClubThreadMilestone(
  threadId: string,
): UseMutationResult<string, Error, ClubMilestoneInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: upsertClubThreadMilestone,
    onSuccess: () => invalidateThread(qc, threadId),
  });
}

export function useRemoveClubThreadMilestone(
  threadId: string,
): UseMutationResult<void, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: removeClubThreadMilestone,
    onSuccess: () => invalidateThread(qc, threadId),
  });
}

// ---------------------------------------------------------------------------
// Pytania
// ---------------------------------------------------------------------------

export function useClubThreadQuestions(params: {
  threadId: string | undefined;
  status?: string | null;
  sort?: string;
}): UseQueryResult<ClubThreadQuestionRow[], Error> {
  const status = params.status ?? null;
  const sort = params.sort ?? "top";
  return useQuery({
    queryKey: clubKeys.questions(params.threadId ?? "none", status, sort),
    enabled: enabledFor(params.threadId),
    queryFn: () => fetchClubThreadQuestions({ threadId: params.threadId ?? "", status, sort }),
    staleTime: 15_000,
  });
}

export function useAskClubThreadQuestion(
  threadId: string,
): UseMutationResult<string, Error, { body: string; anonymous: boolean }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { body: string; anonymous: boolean }) =>
      askClubThreadQuestion({ threadId, ...input }),
    onSuccess: () => invalidateThread(qc, threadId),
  });
}

export function useAnswerClubThreadQuestion(
  threadId: string,
): UseMutationResult<void, Error, { questionId: string; body: string; status?: string }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: answerClubThreadQuestion,
    onSuccess: () => invalidateThread(qc, threadId),
  });
}

export function useVoteClubThreadQuestion(
  threadId: string,
): UseMutationResult<number, Error, { questionId: string; on: boolean }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: voteClubThreadQuestion,
    onSuccess: () => invalidateThread(qc, threadId),
  });
}

// ---------------------------------------------------------------------------
// Glosowania
// ---------------------------------------------------------------------------

export function useClubThreadPolls(params: {
  threadId: string | undefined;
}): UseQueryResult<ClubThreadPollRow[], Error> {
  return useQuery({
    queryKey: clubKeys.threadPolls(params.threadId ?? "none"),
    enabled: enabledFor(params.threadId),
    queryFn: () => fetchClubThreadPolls(params.threadId ?? ""),
    staleTime: 15_000,
  });
}

export function useCreateClubThreadPoll(
  threadId: string,
): UseMutationResult<
  string,
  Error,
  { questionPl: string; questionEn: string; options: string[]; label?: string | null }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      questionPl: string;
      questionEn: string;
      options: string[];
      label?: string | null;
    }) => createClubThreadPoll({ threadId, ...input }),
    onSuccess: () => invalidateThread(qc, threadId),
  });
}

export function useDetachClubThreadPoll(threadId: string): UseMutationResult<void, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: detachClubThreadPoll,
    onSuccess: () => invalidateThread(qc, threadId),
  });
}

// ---------------------------------------------------------------------------
// Powiazania
// ---------------------------------------------------------------------------

export function useClubThreadLinks(params: {
  threadId: string | undefined;
}): UseQueryResult<ClubThreadLinkRow[], Error> {
  return useQuery({
    queryKey: clubKeys.threadLinks(params.threadId ?? "none"),
    enabled: enabledFor(params.threadId),
    queryFn: () => fetchClubThreadLinks(params.threadId ?? ""),
    staleTime: 60_000,
  });
}

export function useAddClubThreadLink(
  threadId: string,
): UseMutationResult<
  string,
  Error,
  { relatedThreadId: string; relation: ClubThreadRelation; note?: string | null }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      relatedThreadId: string;
      relation: ClubThreadRelation;
      note?: string | null;
    }) => addClubThreadLink({ threadId, ...input }),
    onSuccess: () => invalidateThread(qc, threadId),
  });
}

export function useRemoveClubThreadLink(threadId: string): UseMutationResult<void, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: removeClubThreadLink,
    onSuccess: () => invalidateThread(qc, threadId),
  });
}

// ---------------------------------------------------------------------------
// Sklad, pomiar, szukanie
// ---------------------------------------------------------------------------

export function useClubThreadParticipants(params: {
  threadId: string | undefined;
  limit?: number;
}): UseQueryResult<ClubThreadParticipantRow[], Error> {
  return useQuery({
    queryKey: clubKeys.participants(params.threadId ?? "none"),
    enabled: enabledFor(params.threadId),
    queryFn: () =>
      fetchClubThreadParticipants({ threadId: params.threadId ?? "", limit: params.limit }),
    staleTime: 60_000,
  });
}

export function useClubThreadInsights(params: {
  threadId: string | undefined;
  buckets?: number;
}): UseQueryResult<ClubThreadInsightRow[], Error> {
  const buckets = params.buckets ?? 24;
  return useQuery({
    queryKey: clubKeys.insights(params.threadId ?? "none", buckets),
    enabled: enabledFor(params.threadId),
    queryFn: () => fetchClubThreadInsights({ threadId: params.threadId ?? "", buckets }),
    staleTime: 60_000,
  });
}

/** Fraza krotsza niz dwa znaki nie idzie do bazy: `websearch_to_tsquery` na
 *  jednej literze zwraca wszystko, czyli nic uzytecznego, a placi za to serwer. */
export function useClubThreadSearch(params: {
  threadId: string | undefined;
  query: string;
}): UseQueryResult<ClubWorkspaceSearchRow[], Error> {
  const query = params.query.trim();
  return useQuery({
    queryKey: clubKeys.workspaceSearch(params.threadId ?? "none", query),
    enabled: enabledFor(params.threadId) && query.length >= 2,
    queryFn: () => searchClubThread({ threadId: params.threadId ?? "", query }),
    staleTime: 30_000,
  });
}
