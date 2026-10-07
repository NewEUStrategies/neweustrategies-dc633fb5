// Wpisy klubowe (A31) - hooki React Query.
//
// KURSOR JEST ZNACZNIKIEM CZASU, nie offsetem: ściana rośnie od góry, więc
// paginacja po offsecie duplikowałaby wpisy przy każdej nowej publikacji.
//
// PO PUBLIKACJI WPISU UNIEWAŻNIAMY KORZEŃ KLUBU, nie samą listę wpisów. Wpis
// podpięty do wątku pokazuje się RÓWNIEŻ w tym wątku, a licznik trybu "Wpisy"
// stoi na belce nad strumieniem - punktowa inwalidacja zostawiłaby jedno
// z tych miejsc ze starym stanem. Komentarze mają własną, węższą regułę
// (sekcja niżej).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
  type UseInfiniteQueryResult,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { clubKeys } from "./queryKeys";
import { invalidateKeys, postCommentKeys } from "./clubInvalidations";
import {
  CLUB_POST_COMMENT_PAGE_SIZE,
  clubCommentCountDelta,
  type ClubPostCommentModerationAction,
  type ClubPostCommentRow,
  type ClubPostCommentStatus,
} from "./postTypes";
import {
  createClubPost,
  createClubPostComment,
  deleteClubPost,
  deleteClubPostComment,
  fetchClubPostComments,
  fetchClubPosts,
  moderateClubPostComment,
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
// powodu jej omijać. Ściany NIE unieważniamy (powód przy `postCommentKeys`) -
// licznik komentarzy w karcie poprawia `bumpWallCommentCount` w miejscu.
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
  /**
   * Błąd PIERWSZEGO wczytania - nie ma czego pokazać. Nieudane doczytanie
   * „wcześniejszych" albo odświeżenie w tle NIE ustawia tej flagi: pokazane
   * komentarze zostają na ekranie (TanStack trzyma dane przy błędzie).
   */
  isError: boolean;
  /** Ostatnie doczytanie „wcześniejszych" się nie powiodło; lista została. */
  olderError: boolean;
  /** Ponawia nieudane doczytanie (`hasOlder` po błędzie zostaje prawdziwe). */
  retryOlder: () => void;
  error: Error | null;
  /** Surowy wynik - dla rzadkich potrzeb (np. `refetch`) bez rozszerzania tego kształtu. */
  query: UseInfiniteQueryResult<InfiniteData<ClubPostCommentsPage>, Error>;
}

/** Najstarszy komentarz, do którego czytelnik już doszedł - w porządku kursora RPC. */
interface CommentsFloor {
  /** Klucz zapytania - granica jednego wpisu nie obowiązuje innego. */
  key: string;
  createdAt: string;
  id: string;
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
  const queryKey = clubKeys.postCommentsPage(clubId ?? "none", postId ?? "none", pageSize);
  const query = useInfiniteQuery({
    queryKey,
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
      // Komplet liczymy z PIERWSZEJ strony - tej samej migawki, z której idzie
      // `olderCount`. Komentarz dopisany po jej pobraniu jest NOWSZY od całego
      // łańcucha kursorów, więc nie czeka „wcześniej"; `total` późniejszej
      // strony wliczałby go i dawał „Wczytaj wcześniejsze (0)" z pustą stroną.
      if (loaded >= (allPages[0]?.total ?? 0)) return undefined;
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
  const { hasNextPage, isFetching, isFetchingNextPage, isFetchNextPageError, fetchNextPage } =
    query;
  const loadOlder = useCallback(() => {
    if (!hasNextPage || isFetchingNextPage) return;
    void fetchNextPage();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  // CZYTELNIK NIE TRACI KOMENTARZA, DO KTÓREGO JUŻ DOSZEDŁ. Odświeżenie listy
  // nieskończonej pobiera TYLE SAMO stron, licząc kursory od nowej pierwszej.
  // Gdy przybył komentarz, każda strona przesuwa się o jeden i najstarszy
  // wczytany wiersz wypada z dołu łańcucha - a nad rozwiniętą do końca listą
  // wraca „Wczytaj wcześniejsze (1)". Granica zapamiętuje najstarszy osiągnięty
  // wiersz; jeśli po odświeżeniu lista kończy się nowszym, doczytujemy stronę.
  // Jedna reguła dla mutacji i realtime.
  //
  // Granica obowiązuje dopiero, gdy czytelnik SAM sięgnął w historię (więcej
  // niż jedna strona). Sama pierwsza strona to okno najnowszych i ma się
  // przesuwać - doczytanie całej strony po każdym nowym komentarzu
  // powiększałoby kartę o trzy wiersze, o które nikt nie prosił. Bez ponowień
  // po błędzie doczytania (pętla przy zerwanej sieci), a gdy komentarz-granica
  // zniknął (usunięty), kolejnej strony nie ma i granica przesuwa się po
  // prostu na nowy najstarszy wiersz.
  const floorRef = useRef<CommentsFloor | null>(null);
  const floorKey = queryKey.join("|");
  const expanded = (pages?.length ?? 0) > 1;
  const oldest = comments[0];
  useEffect(() => {
    if (oldest === undefined || isFetching || isFetchNextPageError) return;
    const floor = floorRef.current;
    const dropped =
      expanded &&
      floor !== null &&
      floor.key === floorKey &&
      (oldest.created_at > floor.createdAt ||
        (oldest.created_at === floor.createdAt && oldest.id > floor.id));
    if (dropped && hasNextPage) {
      void fetchNextPage();
      return;
    }
    floorRef.current = { key: floorKey, createdAt: oldest.created_at, id: oldest.id };
  }, [oldest, expanded, floorKey, isFetching, isFetchNextPageError, hasNextPage, fetchNextPage]);

  return {
    comments,
    total,
    olderCount: hasNextPage ? Math.max(0, total - comments.length) : 0,
    hasOlder: hasNextPage,
    loadOlder,
    isLoading: active && query.isLoading,
    isLoadingOlder: isFetchingNextPage,
    isError: query.isLoadingError,
    olderError: isFetchNextPageError,
    retryOlder: loadOlder,
    error: query.error,
    query,
  };
}

/**
 * Licznik `comment_count` jednego wpisu na listach ściany, W MIEJSCU - ten sam
 * wzorzec, co `bumpReplyCount` dla wątków. Strona bez tego wpisu zostaje TĄ
 * SAMĄ referencją (bez zbędnego renderu), a brak zmiany oddaje te same dane.
 */
function bumpCommentCount(
  data: InfiniteData<ClubPostsPage> | undefined,
  postId: string,
  delta: number,
): InfiniteData<ClubPostsPage> | undefined {
  if (data === undefined || !Array.isArray(data.pages)) return data;
  let changed = false;
  const pages = data.pages.map((page) => {
    if (!Array.isArray(page?.rows)) return page;
    let pageChanged = false;
    const rows = page.rows.map((row) => {
      if (row.id !== postId) return row;
      pageChanged = true;
      return { ...row, comment_count: Math.max(0, Number(row.comment_count ?? 0) + delta) };
    });
    if (!pageChanged) return page;
    changed = true;
    return { ...page, rows };
  });
  return changed ? { ...data, pages } : data;
}

/**
 * Licznik komentarzy wpisu na KAŻDYM wariancie ściany klubu (cała ściana,
 * dział, wątek) - bez przeładowania listy, które mogłoby wypchnąć kartę spod
 * kursora (patrz `postCommentKeys`). Zerowa zmiana nie dotyka cache wcale.
 */
function bumpWallCommentCount(
  qc: QueryClient,
  clubId: string,
  postId: string,
  delta: number,
): void {
  if (delta === 0) return;
  qc.setQueriesData<InfiniteData<ClubPostsPage>>({ queryKey: clubKeys.postsAll(clubId) }, (data) =>
    bumpCommentCount(data, postId, delta),
  );
}

export type CreateClubPostCommentVars = CreateClubPostCommentInput;

/**
 * Nowy komentarz. Po sukcesie odświeża komentarze TEGO wpisu
 * (`postCommentKeys`) i podbija licznik w karcie w miejscu - ale tylko dla
 * komentarza widocznego od razu: kolejka premoderacji nie wlicza się do
 * `comment_count`.
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
    onSuccess: (outcome, vars) => {
      if (!outcome.queued) bumpWallCommentCount(qc, clubId, vars.postId, 1);
      invalidateKeys(qc, postCommentKeys(clubId, vars.postId));
    },
  });
}

export interface DeleteClubPostCommentVars {
  postId: string;
  commentId: string;
  /** Status wiersza PRZED usunięciem - licznik w karcie spada tylko za widoczny. */
  status: ClubPostCommentStatus;
}

/** Usunięcie komentarza (autor albo moderator). Ten sam skutek, co dodanie. */
export function useDeleteClubPostComment(
  clubId: string,
): UseMutationResult<boolean, Error, DeleteClubPostCommentVars> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ commentId }) => deleteClubPostComment(commentId),
    onSuccess: (deleted, vars) => {
      // `false` = komentarza już nie było - licznik zna wtedy sam serwer.
      const delta = deleted ? clubCommentCountDelta(vars.status, "deleted") : 0;
      bumpWallCommentCount(qc, clubId, vars.postId, delta);
      invalidateKeys(qc, postCommentKeys(clubId, vars.postId));
    },
  });
}

export interface ModerateClubPostCommentVars {
  postId: string;
  commentId: string;
  action: ClubPostCommentModerationAction;
  /** Status wiersza PRZED decyzją - z niego wynika zmiana licznika w karcie. */
  status: ClubPostCommentStatus;
}

/**
 * Decyzja moderatora o komentarzu z karty strumienia: zatwierdzenie z kolejki
 * (`can_approve`) albo ukrycie. Odświeża komentarze wpisu; licznik w karcie
 * rośnie, gdy komentarz staje się widoczny, i spada, gdy widoczny zostaje
 * ukryty. Instancja PER KARTA, jak przy dodawaniu.
 */
export function useModerateClubPostComment(
  clubId: string,
): UseMutationResult<boolean, Error, ModerateClubPostCommentVars> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ commentId, action }) => moderateClubPostComment({ commentId, action }),
    onSuccess: (changed, vars) => {
      // `false` = komentarza już nie ma (usunięty w międzyczasie) - bez zmiany licznika.
      const next = vars.action === "approve" ? "visible" : "hidden";
      const delta = changed ? clubCommentCountDelta(vars.status, next) : 0;
      bumpWallCommentCount(qc, clubId, vars.postId, delta);
      invalidateKeys(qc, postCommentKeys(clubId, vars.postId));
    },
  });
}
