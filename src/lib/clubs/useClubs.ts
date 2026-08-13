// Discussion Club - hooki danych.
//
// Mutacje uniewazniaja korzen klubu (clubKeys.club(id)) zamiast wyliczac liste
// dotknietych kluczy: liczniki (member_count, group_count) sa denormalizowane
// triggerem, wiec po KAZDEJ mutacji zmienia sie takze wiersz na liscie.
// Punktowa inwalidacja pokazywalaby stary licznik obok nowego stanu.
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
  acceptClubRules,
  adminCreateClubReply,
  adminCreateClubThread,
  banClubMember,
  bulkModerateClubTargets,
  bulkSetClubMemberRole,
  createClubInviteLink,
  createClubThread,
  editClubReply,
  editClubThread,
  fetchAdminClub,
  fetchAdminClubGroups,
  fetchAdminClubReplies,
  fetchAdminClubThreads,
  fetchAdminClubStats,
  fetchAdminClubs,
  fetchClubBySlug,
  fetchClubGroups,
  fetchClubList,
  fetchClubInvitations,
  fetchClubInviteLinks,
  checkClubSlugAvailable,
  deleteClubGroup,
  fetchClubModerationLog,
  fetchClubModerationQueue,
  fetchClubPendingCounts,
  fetchClubActivityFeed,
  fetchClubThreadsForAnchor,
  fetchClubMembers,
  fetchClubReactionActors,
  fetchClubReactions,
  fetchClubAnchorSuggestions,
  fetchClubReplies,
  fetchClubStanceSummary,
  fetchClubThread,
  fetchClubThreads,
  fetchMyClubInvitations,
  fetchMyClubMemberships,
  markClubRead,
  reportClubContent,
  searchClubThreads,
  fetchMyThreadSubscription,
  inviteClubMember,
  inviteClubMemberByEmail,
  inviteClubSegment,
  joinClub,
  leaveClub,
  moderateClubTarget,
  moveClubThread,
  reactToClubTarget,
  redeemClubInviteLink,
  revealClubAuthor,
  replyToClubThread,
  resolveClubThread,
  respondClubInvitation,
  revokeClubInviteLink,
  setClubMemberRole,
  setClubNotifyLevel,
  setClubStance,
  setClubThreadSubscription,
  unreactFromClubTarget,
  previewClubCapabilities,
  previewClubSegment,
  removeClubMember,
  reorderClubGroups,
  upsertClub,
  upsertClubGroup,
  upsertClubMember,
  type AdminClubsPage,
  type AdminRepliesPage,
  type AdminThreadsPage,
  type AdminClubModerationPage,
  type ClubListPage,
  type ClubMembersPage,
  type ClubRepliesPage,
  type ClubReplyOutcome,
  type ClubThreadsPage,
  type CreateThreadResult,
} from "./api";
import { pendingCounterKeys } from "@/lib/counters/keys";
import { CLUB_SEMANTIC_MIN_CHARS, embedClubQuery } from "./clubSemantic.functions";
import { adminClubKeys, clubKeys } from "./queryKeys";
import { applyReactionToggle } from "./types";
import type {
  AdminClubDetailRow,
  AdminClubGroupRow,
  AdminClubInvitationRow,
  AdminClubInviteLinkRow,
  AdminClubModerationLogRow,
  ClubActivityRow,
  ClubActivitySort,
  ClubAnchorHit,
  ClubAnchorSuggestion,
  ClubAnchorType,
  ClubReportReason,
  ClubSearchResult,
  ClubSegmentPreview,
  ClubSegmentRule,
  ClubModerationAction,
  AdminClubListFilters,
  AdminClubStatsRow,
  ClubCapabilities,
  ClubGroupRow,
  ClubGroupUpsertInput,
  ClubInviteLinkInput,
  ClubMemberRole,
  ClubMemberStatus,
  ClubMemberUpsertInput,
  ClubMembershipRow,
  ClubMyInvitationRow,
  ClubNotifyLevel,
  ClubReactionKind,
  ClubReactionActor,
  ClubReactionTally,
  ClubReactionTarget,
  ClubReplySort,
  ClubStance,
  ClubStanceSummaryRow,
  ClubSubscriptionState,
  ClubThreadKind,
  ClubThreadSort,
  ClubAttributionMode,
  ClubThreadStatus,
  ClubThreadViewRow,
  ClubUpsertInput,
  ClubViewRow,
} from "./types";

/** Dane klubowe zmieniaja sie w rytmie dyskusji, nie sekund - 30 s wystarcza. */
const STALE_MS = 30_000;

/**
 * Uniewaznienie po mutacji dotykajacej JEDNEGO klubu.
 *
 * Trzy klucze, nie jeden, bo karta klubu (`bySlug`) wisi POZA poddrzewem
 * `club(clubId)` - mutacja pracuje na id, a widok czyta po slugu. Bez tego
 * dolaczenie do klubu zapisywalo sie w bazie, odswiezalo liste i czlonkostwa,
 * a naglowek otwartego klubu dalej pokazywal stary licznik i przycisk
 * "Dolacz" - az do wygasniecia staleTime.
 */
function invalidateClubCard(qc: ReturnType<typeof useQueryClient>, clubId: string): void {
  void qc.invalidateQueries({ queryKey: clubKeys.club(clubId) });
  void qc.invalidateQueries({ queryKey: clubKeys.list() });
  void qc.invalidateQueries({ queryKey: clubKeys.bySlugAll() });
}

// ---------------------------------------------------------------------------
// Odczyt
// ---------------------------------------------------------------------------

export function useClubList(enabled = true, limit = 100): UseQueryResult<ClubListPage, Error> {
  return useQuery({
    // Limit JEST czescia klucza: "pokaz wiecej" zmienia rozmiar strony, a bez
    // tego trafialoby w ten sam wpis cache i katalog zostawalby na setce.
    queryKey: [...clubKeys.list(), limit] as const,
    queryFn: () => fetchClubList({ limit }),
    staleTime: STALE_MS,
    enabled,
  });
}

export function useMyClubMemberships(enabled = true): UseQueryResult<ClubMembershipRow[], Error> {
  return useQuery({
    queryKey: clubKeys.memberships(),
    queryFn: fetchMyClubMemberships,
    staleTime: STALE_MS,
    enabled,
  });
}

/**
 * Strumien aktywnosci na stronie glownej klubow. Krotki staleTime, bo to
 * powierzchnia "co sie dzieje" - lista sprzed piecu minut przeczy jej celowi.
 */
export function useClubActivityFeed(params: {
  sort: ClubActivitySort;
  policyArea: string | null;
  limit?: number;
  enabled?: boolean;
}): UseQueryResult<ClubActivityRow[], Error> {
  const { sort, policyArea, limit, enabled = true } = params;
  return useQuery({
    queryKey: clubKeys.activity(sort, policyArea),
    queryFn: () => fetchClubActivityFeed({ sort, policyArea, limit }),
    staleTime: 30_000,
    enabled,
  });
}

export function useClubBySlug(slug: string | undefined): UseQueryResult<ClubViewRow | null, Error> {
  return useQuery({
    queryKey: clubKeys.bySlug(slug ?? ""),
    queryFn: () => fetchClubBySlug(slug ?? ""),
    staleTime: STALE_MS,
    enabled: Boolean(slug),
  });
}

export function useClubGroups(clubId: string | undefined): UseQueryResult<ClubGroupRow[], Error> {
  return useQuery({
    queryKey: clubKeys.groups(clubId ?? ""),
    queryFn: () => fetchClubGroups(clubId ?? ""),
    staleTime: STALE_MS,
    enabled: Boolean(clubId),
  });
}

export function useClubMembers(params: {
  clubId: string | undefined;
  status?: ClubMemberStatus | null;
  limit?: number;
  offset?: number;
}): UseQueryResult<ClubMembersPage, Error> {
  const { clubId, status = "active", limit = 50, offset = 0 } = params;
  return useQuery({
    // Limit JEST częścią klucza: dwa widoki tej samej listy z różnymi limitami
    // (zakładka członków 50, panel moderacji 100) liczyły ten sam klucz, więc
    // ten, który trafił drugi, dostawał krótszą stronę z cache i milczał o tym.
    queryKey: clubKeys.members(clubId ?? "", status, offset, limit),
    queryFn: () => fetchClubMembers({ clubId: clubId ?? "", status, limit, offset }),
    staleTime: STALE_MS,
    enabled: Boolean(clubId),
  });
}

// USUNIETO `useClubCapabilities`. Hook mial zero konsumentow w calym src:
// kazdy ekran produktowy czyta zdolnosci z kolumn, ktore RPC i tak zwraca
// razem z trescia (`club_view.can_*`, `club_threads_list`, `club_thread_view`),
// bo tam sa policzone dla TEJ SAMEJ pary (klub, grupa), ktorej dotyczy widok.
// Osobne zapytanie o to samo bylo drugim zrodlem tej samej prawdy - i tym
// samym drugim miejscem, w ktorym moglaby sie rozjechac. Zdolnosci w panelu
// czyta `useClubCapabilitiesPreview`, ktore odpowiada na INNE pytanie:
// "co zobaczy wskazana osoba", a nie "co widze ja".

// ---------------------------------------------------------------------------
// Panel administracyjny
// ---------------------------------------------------------------------------

export function useAdminClubs(
  filters: AdminClubListFilters,
  enabled = true,
): UseQueryResult<AdminClubsPage, Error> {
  return useQuery({
    queryKey: adminClubKeys.list(filters),
    queryFn: () => fetchAdminClubs(filters),
    staleTime: 15_000,
    enabled,
  });
}

/** Pelny klub po id dla edytora. */
export function useAdminClub(
  clubId: string | undefined,
): UseQueryResult<AdminClubDetailRow | null, Error> {
  return useQuery({
    queryKey: [...clubKeys.club(clubId ?? ""), "detail"],
    queryFn: () => fetchAdminClub(clubId ?? ""),
    staleTime: 15_000,
    enabled: Boolean(clubId),
  });
}

/** Wszystkie grupy klubu dla panelu (takze draft i archived). */
export function useAdminClubGroups(
  clubId: string | undefined,
): UseQueryResult<AdminClubGroupRow[], Error> {
  return useQuery({
    queryKey: [...clubKeys.groups(clubId ?? ""), "admin"],
    queryFn: () => fetchAdminClubGroups(clubId ?? ""),
    staleTime: 15_000,
    enabled: Boolean(clubId),
  });
}

export function useAdminClubStats(
  clubId: string | undefined,
): UseQueryResult<AdminClubStatsRow | null, Error> {
  return useQuery({
    queryKey: clubKeys.stats(clubId ?? ""),
    queryFn: () => fetchAdminClubStats(clubId ?? ""),
    staleTime: 15_000,
    enabled: Boolean(clubId),
  });
}

export function useClubCapabilitiesPreview(params: {
  clubId: string | undefined;
  userId: string | undefined;
  groupId?: string | null;
}): UseQueryResult<ClubCapabilities, Error> {
  const { clubId, userId, groupId } = params;
  return useQuery({
    queryKey: clubKeys.capabilitiesPreview(clubId ?? "", userId ?? "", groupId),
    queryFn: () => previewClubCapabilities({ clubId: clubId ?? "", userId: userId ?? "", groupId }),
    staleTime: 0, // podglad uprawnien musi byc swiezy - to narzedzie diagnostyczne
    enabled: Boolean(clubId) && Boolean(userId),
  });
}

// ---------------------------------------------------------------------------
// Mutacje
// ---------------------------------------------------------------------------

export function useUpsertClub(): UseMutationResult<string, Error, ClubUpsertInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: upsertClub,
    onSuccess: (clubId) => {
      void qc.invalidateQueries({ queryKey: adminClubKeys.all });
      void qc.invalidateQueries({ queryKey: clubKeys.club(clubId) });
      void qc.invalidateQueries({ queryKey: clubKeys.list() });
    },
  });
}

export function useUpsertClubGroup(
  clubId: string,
): UseMutationResult<string, Error, ClubGroupUpsertInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input) => upsertClubGroup({ ...input, club_id: input.club_id ?? clubId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: clubKeys.club(clubId) });
      void qc.invalidateQueries({ queryKey: adminClubKeys.all });
    },
  });
}

export function useReorderClubGroups(clubId: string): UseMutationResult<number, Error, string[]> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (groupIds) => reorderClubGroups(clubId, groupIds),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: clubKeys.groups(clubId) });
    },
  });
}

/**
 * Dostepnosc adresu, odpytywana na biezaco przy pisaniu. `enabled` odcina
 * zapytanie dla pustego i zbyt krotkiego sluga - inaczej kazde nacisniecie
 * klawisza bylo by osobnym round-tripem po odpowiedz, ktora i tak brzmi "nie".
 */
export function useClubSlugAvailable(
  slug: string,
  clubId?: string | null,
): UseQueryResult<boolean, Error> {
  const trimmed = slug.trim();
  return useQuery({
    queryKey: [...adminClubKeys.all, "slug", trimmed, clubId ?? ""],
    queryFn: () => checkClubSlugAvailable({ slug: trimmed, clubId }),
    staleTime: 30_000,
    enabled: trimmed.length >= 3,
  });
}

export function useUpsertClubMember(
  clubId: string,
): UseMutationResult<string, Error, Omit<ClubMemberUpsertInput, "clubId">> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input) => upsertClubMember({ ...input, clubId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: clubKeys.club(clubId) });
      void qc.invalidateQueries({ queryKey: adminClubKeys.all });
    },
  });
}

export interface SetClubRoleVars {
  userId: string;
  role: ClubMemberRole;
  expiresAt?: string | null;
}

/**
 * Zmiana roli czlonka Z POZIOMU KLUBU (prowadzacy), nie z panelu (administrator).
 * Uniewaznia poddrzewo klubu, bo lista czlonkow i naglowek czytaja te sama role.
 */
export function useSetClubMemberRole(
  clubId: string,
): UseMutationResult<boolean, Error, SetClubRoleVars> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars) => setClubMemberRole({ clubId, ...vars }),
    onSuccess: () => invalidateClubCard(qc, clubId),
  });
}

/**
 * Podglad kampanii segmentowej. Osobne zapytanie od wysylki, wiec administrator
 * widzi liczby ZANIM cokolwiek pojdzie - i widzi je ponownie po kazdej zmianie
 * reguly, bez klikania "przelicz".
 */
export function useClubSegmentPreview(params: {
  clubId: string | undefined;
  rule: ClubSegmentRule;
  enabled: boolean;
}): UseQueryResult<ClubSegmentPreview, Error> {
  const { clubId, rule, enabled } = params;
  return useQuery({
    queryKey: [...clubKeys.club(clubId ?? ""), "segmentPreview", JSON.stringify(rule)] as const,
    queryFn: () => previewClubSegment({ clubId: clubId ?? "", rule }),
    staleTime: 15_000,
    retry: false,
    enabled: enabled && Boolean(clubId),
  });
}

export interface InviteSegmentVars {
  rule: ClubSegmentRule;
  role: ClubMemberRole;
  message?: string | null;
  saveRule?: boolean;
}

export function useInviteClubSegment(
  clubId: string,
): UseMutationResult<number, Error, InviteSegmentVars> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars) => inviteClubSegment({ clubId, ...vars }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: clubKeys.club(clubId) });
      void qc.invalidateQueries({ queryKey: adminClubKeys.all });
    },
  });
}

export function useDeleteClubGroup(
  clubId: string,
): UseMutationResult<number, Error, { groupId: string; moveToGroupId?: string | null }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteClubGroup,
    onSuccess: () => {
      // Kasowanie grupy przenosi watki, wiec uniewaznia takze liste tematow
      // i statystyki - punktowa inwalidacja samych grup zostawilaby liste
      // tematow z martwym filtrem grupy.
      void qc.invalidateQueries({ queryKey: clubKeys.club(clubId) });
      void qc.invalidateQueries({ queryKey: adminClubKeys.all });
    },
  });
}

/**
 * Redakcja CUDZEGO wpisu z panelu. Osobno od produktowego useEditClubThread,
 * bo rozni sie dwiema rzeczami: niesie powod (RPC zapisuje go w dzienniku)
 * i uniewaznia korzen klubu zamiast pojedynczego watku - poprawka moderatorska
 * zmienia jednoczesnie liste tematow, dziennik i widok watku.
 */
export function useModeratorEditThread(
  clubId: string,
): UseMutationResult<
  boolean,
  Error,
  { threadId: string; title?: string; body?: string; reason?: string | null }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: editClubThread,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: clubKeys.club(clubId) });
      void qc.invalidateQueries({ queryKey: clubKeys.all });
    },
  });
}

export function useModeratorEditReply(
  clubId: string,
): UseMutationResult<boolean, Error, { replyId: string; body: string; reason?: string | null }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: editClubReply,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: clubKeys.club(clubId) });
      void qc.invalidateQueries({ queryKey: clubKeys.all });
    },
  });
}

export function useRemoveClubMember(clubId: string): UseMutationResult<boolean, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId) => removeClubMember(clubId, userId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: clubKeys.club(clubId) });
      void qc.invalidateQueries({ queryKey: adminClubKeys.all });
    },
  });
}

// ---------------------------------------------------------------------------
// Etap A2: zaproszenia
// ---------------------------------------------------------------------------

export function useClubInvitations(
  clubId: string | undefined,
): UseQueryResult<AdminClubInvitationRow[], Error> {
  return useQuery({
    queryKey: clubKeys.invitations(clubId ?? ""),
    queryFn: () => fetchClubInvitations(clubId ?? ""),
    staleTime: 15_000,
    enabled: Boolean(clubId),
  });
}

export function useClubInviteLinks(
  clubId: string | undefined,
): UseQueryResult<AdminClubInviteLinkRow[], Error> {
  return useQuery({
    queryKey: clubKeys.inviteLinks(clubId ?? ""),
    queryFn: () => fetchClubInviteLinks(clubId ?? ""),
    staleTime: 15_000,
    enabled: Boolean(clubId),
  });
}

/** Zaproszenia skierowane do zalogowanego - zasila licznik w nawigacji. */
export function useMyClubInvitations(enabled = true): UseQueryResult<ClubMyInvitationRow[], Error> {
  return useQuery({
    queryKey: clubKeys.myInvitations(),
    queryFn: fetchMyClubInvitations,
    staleTime: STALE_MS,
    enabled,
  });
}

export interface InviteMemberVars {
  userId: string;
  role?: ClubMemberRole;
  message?: string | null;
}

export function useInviteClubMember(
  clubId: string,
): UseMutationResult<string, Error, InviteMemberVars> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars) => inviteClubMember({ ...vars, clubId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: clubKeys.club(clubId) });
    },
  });
}

export interface InviteByEmailVars {
  email: string;
  role?: Exclude<ClubMemberRole, "lead">;
}

export function useInviteClubMemberByEmail(
  clubId: string,
): UseMutationResult<string, Error, InviteByEmailVars> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars) => inviteClubMemberByEmail({ ...vars, clubId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: clubKeys.invitations(clubId) });
    },
  });
}

export function useCreateClubInviteLink(
  clubId: string,
): UseMutationResult<{ id: string; token: string }, Error, Omit<ClubInviteLinkInput, "clubId">> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input) => createClubInviteLink({ ...input, clubId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: clubKeys.inviteLinks(clubId) });
    },
  });
}

export function useRevokeClubInviteLink(clubId: string): UseMutationResult<boolean, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: revokeClubInviteLink,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: clubKeys.inviteLinks(clubId) });
    },
  });
}

// --- samoobsluga czlonkostwa -----------------------------------------------

export function useJoinClub(): UseMutationResult<string, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: joinClub,
    onSuccess: (_status, clubId) => {
      invalidateClubCard(qc, clubId);
      void qc.invalidateQueries({ queryKey: clubKeys.memberships() });
    },
  });
}

export function useLeaveClub(): UseMutationResult<boolean, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: leaveClub,
    onSuccess: (_ok, clubId) => {
      invalidateClubCard(qc, clubId);
      void qc.invalidateQueries({ queryKey: clubKeys.memberships() });
    },
  });
}

export function useRespondClubInvitation(): UseMutationResult<
  string,
  Error,
  { invitationId: string; accept: boolean }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: respondClubInvitation,
    onSuccess: () => {
      // Odpowiedz na zaproszenie zmienia i liste zaproszen, i liste klubow,
      // i czlonkostwa - inwalidacja od korzenia jest tu tansza niz trzy klucze.
      void qc.invalidateQueries({ queryKey: clubKeys.all });
    },
  });
}

export function useRedeemClubInviteLink(): UseMutationResult<
  { clubSlug: string; status: string },
  Error,
  string
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: redeemClubInviteLink,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: clubKeys.all });
    },
  });
}

export function useSetClubNotifyLevel(
  clubId: string,
): UseMutationResult<boolean, Error, ClubNotifyLevel> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (level) => setClubNotifyLevel({ clubId, level }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: clubKeys.memberships() });
    },
  });
}

export function useAcceptClubRules(clubId: string): UseMutationResult<boolean, Error, void> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => acceptClubRules(clubId),
    onSuccess: () => invalidateClubCard(qc, clubId),
  });
}

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
    staleTime: STALE_MS,
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
    staleTime: STALE_MS,
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
    onSuccess: () => invalidateClubCard(qc, clubId),
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
    onSuccess: (_outcome, vars) => {
      // Prefiks BEZ sortu: wariantow jest trzy, a wyliczanie ich z reki
      // gwarantuje, ze czwarty zostanie kiedys pominiety - dokladnie tak
      // zniknal wczesniej sort 'stance'.
      void qc.invalidateQueries({ queryKey: clubKeys.repliesAll(vars.threadId) });
      // Odpowiedz zmienia licznik na liscie tematow i na karcie watku,
      // wiec inwalidujemy oba - a nie tylko liste odpowiedzi.
      void qc.invalidateQueries({ queryKey: clubKeys.thread(clubId, threadSlug) });
      void qc.invalidateQueries({ queryKey: clubKeys.club(clubId) });
    },
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
    onSuccess: () => {
      // Tytuł i treść są PROJEKCJĄ listy tematów (`title` + `left(body, 280)`
      // jako fragment) i wyników wyszukiwania, więc redakcja zmienia trzy
      // widoki, nie jeden. Punktowa inwalidacja zostawiała w katalogu stary
      // tytuł obok poprawionego wątku.
      void qc.invalidateQueries({ queryKey: clubKeys.thread(clubId, threadSlug) });
      void qc.invalidateQueries({ queryKey: clubKeys.club(clubId) });
      void qc.invalidateQueries({ queryKey: clubKeys.searchAll() });
    },
  });
}

export function useEditClubReply(
  threadId: string,
): UseMutationResult<boolean, Error, { replyId: string; body: string; reason?: string | null }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: editClubReply,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: clubKeys.repliesAll(threadId) });
    },
  });
}

export function useResolveClubThread(
  clubId: string,
  threadSlug: string,
): UseMutationResult<boolean, Error, { threadId: string; replyId: string | null }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: resolveClubThread,
    onSuccess: (_ok, vars) => {
      // Oznaczenie rozstrzygniecia zmienia i znacznik przy odpowiedzi, i jej
      // pozycje (SQL wynosi rozstrzygajaca na gore w KAZDYM sorcie), wiec
      // uniewazniamy caly prefiks, nie sam wariant chronologiczny.
      void qc.invalidateQueries({ queryKey: clubKeys.thread(clubId, threadSlug) });
      void qc.invalidateQueries({ queryKey: clubKeys.repliesAll(vars.threadId) });
    },
  });
}

// ---------------------------------------------------------------------------
// Etap A4: reakcje, stanowiska, subskrypcje
// ---------------------------------------------------------------------------

/** Reakcje dla CALEJ widocznej partii jednym zapytaniem - nigdy N+1. */
export function useClubReactions(params: {
  targetType: ClubReactionTarget;
  targetIds: string[];
}): UseQueryResult<Map<string, ClubReactionTally[]>, Error> {
  const { targetType, targetIds } = params;
  return useQuery({
    queryKey: clubKeys.reactions(targetType, targetIds),
    queryFn: () => fetchClubReactions({ targetType, targetIds }),
    staleTime: 10_000,
    enabled: targetIds.length > 0,
  });
}

/**
 * Twarze osób, które zareagowały. Osobne zapytanie od liczników, bo licznik
 * odświeżamy optymistycznie po każdym kliknięciu, a lista twarzy jest cięższa
 * i wystarczy jej odświeżenie po potwierdzeniu serwera.
 */
export function useClubReactionActors(params: {
  targetType: ClubReactionTarget;
  targetIds: string[];
  limit?: number;
  enabled?: boolean;
}): UseQueryResult<Map<string, ClubReactionActor[]>, Error> {
  const { targetType, targetIds, limit, enabled } = params;
  return useQuery({
    queryKey: clubKeys.reactionActors(targetType, targetIds),
    queryFn: () => fetchClubReactionActors({ targetType, targetIds, limit }),
    staleTime: 30_000,
    enabled: targetIds.length > 0 && enabled !== false,
  });
}

export interface ToggleReactionVars {
  targetId: string;
  kind: ClubReactionKind;
  /** Czy uzytkownik JUZ postawil te reakcje - decyduje o kierunku operacji. */
  active: boolean;
}

/**
 * Przelaczenie reakcji. Optymistyczna aktualizacja odwzorowuje regule triggera
 * (applyReactionToggle), wiec pasek nigdy nie pokazuje stanu, ktorego baza nie
 * dopusci - np. agree i disagree naraz od tej samej osoby.
 */
export function useToggleClubReaction(params: {
  targetType: ClubReactionTarget;
  targetIds: string[];
}): UseMutationResult<boolean, Error, ToggleReactionVars> {
  const { targetType, targetIds } = params;
  const qc = useQueryClient();
  const key = clubKeys.reactions(targetType, targetIds);

  return useMutation({
    mutationFn: (vars) =>
      vars.active
        ? unreactFromClubTarget({ targetType, targetId: vars.targetId, kind: vars.kind })
        : reactToClubTarget({ targetType, targetId: vars.targetId, kind: vars.kind }),
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<Map<string, ClubReactionTally[]>>(key);
      if (previous) {
        const next = new Map(previous);
        next.set(vars.targetId, applyReactionToggle(previous.get(vars.targetId) ?? [], vars.kind));
        qc.setQueryData(key, next);
      }
      return { previous };
    },
    onError: (_error, _vars, context) => {
      // Cofamy optymistyczna zmiane: pasek pokazujacy reakcje, ktorej baza nie
      // przyjela, jest gorszy niz chwilowe migniecie.
      const previous = (context as { previous?: Map<string, ClubReactionTally[]> } | undefined)
        ?.previous;
      if (previous) qc.setQueryData(key, previous);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: key });
      // Twarze muszą pójść za licznikiem, inaczej po własnej reakcji widać
      // "+1" bez własnego awatara.
      void qc.invalidateQueries({
        queryKey: clubKeys.reactionActors(targetType, targetIds),
      });
    },
  });
}

export function useClubStanceSummary(
  threadId: string | undefined,
): UseQueryResult<ClubStanceSummaryRow[], Error> {
  return useQuery({
    queryKey: clubKeys.stances(threadId ?? ""),
    queryFn: () => fetchClubStanceSummary(threadId ?? ""),
    staleTime: 10_000,
    enabled: Boolean(threadId),
  });
}

export function useSetClubStance(
  threadId: string,
): UseMutationResult<boolean, Error, { stance: ClubStance; rationale?: string | null }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars) => setClubStance({ threadId, ...vars }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: clubKeys.stances(threadId) });
    },
  });
}

export function useMyThreadSubscription(
  threadId: string | undefined,
): UseQueryResult<ClubSubscriptionState | null, Error> {
  return useQuery({
    queryKey: clubKeys.subscription(threadId ?? ""),
    queryFn: () => fetchMyThreadSubscription(threadId ?? ""),
    staleTime: STALE_MS,
    enabled: Boolean(threadId),
  });
}

export function useSetThreadSubscription(
  threadId: string,
): UseMutationResult<boolean, Error, ClubSubscriptionState> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (state) => setClubThreadSubscription({ threadId, state }),
    onSuccess: (_ok, state) => {
      qc.setQueryData(clubKeys.subscription(threadId), state);
    },
  });
}

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
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: clubKeys.club(clubId) });
      void qc.invalidateQueries({ queryKey: clubKeys.all });
    },
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
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: clubKeys.club(clubId) });
      void qc.invalidateQueries({ queryKey: clubKeys.all });
    },
  });
}

export function useBulkSetClubMemberRole(
  clubId: string,
): UseMutationResult<number, Error, { userIds: string[]; role: ClubMemberRole }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars) => bulkSetClubMemberRole({ clubId, ...vars }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: clubKeys.club(clubId) });
    },
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
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: clubKeys.club(clubId) });
    },
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
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: clubKeys.club(clubId) });
      void qc.invalidateQueries({ queryKey: clubKeys.all });
    },
  });
}

export function useMoveClubThread(
  clubId: string,
): UseMutationResult<boolean, Error, { threadId: string; groupId: string }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: moveClubThread,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: clubKeys.club(clubId) });
    },
  });
}

export function useBanClubMember(
  clubId: string,
): UseMutationResult<boolean, Error, { userId: string; banned: boolean; reason?: string | null }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars) => banClubMember({ clubId, ...vars }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: clubKeys.club(clubId) });
    },
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
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: pendingCounterKeys.all });
      void qc.invalidateQueries({ queryKey: clubKeys.memberships() });
    },
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
