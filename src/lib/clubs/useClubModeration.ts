// Kluby - hooki MODERACJI, KOORDYNACJI W PANELU I WYSZUKIWANIA.
//
// Wydzielone z `useClubs.ts` - patrz naglowek `useClubCatalog.ts`. Tu zyja
// operacje NIEODWRACALNE (ukrycie, usuniecie, blokada czlonka, ujawnienie
// autora anonimowego wpisu), wiec zestawy uniewaznianych kluczy sa szersze
// niz gdzie indziej: ingerencja moderatorska zmienia jednoczesnie liste
// tematow, dziennik i widok watku.
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import {
  adminCreateClubReply,
  adminCreateClubThread,
  banClubMember,
  bulkModerateClubTargets,
  bulkSetClubMemberRole,
  fetchAdminClubReplies,
  fetchAdminClubThreads,
  fetchClubModerationLog,
  fetchClubModerationQueue,
  fetchClubPendingCounts,
  fetchClubThreadsForAnchor,
  fetchClubAnchorSuggestions,
  markClubRead,
  reportClubContent,
  searchClubThreads,
  moderateClubTarget,
  moveClubThread,
  revealClubAuthor,
  type AdminRepliesPage,
  type AdminThreadsPage,
  type AdminClubModerationPage,
} from "./api";
import { CLUB_SEMANTIC_MIN_CHARS, embedClubQuery } from "./clubSemantic.functions";
import { clubKeys } from "./queryKeys";
import {
  clubModerationKeys,
  clubOnlyKeys,
  clubReadKeys,
  invalidateKeys,
} from "./clubInvalidations";
import type {
  AdminClubModerationLogRow,
  ClubAnchorHit,
  ClubAnchorSuggestion,
  ClubAnchorType,
  ClubReportReason,
  ClubSearchResult,
  ClubModerationAction,
  ClubMemberRole,
  ClubReactionTarget,
  ClubThreadKind,
} from "./types";

// ---------------------------------------------------------------------------
// Etap A7: koordynacja w panelu
// ---------------------------------------------------------------------------

export interface AdminThreadFilters {
  groupId?: string | null;
  status?: string | null;
  kind?: string | null;
  search?: string;
  offset?: number;
}

export function useAdminClubThreads(
  clubId: string | undefined,
  filters: AdminThreadFilters,
): UseQueryResult<AdminThreadsPage, Error> {
  const { groupId = null, status = null, kind = null, search = "", offset = 0 } = filters;
  return useQuery({
    queryKey: clubKeys.adminThreads(clubId ?? "", groupId, status, kind, search, offset),
    queryFn: () =>
      fetchAdminClubThreads({ clubId: clubId ?? "", groupId, status, kind, search, offset }),
    staleTime: 15_000,
    enabled: Boolean(clubId),
  });
}

export function useAdminClubReplies(
  threadId: string | undefined,
): UseQueryResult<AdminRepliesPage, Error> {
  return useQuery({
    queryKey: clubKeys.adminReplies(threadId ?? ""),
    queryFn: () => fetchAdminClubReplies({ threadId: threadId ?? "" }),
    staleTime: 10_000,
    enabled: Boolean(threadId),
  });
}

/**
 * Wyszukiwanie watkow: pelnotekstowe ORAZ semantyczne, scalone w jedna liste.
 *
 * `enabled` pilnuje progu dwoch znakow - bez tego kazde nacisniecie klawisza
 * w polu wyszukiwania to round-trip po calej bazie.
 *
 * WEKTOR JEST OSOBNYM ZAPYTANIEM, celowo. Gdyby embedding liczyl sie w tej
 * samej funkcji, co szukanie, kazda literka doplacalaby wywolanie bramki AI
 * do wyniku, ktory i tak jest w cache React Query. Osobny klucz znaczy tez, ze
 * awaria bramki nie uniewaznia wynikow pelnotekstowych.
 */
function useClubQueryEmbedding(query: string, enabled: boolean): number[] | null {
  const result = useQuery({
    queryKey: [...clubKeys.all, "queryEmbedding", query] as const,
    queryFn: () => embedClubQuery({ data: { q: query } }),
    // Wektor frazy nie starzeje sie razem z trescia - ta sama fraza daje ten sam
    // wektor, dopoki nie zmieni sie model. Godzina to kompromis miedzy tym
    // a rozmiarem cache.
    staleTime: 60 * 60_000,
    gcTime: 60 * 60_000,
    retry: false,
    enabled: enabled && query.length >= CLUB_SEMANTIC_MIN_CHARS,
  });
  return result.data?.embedding ?? null;
}

export function useClubSearch(params: {
  query: string;
  clubId?: string | null;
  limit?: number;
  enabled?: boolean;
}): UseQueryResult<ClubSearchResult[], Error> {
  const { query, clubId = null, limit = 20, enabled = true } = params;
  const trimmed = query.trim();
  const embedding = useClubQueryEmbedding(trimmed, enabled);
  return useQuery({
    // Wektor jest CZESCIA klucza: wynik z semantyka i bez niej to dwie rozne
    // listy, a doliczenie wektora po fakcie nie moze cicho podmienic tej,
    // ktora czytelnik ma juz na ekranie pod tym samym kluczem.
    queryKey: [...clubKeys.search(trimmed, clubId), embedding === null ? "fts" : "hybrid"] as const,
    queryFn: () => searchClubThreads({ query: trimmed, clubId, limit, embedding }),
    staleTime: 30_000,
    enabled: enabled && trimmed.length >= 2,
  });
}

/** Watki przypiete do kotwicy - uzywane przez strony spoza modulu klubow. */
export function useClubThreadsForAnchor(params: {
  anchorType: string | undefined;
  anchorId: string | undefined;
  limit?: number;
}): UseQueryResult<ClubAnchorHit[], Error> {
  const { anchorType, anchorId, limit = 5 } = params;
  return useQuery({
    queryKey: clubKeys.anchor(anchorType ?? "", anchorId ?? ""),
    queryFn: () =>
      fetchClubThreadsForAnchor({ anchorType: anchorType ?? "", anchorId: anchorId ?? "", limit }),
    staleTime: 60_000,
    enabled: Boolean(anchorType) && Boolean(anchorId),
  });
}

/**
 * Licznik do plakietki w nawigacji. `enabled` jest po stronie wolajacego:
 * pasek widzi tylko admin, a dla reszty RPC i tak zwrocilo by zera - ale
 * round-trip po nie jest niepotrzebny.
 */
export function useClubPendingCounts(
  enabled = true,
): UseQueryResult<{ moderationPending: number; joinRequests: number }, Error> {
  return useQuery({
    queryKey: clubKeys.pendingCounts(),
    queryFn: fetchClubPendingCounts,
    staleTime: 60_000,
    enabled,
  });
}

export function useClubModerationQueue(
  clubId: string | undefined,
): UseQueryResult<AdminClubModerationPage, Error> {
  return useQuery({
    queryKey: clubKeys.moderationQueue(clubId ?? ""),
    queryFn: () => fetchClubModerationQueue({ clubId: clubId ?? "" }),
    staleTime: 10_000,
    enabled: Boolean(clubId),
  });
}

export function useClubModerationLog(
  clubId: string | undefined,
): UseQueryResult<AdminClubModerationLogRow[], Error> {
  return useQuery({
    queryKey: clubKeys.moderationLog(clubId ?? ""),
    queryFn: () => fetchClubModerationLog({ clubId: clubId ?? "" }),
    staleTime: 30_000,
    enabled: Boolean(clubId),
  });
}

export interface ModerateVars {
  targetType: "thread" | "reply";
  targetId: string;
  action: ClubModerationAction;
  reason?: string | null;
}

/**
 * Akcja moderacyjna. Uniewaznia korzen klubu, bo kazda z nich zmienia
 * jednoczesnie liste tematow, kolejke, log i liczniki - punktowa inwalidacja
 * zostawialaby ktorys z tych widokow nieaktualny.
 */
export function useModerateClubTarget(
  clubId: string,
): UseMutationResult<boolean, Error, ModerateVars> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: moderateClubTarget,
    onSuccess: () => invalidateKeys(qc, clubModerationKeys(clubId)),
  });
}

/**
 * Akcja masowa robi to samo, co jednostkowa - tylko na wielu wpisach naraz -
 * więc musi unieważniać DOKŁADNIE ten sam zakres. Wcześniej czyściła sam korzeń
 * klubu, a odpowiedzi, podgląd panelu, stanowiska, wyniki wyszukiwania
 * i licznik plakietki wiszą pod `clubKeys.all`, nie pod klubem: moderator
 * ukrywał trzydzieści wpisów i dalej widział je w otwartej kolejce.
 */
export function useBulkModerateClub(
  clubId: string,
): UseMutationResult<number, Error, Omit<ModerateVars, "targetId"> & { targetIds: string[] }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: bulkModerateClubTargets,
    onSuccess: () => invalidateKeys(qc, clubModerationKeys(clubId)),
  });
}

export function useBulkSetClubMemberRole(
  clubId: string,
): UseMutationResult<number, Error, { userIds: string[]; role: ClubMemberRole }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars) => bulkSetClubMemberRole({ clubId, ...vars }),
    onSuccess: () => invalidateKeys(qc, clubOnlyKeys(clubId)),
  });
}

export function useAdminCreateThread(clubId: string): UseMutationResult<
  { threadId: string; threadSlug: string },
  Error,
  {
    groupId: string;
    title: string;
    body: string;
    authorId?: string | null;
    kind?: ClubThreadKind;
    pinned?: boolean;
    topic?: string | null;
  }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: adminCreateClubThread,
    onSuccess: () => invalidateKeys(qc, clubOnlyKeys(clubId)),
  });
}

export function useAdminCreateReply(
  clubId: string,
): UseMutationResult<
  string,
  Error,
  { threadId: string; body: string; authorId?: string | null; parentId?: string | null }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: adminCreateClubReply,
    onSuccess: () => invalidateKeys(qc, clubModerationKeys(clubId)),
  });
}

export function useMoveClubThread(
  clubId: string,
): UseMutationResult<boolean, Error, { threadId: string; groupId: string }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: moveClubThread,
    onSuccess: () => invalidateKeys(qc, clubOnlyKeys(clubId)),
  });
}

export function useBanClubMember(
  clubId: string,
): UseMutationResult<boolean, Error, { userId: string; banned: boolean; reason?: string | null }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars) => banClubMember({ clubId, ...vars }),
    onSuccess: () => invalidateKeys(qc, clubOnlyKeys(clubId)),
  });
}

// ---------------------------------------------------------------------------
// Etap A18: zgloszenia, kotwice, nieprzeczytane
// ---------------------------------------------------------------------------

/**
 * Zgloszenie wpisu do moderacji. Bez inwalidacji czegokolwiek: dla zglaszajacego
 * NIC sie nie zmienia (i nie powinno - zgloszenie nie jest publiczna akcja),
 * a kolejka moderatora ma wlasny licznik odswiezany szyna zdarzen.
 */
export function useReportClubContent(): UseMutationResult<
  string | null,
  Error,
  {
    targetType: ClubReactionTarget;
    targetId: string;
    reason: ClubReportReason;
    details?: string | null;
  }
> {
  return useMutation({ mutationFn: reportClubContent });
}

/**
 * Podpowiedzi kotwicy w kompozytorze. Prog dwoch znakow siedzi w api (zwraca
 * pusta liste), tutaj powtarzamy go w `enabled`, zeby nie bylo round-tripu po
 * odpowiedz, ktora znamy z gory.
 */
export function useClubAnchorSuggestions(params: {
  query: string;
  anchorType?: ClubAnchorType | null;
  enabled?: boolean;
}): UseQueryResult<ClubAnchorSuggestion[], Error> {
  const { query, anchorType = null, enabled = true } = params;
  const trimmed = query.trim();
  return useQuery({
    queryKey: clubKeys.anchorSuggest(trimmed, anchorType),
    queryFn: () => fetchClubAnchorSuggestions({ query: trimmed, anchorType }),
    staleTime: 60_000,
    enabled: enabled && trimmed.length >= 2,
  });
}

/**
 * Oznaczenie klubu jako przeczytanego. Uniewaznia liczniki plakietek, a nie
 * dane klubu: tresc sie nie zmienila, zmienil sie stan CZYTANIA.
 */
export function useMarkClubRead(): UseMutationResult<number, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: markClubRead,
    onSuccess: () => invalidateKeys(qc, clubReadKeys()),
  });
}

/**
 * Ujawnienie autora. NIE jest to useQuery: to operacja audytowana, ktora musi
 * dziac sie na jawne zadanie, a nie przy wejsciu na ekran. Zapytanie
 * uruchamialoby ja przy kazdym renderze.
 */
export function useRevealClubAuthor(): UseMutationResult<
  { authorId: string; displayName: string; profileSlug: string | null } | null,
  Error,
  { targetType: "thread" | "reply"; targetId: string; reason: string }
> {
  return useMutation({ mutationFn: revealClubAuthor });
}
