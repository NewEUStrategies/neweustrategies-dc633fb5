// Wpisy klubowe (A31) - hooki React Query.
//
// KURSOR JEST ZNACZNIKIEM CZASU, nie offsetem: ściana rośnie od góry, więc
// paginacja po offsecie duplikowałaby wpisy przy każdej nowej publikacji.
//
// PO MUTACJI UNIEWAŻNIAMY KORZEŃ KLUBU, nie samą listę wpisów. Wpis podpięty
// do wątku pokazuje się RÓWNIEŻ w tym wątku, a licznik trybu "Wpisy" stoi na
// belce nad strumieniem - punktowa inwalidacja zostawiłaby jedno z tych
// miejsc ze starym stanem.
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type UseInfiniteQueryResult,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { clubKeys } from "./queryKeys";
import { invalidateKeys, postCommentKeys } from "./clubInvalidations";
import { CLUB_POST_COMMENT_PAGE_SIZE, type ClubPostCommentRow } from "./postTypes";
import {
  createClubPost,
  createClubPostComment,
  deleteClubPost,
  deleteClubPostComment,
  fetchClubPostComments,
  fetchClubPosts,
  signClubMediaUrls,
  toggleClubPostLike,
  type ClubPostCommentOutcome,
  type ClubPostCommentsCursor,
  type ClubPostCommentsPage,
  type ClubPostLikeResult,
  type ClubPostsPage,
  type CreateClubPostCommentInput,
  type CreateClubPostInput,
} from "./postsApi";

const PAGE_SIZE = 20;

export function useClubPosts(params: {
  clubId: string | undefined;
  groupId?: string | null;
  threadId?: string | null;
  enabled?: boolean;
}): UseInfiniteQueryResult<{ pages: ClubPostsPage[]; pageParams: unknown[] }, Error> {
  const { clubId, groupId = null, threadId = null, enabled = true } = params;
  return useInfiniteQuery({
    queryKey: clubKeys.posts(clubId ?? "none", groupId, threadId),
    enabled: enabled && clubId !== undefined,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      fetchClubPosts({
        clubId: clubId ?? "",
        groupId,
        threadId,
        limit: PAGE_SIZE,
        cursor: pageParam,
      }),
    getNextPageParam: (lastPage) =>
      lastPage.rows.length < PAGE_SIZE
        ? undefined
        : (lastPage.rows[lastPage.rows.length - 1]?.created_at ?? undefined),
    staleTime: 30_000,
  });
}

export function useCreateClubPost(
  clubId: string,
): UseMutationResult<string, Error, Omit<CreateClubPostInput, "clubId">> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input) => createClubPost({ ...input, clubId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: clubKeys.club(clubId) });
    },
  });
}

export function useDeleteClubPost(clubId: string): UseMutationResult<boolean, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (postId) => deleteClubPost(postId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: clubKeys.postsAll(clubId) });
    },
  });
}

/**
 * Polubienie. Nie unieważnia listy - RPC oddaje nowy licznik, a przeładowanie
 * całej ściany po kliknięciu serduszka przewijałoby czytelnikowi ekran.
 */
export function useToggleClubPostLike(): UseMutationResult<ClubPostLikeResult, Error, string> {
  return useMutation({ mutationFn: (postId) => toggleClubPostLike(postId) });
}

/**
 * Podpisane adresy plików widocznych w strumieniu.
 *
 * Klucz zapytania niesie POSORTOWANĄ listę ścieżek, więc doładowanie kolejnej
 * strony wpisów jest nowym zapytaniem, a nie unieważnieniem poprzedniego -
 * adresy już pokazanych zdjęć zostają w cache i obrazy nie mrugają.
 */
export function useClubMediaUrls(paths: readonly string[]): Record<string, string> {
  const key = [...paths].sort().join("|");
  const query: UseQueryResult<Record<string, string>, Error> = useQuery({
    queryKey: clubKeys.media(key),
    enabled: paths.length > 0,
    queryFn: () => signClubMediaUrls(paths),
    // Adres żyje godzinę; odświeżamy z zapasem, żeby nie wygasł na ekranie.
    staleTime: 45 * 60_000,
    gcTime: 60 * 60_000,
  });

  // Adresy KUMULUJĄ się między stronami: bez tego doładowanie strony drugiej
  // (inny klucz) zwróciłoby mapę bez ścieżek ze strony pierwszej i obrazy
  // już widoczne zniknęłyby na czas nowego podpisu.
  const [merged, setMerged] = useState<Record<string, string>>({});
  const data = query.data;
  useEffect(() => {
    if (data === undefined) return;
    setMerged((previous) => ({ ...previous, ...data }));
  }, [data]);

  return merged;
}

// ---------------------------------------------------------------------------
// Komentarze wpisów - czytane i pisane wprost z karty strumienia
//
// RPC oddaje strony NAJNOWSZE PIERWSZE (karta pokazuje świeże, „wcześniejsze"
// doczytuje w głąb), a czyta się OD GÓRY: najstarszy nad najnowszym, jak
// w każdej rozmowie. Odwrócenie robi ten hook, raz - komponent dostaje listę
// gotową do renderu i nie musi wiedzieć, w jakiej kolejności szła sieć.
//
// Reguła unieważniania mieszka w `clubInvalidations.ts` (`postCommentKeys`),
// nie inline: ten plik jest poza bramką modułów hooków, ale nowa reguła nie ma
// powodu jej omijać.
// ---------------------------------------------------------------------------

export interface ClubPostCommentsState {
  /** Wczytane komentarze w kolejności CHRONOLOGICZNEJ (najnowszy na dole). */
  comments: ClubPostCommentRow[];
  /** Wszystkie komentarze widoczne dla czytelnika (z serwera, bez kursora). */
  total: number;
  /** Ile komentarzy czeka jeszcze nad listą - do „Wczytaj wcześniejsze (N)". */
  olderCount: number;
  hasOlder: boolean;
  /** Doczytuje starszą stronę; drugie kliknięcie w trakcie nie wysyła żądania. */
  loadOlder: () => void;
  /** Pierwsza strona w drodze (zapytanie WŁĄCZONE i bez danych). */
  isLoading: boolean;
  isLoadingOlder: boolean;
  isError: boolean;
  error: Error | null;
  /** Surowy wynik - dla rzadkich potrzeb (np. `refetch`) bez rozszerzania tego kształtu. */
  query: UseInfiniteQueryResult<InfiniteData<ClubPostCommentsPage>, Error>;
}

/**
 * Komentarze jednego wpisu.
 *
 * `enabled` należy do wołającego: karta pyta dopiero po rozwinięciu sekcji
 * (albo gdy licznik mówi, że jest co pokazać) - strumień dwudziestu wpisów nie
 * może oznaczać dwudziestu zapytań przy wejściu na stronę klubu.
 */
export function useClubPostComments(params: {
  clubId: string | undefined;
  postId: string | undefined;
  enabled?: boolean;
  pageSize?: number;
}): ClubPostCommentsState {
  const { clubId, postId, enabled = true, pageSize = CLUB_POST_COMMENT_PAGE_SIZE } = params;
  const active = enabled && Boolean(clubId) && Boolean(postId);
  const query = useInfiniteQuery({
    queryKey: clubKeys.postCommentsPage(clubId ?? "none", postId ?? "none", pageSize),
    enabled: active,
    initialPageParam: null as ClubPostCommentsCursor | null,
    queryFn: ({ pageParam }) =>
      fetchClubPostComments({ postId: postId ?? "", limit: pageSize, before: pageParam }),
    getNextPageParam: (lastPage, allPages): ClubPostCommentsCursor | undefined => {
      // Niepełna strona = koniec. Pełna strona przy komplecie wczytanych też
      // = koniec: bez tego warunku wpis z DOKŁADNIE trzema komentarzami
      // pokazywałby „Wczytaj wcześniejsze", które oddaje pustą stronę.
      if (lastPage.rows.length < pageSize) return undefined;
      const loaded = allPages.reduce((sum, page) => sum + page.rows.length, 0);
      if (loaded >= lastPage.total) return undefined;
      const oldest = lastPage.rows[lastPage.rows.length - 1];
      return oldest === undefined ? undefined : { createdAt: oldest.created_at, id: oldest.id };
    },
    staleTime: 10_000,
  });

  const pages = query.data?.pages;
  const comments = useMemo(() => {
    if (pages === undefined) return [];
    // Odświeżenie stron po nowym komentarzu przelicza kursory od nowa, więc
    // granica stron może się przesunąć - deduplikacja po `id` chroni przed
    // podwójnym wierszem w tej jednej klatce.
    const seen = new Set<string>();
    const newestFirst: ClubPostCommentRow[] = [];
    for (const page of pages) {
      for (const row of page.rows) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        newestFirst.push(row);
      }
    }
    return newestFirst.reverse();
  }, [pages]);

  const total = Math.max(pages?.[0]?.total ?? 0, comments.length);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;
  const loadOlder = useCallback(() => {
    if (!hasNextPage || isFetchingNextPage) return;
    void fetchNextPage();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  return {
    comments,
    total,
    olderCount: hasNextPage ? Math.max(0, total - comments.length) : 0,
    hasOlder: hasNextPage,
    loadOlder,
    isLoading: active && query.isLoading,
    isLoadingOlder: isFetchingNextPage,
    isError: query.isError,
    error: query.error,
    query,
  };
}

export type CreateClubPostCommentVars = CreateClubPostCommentInput;

/**
 * Nowy komentarz. Po sukcesie unieważnia ścianę klubu (`postCommentKeys`):
 * to jedno wywołanie odświeża licznik komentarzy w karcie ORAZ listę
 * komentarzy, bo ta wisi pod prefiksem ściany.
 *
 * Instancja PER KARTA: wspólna instancja w hubie dzieliłaby `isPending`
 * i `variables` między wszystkie karty naraz.
 */
export function useCreateClubPostComment(
  clubId: string,
): UseMutationResult<ClubPostCommentOutcome, Error, CreateClubPostCommentVars> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input) => createClubPostComment(input),
    onSuccess: (_outcome, vars) => invalidateKeys(qc, postCommentKeys(clubId, vars.postId)),
  });
}

export interface DeleteClubPostCommentVars {
  postId: string;
  commentId: string;
}

/** Usunięcie komentarza (autor albo moderator). Ten sam skutek, co dodanie. */
export function useDeleteClubPostComment(
  clubId: string,
): UseMutationResult<boolean, Error, DeleteClubPostCommentVars> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ commentId }) => deleteClubPostComment(commentId),
    onSuccess: (_deleted, vars) => invalidateKeys(qc, postCommentKeys(clubId, vars.postId)),
  });
}
