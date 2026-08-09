// Wpisy klubowe (A31) - hooki React Query.
//
// KURSOR JEST ZNACZNIKIEM CZASU, nie offsetem: ściana rośnie od góry, więc
// paginacja po offsecie duplikowałaby wpisy przy każdej nowej publikacji.
//
// PO MUTACJI UNIEWAŻNIAMY KORZEŃ KLUBU, nie samą listę wpisów. Wpis podpięty
// do wątku pokazuje się RÓWNIEŻ w tym wątku, a licznik trybu "Wpisy" stoi na
// belce nad strumieniem - punktowa inwalidacja zostawiłaby jedno z tych
// miejsc ze starym stanem.
import { useEffect, useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type UseInfiniteQueryResult,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { clubKeys } from "./queryKeys";
import {
  createClubPost,
  deleteClubPost,
  fetchClubPosts,
  signClubMediaUrls,
  toggleClubPostLike,
  type ClubPostLikeResult,
  type ClubPostsPage,
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
