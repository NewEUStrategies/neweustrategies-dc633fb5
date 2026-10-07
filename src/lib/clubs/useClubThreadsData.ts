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
  type InfiniteData,
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
  feedReplyKeys,
  invalidateKeys,
  replyEditedKeys,
  threadEditedKeys,
  threadReplyKeys,
  threadResolvedKeys,
} from "./clubInvalidations";
import {
  isClubReplyLive,
  type ClubReplySort,
  type ClubThreadKind,
  type ClubThreadSort,
  type ClubAttributionMode,
  type ClubThreadStatus,
  type ClubThreadViewRow,
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

// ---------------------------------------------------------------------------
// Odpowiedzi w wątku Z KARTY STRUMIENIA - podgląd najnowszych i odpowiedź
// bez przechodzenia na stronę wątku.
// ---------------------------------------------------------------------------

/** Górna granica `p_limit` w `club_replies_list` - większe okno RPC i tak przytnie. */
const REPLY_WINDOW_MAX = 500;

/**
 * Ile DODATKOWYCH żądań wolno wykonać, cofając się po żywe odpowiedzi. Okna
 * rosną (4×, 16×, 64× limitu, potem po 500), więc cztery kroki sięgają ~670
 * odpowiedzi wstecz - dalej podgląd poddaje się z tym, co znalazł, a link
 * „Zobacz całą dyskusję" i tak prowadzi do pełnej listy.
 */
const REPLY_LOOKBACK_STEPS = 4;

/**
 * Ostatnie `limit` odpowiedzi w kolejności czytania.
 *
 * `club_replies_list` zna wyłącznie sort ROSNĄCY i offset, więc „najnowsze
 * dwie" to `offset = całość - 2`. Całość bierzemy z listy wątków
 * (`reply_count`) jako PODPOWIEDŹ, a nie jako prawdę: licznik listy liczy
 * odpowiedzi widoczne dla wszystkich i bywa nieświeży (nasza własna odpowiedź
 * z karty nie przeładowuje listy - patrz `feedReplyKeys`), a RPC oddaje
 * czytelnikowi także jego odpowiedzi w premoderacji. Dlatego po pierwszej
 * stronie sprawdzamy `total` z RPC i - gdy podpowiedź chybiła - pytamy drugi
 * raz o właściwy offset. W zwykłym przypadku to jedno żądanie.
 *
 * MODERATOR DOSTAJE TEŻ UKRYTE I USUNIĘTE (i `total` je liczy), więc ostatnie
 * `limit` wierszy może nie mieć ani jednej żywej odpowiedzi - podgląd mówiłby
 * „nikt nie odpowiedział" pod wątkiem z odpowiedziami. Filtrujemy więc PRZED
 * przycięciem i cofamy się coraz szerszym oknem, aż zbierzemy `limit` żywych
 * albo dojdziemy do początku. Zwykły członek dostaje same żywe wiersze, więc
 * pętla u niego nigdy nie rusza.
 */
async function fetchLatestReplies(
  threadId: string,
  replyCount: number,
  limit: number,
): Promise<ClubRepliesPage> {
  const fetchRange = (offset: number, size: number) =>
    fetchClubReplies({ threadId, sort: "chronological", limit: size, offset });

  const hinted = Math.max(0, Math.floor(replyCount) - limit);
  let start = hinted;
  let page = await fetchRange(start, limit);
  if (page.rows.length === 0 && hinted > 0) {
    // Offset za końcem listy (część odpowiedzi ukryła moderacja): pusta strona
    // nie niesie `total`, więc pytamy od początku, żeby go poznać.
    start = 0;
    page = await fetchRange(start, limit);
    if (page.total > limit) {
      start = page.total - limit;
      page = await fetchRange(start, limit);
    }
  } else {
    const exact = Math.max(0, page.total - limit);
    if (page.rows.length > 0 && exact !== hinted) {
      start = exact;
      page = await fetchRange(start, limit);
    }
  }

  // `start` to offset wierszy, które już mamy; wszystko przed nim jest starsze.
  let live = page.rows.filter((row) => isClubReplyLive(row.status));
  let windowSize = limit * 4;
  for (let step = 0; live.length < limit && start > 0 && step < REPLY_LOOKBACK_STEPS; step += 1) {
    const from = Math.max(0, start - windowSize);
    const chunk = await fetchRange(from, start - from);
    // Nowa odpowiedź między żądaniami przesuwa offsety - okna mogą się
    // zazębić, więc wiersz już zebrany nie wchodzi drugi raz.
    const seen = new Set(live.map((row) => row.id));
    const older = chunk.rows.filter((row) => isClubReplyLive(row.status) && !seen.has(row.id));
    live = [...older, ...live];
    start = from;
    windowSize = Math.min(windowSize * 4, REPLY_WINDOW_MAX);
  }

  // Sort chronologiczny wynosi rozstrzygnięcie na GÓRĘ listy, więc przy końcu
  // listy porządek bywa nie po czasie - podgląd czyta się po czasie.
  const rows = live.sort((a, b) => a.created_at.localeCompare(b.created_at)).slice(-limit);
  return { rows, total: page.total };
}

/**
 * Podgląd najnowszych odpowiedzi w karcie wątku (domyślnie dwóch).
 *
 * `total` w wyniku pochodzi z RPC i liczy także własne odpowiedzi czytelnika
 * w premoderacji - do „Zobacz całą dyskusję (N)". Klucz ma osobny człon
 * i limit (`replyPreview`), więc nie dzieli wpisu cache ze stroną wątku.
 */
export function useClubReplyPreview(params: {
  threadId: string | undefined;
  /** `reply_count` z listy wątków - podpowiedź offsetu, nie warunek poprawności. */
  replyCount: number;
  limit?: number;
  enabled?: boolean;
}): UseQueryResult<ClubRepliesPage, Error> {
  const { threadId, replyCount, limit = 2, enabled = true } = params;
  return useQuery({
    queryKey: clubKeys.replyPreview(threadId ?? "", limit),
    queryFn: () => fetchLatestReplies(threadId ?? "", replyCount, limit),
    staleTime: 10_000,
    enabled: enabled && Boolean(threadId),
  });
}

export interface FeedReplyVars {
  threadId: string;
  /** Slug wątku - adres karty `thread(clubId, slug)` do unieważnienia. */
  threadSlug: string;
  body: string;
}

/**
 * Licznik odpowiedzi na listach wątków +1, BEZ ruszania kolejności.
 *
 * `last_reply_at` zostaje: lista jest sortowana po stronie serwera, a strumień
 * hubu wplata wpisy ściany po `last_reply_at` - zmiana tego pola w miejscu
 * przestawiłaby karty dokładnie tak, jak pełne unieważnienie. Licznik jest
 * jedynym polem, którego zmianę czytelnik widzi i oczekuje.
 */
function bumpReplyCount(
  data: InfiniteData<ClubThreadsPage> | undefined,
  threadId: string,
): InfiniteData<ClubThreadsPage> | undefined {
  if (data === undefined || !Array.isArray(data.pages)) return data;
  let changed = false;
  const pages = data.pages.map((page) => {
    if (!Array.isArray(page?.rows)) return page;
    let pageChanged = false;
    const rows = page.rows.map((row) => {
      if (row.id !== threadId) return row;
      pageChanged = true;
      return { ...row, reply_count: Number(row.reply_count ?? 0) + 1 };
    });
    if (!pageChanged) return page;
    changed = true;
    return { ...page, rows };
  });
  return changed ? { ...data, pages } : data;
}

/**
 * Odpowiedź GŁÓWNA w wątku wysłana z karty strumienia (bez anonimowości -
 * przełącznik i jego warunki zostają na stronie wątku, gdzie widać zasady).
 *
 * Różni się od `useReplyToThread` WYŁĄCZNIE skutkiem: zamiast poddrzewa klubu
 * unieważnia odpowiedzi tego wątku i jego kartę (`feedReplyKeys`), a licznik na
 * liście poprawia w miejscu - i tylko wtedy, gdy odpowiedź jest widoczna od
 * razu (odpowiedź w kolejce premoderacji nie wlicza się do `reply_count`).
 *
 * Instancja PER KARTA, z tego samego powodu co `useCreateClubPostComment`.
 */
export function useReplyFromFeed(
  clubId: string,
): UseMutationResult<ClubReplyOutcome, Error, FeedReplyVars> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ threadId, body }) =>
      replyToClubThread({ threadId, body: body.trim(), parentId: null, anonymous: false }),
    onSuccess: (outcome, vars) => {
      if (!outcome.queued) {
        qc.setQueriesData<InfiniteData<ClubThreadsPage>>(
          { queryKey: clubKeys.threadsAll(clubId) },
          (data) => bumpReplyCount(data, vars.threadId),
        );
      }
      invalidateKeys(qc, feedReplyKeys(clubId, vars.threadSlug, vars.threadId));
    },
  });
}
