// Kluby - hooki WATKOW I ODPOWIEDZI.
//
// Wydzielone z `useClubs.ts` - patrz naglowek `useClubCatalog.ts`. Nazwa pliku
// jest `useClubThreadsData`, a nie `useClubThreads`, zeby nie kolidowala
// z hookiem `useClubThreads` przy imporcie po sciezce.
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type UseInfiniteQueryResult,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import {
  createClubThread,
  editClubReply,
  editClubThread,
  fetchClubReplies,
  fetchClubThread,
  fetchClubThreads,
  replyToClubThread,
  resolveClubThread,
  type ClubRepliesPage,
  type ClubReplyOutcome,
  type ClubThreadsPage,
  type CreateThreadResult,
} from "./api";
import { clubKeys } from "./queryKeys";
import {
  CLUB_STALE_MS,
  clubCardKeys,
  invalidateKeys,
  replyEditedKeys,
  threadEditedKeys,
  threadReplyKeys,
  threadResolvedKeys,
} from "./clubInvalidations";
import type {
  ClubReplySort,
  ClubThreadKind,
  ClubThreadSort,
  ClubAttributionMode,
  ClubThreadStatus,
  ClubThreadViewRow,
} from "./types";

// ---------------------------------------------------------------------------
// Etap A3: tematy i odpowiedzi
// ---------------------------------------------------------------------------

/**
 * Lista tematow z paginacja kursorowa. useInfiniteQuery, nie offset: przy
 * ruchliwej liscie offset gubi i duplikuje wiersze miedzy stronami, bo nowy
 * temat na gorze przesuwa wszystko o jeden.
 */
export function useClubThreads(params: {
  clubId: string | undefined;
  groupId?: string | null;
  sort?: ClubThreadSort;
  kind?: ClubThreadKind | null;
  status?: ClubThreadStatus | null;
  anchored?: boolean | null;
  unreadOnly?: boolean;
  /** Obszar tematyczny ze slownika CLUB_TOPICS; null = bez zawezenia. */
  topic?: string | null;
}): UseInfiniteQueryResult<{ pages: ClubThreadsPage[]; pageParams: unknown[] }, Error> {
  const {
    clubId,
    groupId = null,
    sort = "hot",
    kind = null,
    status = null,
    anchored = null,
    unreadOnly = false,
    topic = null,
  } = params;
  return useInfiniteQuery({
    queryKey: clubKeys.threads(
      clubId ?? "",
      groupId,
      sort,
      kind,
      status,
      anchored,
      unreadOnly,
      topic,
    ),
    queryFn: ({ pageParam }) =>
      fetchClubThreads({
        clubId: clubId ?? "",
        groupId,
        sort,
        kind,
        status,
        anchored,
        unreadOnly,
        topic,
        cursor: typeof pageParam === "string" ? pageParam : null,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last: ClubThreadsPage) => last.nextCursor,
    staleTime: CLUB_STALE_MS,
    enabled: Boolean(clubId),
  });
}

export function useClubThread(params: {
  clubId: string | undefined;
  slug: string | undefined;
}): UseQueryResult<ClubThreadViewRow | null, Error> {
  const { clubId, slug } = params;
  return useQuery({
    queryKey: clubKeys.thread(clubId ?? "", slug ?? ""),
    queryFn: () => fetchClubThread({ clubId: clubId ?? "", slug: slug ?? "" }),
    staleTime: CLUB_STALE_MS,
    enabled: Boolean(clubId) && Boolean(slug),
  });
}

/**
 * Odpowiedzi watku. Strona jest kursorem OFFSETOWYM przez `pageSize`, bo widok
 * wątku doczytuje w dol i nigdy nie skacze - a `total` z RPC mowi, czy zostalo
 * cokolwiek do doczytania. Wczesniej hook bral pierwsze 200 wierszy i milczal
 * o reszcie, wiec dluga konsultacja urywala sie bez sladu w interfejsie.
 */
export function useClubReplies(params: {
  threadId: string | undefined;
  sort?: ClubReplySort;
  pageSize?: number;
}): UseQueryResult<ClubRepliesPage, Error> {
  const { threadId, sort = "chronological", pageSize = 200 } = params;
  return useQuery({
    queryKey: clubKeys.replies(threadId ?? "", sort),
    queryFn: () => fetchClubReplies({ threadId: threadId ?? "", sort, limit: pageSize }),
    staleTime: 10_000,
    enabled: Boolean(threadId),
  });
}

export interface CreateThreadVars {
  groupId: string;
  title: string;
  body: string;
  kind?: ClubThreadKind;
  anonymous?: boolean;
  anchorType?: string | null;
  anchorId?: string | null;
  /** Patrz `createClubThread` - klucz per akcja uzytkownika, nie per proba. */
  idempotencyKey?: string;
  /** Zaloz watek od razu zamkniety (uprawnienie moderacyjne). */
  lockReplies?: boolean;
  /** Obszar tematyczny watku ze slownika CLUB_TOPICS; null = bez obszaru. */
  topic?: string | null;
  /** Ikona tematu (nazwa Lucide w kebab-case); null = ikona rodzaju watku. */
  icon?: string | null;
  /** Anonimowosc UCZESTNIKOW watku; null = dziedzicz dzial (i klub). */
  attributionMode?: ClubAttributionMode | null;
}

export function useCreateClubThread(
  clubId: string,
): UseMutationResult<CreateThreadResult, Error, CreateThreadVars> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createClubThread,
    onSuccess: () => invalidateKeys(qc, clubCardKeys(clubId)),
  });
}

export interface ReplyVars {
  threadId: string;
  body: string;
  parentId?: string | null;
  anonymous?: boolean;
}

export function useReplyToThread(
  clubId: string,
  threadSlug: string,
): UseMutationResult<ClubReplyOutcome, Error, ReplyVars> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: replyToClubThread,
    onSuccess: (_outcome, vars) =>
      invalidateKeys(qc, threadReplyKeys(clubId, threadSlug, vars.threadId)),
  });
}

export function useEditClubThread(
  clubId: string,
  threadSlug: string,
): UseMutationResult<
  boolean,
  Error,
  { threadId: string; title?: string; body?: string; reason?: string | null }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: editClubThread,
    onSuccess: () => invalidateKeys(qc, threadEditedKeys(clubId, threadSlug)),
  });
}

export function useEditClubReply(
  threadId: string,
): UseMutationResult<boolean, Error, { replyId: string; body: string; reason?: string | null }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: editClubReply,
    onSuccess: () => invalidateKeys(qc, replyEditedKeys(threadId)),
  });
}

export function useResolveClubThread(
  clubId: string,
  threadSlug: string,
): UseMutationResult<boolean, Error, { threadId: string; replyId: string | null }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: resolveClubThread,
    onSuccess: (_ok, vars) =>
      invalidateKeys(qc, threadResolvedKeys(clubId, threadSlug, vars.threadId)),
  });
}
