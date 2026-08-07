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
  fetchClubCapabilities,
  fetchClubGroups,
  fetchClubList,
  fetchClubInvitations,
  fetchClubInviteLinks,
  deleteClubGroup,
  fetchClubModerationLog,
  fetchClubModerationQueue,
  fetchClubMembers,
  fetchClubReactions,
  fetchClubReplies,
  fetchClubStanceSummary,
  fetchClubThread,
  fetchClubThreads,
  fetchMyClubInvitations,
  fetchMyClubMemberships,
  fetchMyThreadSubscription,
  inviteClubMember,
  inviteClubMemberByEmail,
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
  setClubNotifyLevel,
  setClubStance,
  setClubThreadSubscription,
  unreactFromClubTarget,
  previewClubCapabilities,
  removeClubMember,
  reorderClubGroups,
  upsertClub,
  upsertClubGroup,
  upsertClubMember,
  type AdminClubsPage,
  type AdminThreadsPage,
  type ClubMembersPage,
  type ClubThreadsPage,
  type CreateThreadResult,
} from "./api";
import { adminClubKeys, clubKeys } from "./queryKeys";
import { applyReactionToggle } from "./types";
import type {
  AdminClubDetailRow,
  AdminClubGroupRow,
  AdminClubInvitationRow,
  AdminClubInviteLinkRow,
  AdminClubModerationItem,
  AdminClubModerationLogRow,
  AdminClubReplyRow,
  ClubModerationAction,
  AdminClubListFilters,
  AdminClubStatsRow,
  ClubCapabilities,
  ClubGroupRow,
  ClubGroupUpsertInput,
  ClubListRow,
  ClubInviteLinkInput,
  ClubMemberRole,
  ClubMemberStatus,
  ClubMemberUpsertInput,
  ClubMembershipRow,
  ClubMyInvitationRow,
  ClubNotifyLevel,
  ClubReactionKind,
  ClubReactionTally,
  ClubReactionTarget,
  ClubReplyRow,
  ClubReplySort,
  ClubStance,
  ClubStanceSummaryRow,
  ClubSubscriptionState,
  ClubThreadKind,
  ClubThreadSort,
  ClubThreadViewRow,
  ClubUpsertInput,
  ClubViewRow,
} from "./types";

/** Dane klubowe zmieniaja sie w rytmie dyskusji, nie sekund - 30 s wystarcza. */
const STALE_MS = 30_000;

// ---------------------------------------------------------------------------
// Odczyt
// ---------------------------------------------------------------------------

export function useClubList(enabled = true): UseQueryResult<ClubListRow[], Error> {
  return useQuery({
    queryKey: clubKeys.list(),
    queryFn: fetchClubList,
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
    queryKey: clubKeys.members(clubId ?? "", status, offset),
    queryFn: () => fetchClubMembers({ clubId: clubId ?? "", status, limit, offset }),
    staleTime: STALE_MS,
    enabled: Boolean(clubId),
  });
}

/**
 * Zdolnosci wolajacego. Trzymane osobno od karty klubu, bo ten sam wynik jest
 * potrzebny na kilku ekranach naraz (lista tematow, kompozytor, pasek akcji),
 * a jedno zrodlo w cache oznacza jedno zapytanie zamiast trzech.
 */
export function useClubCapabilities(
  clubId: string | undefined,
  groupId?: string | null,
): UseQueryResult<ClubCapabilities, Error> {
  return useQuery({
    queryKey: clubKeys.capabilities(clubId ?? "", groupId),
    queryFn: () => fetchClubCapabilities(clubId ?? "", groupId),
    staleTime: STALE_MS,
    enabled: Boolean(clubId),
  });
}

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
      void qc.invalidateQueries({ queryKey: clubKeys.club(clubId) });
      void qc.invalidateQueries({ queryKey: clubKeys.list() });
      void qc.invalidateQueries({ queryKey: clubKeys.memberships() });
    },
  });
}

export function useLeaveClub(): UseMutationResult<boolean, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: leaveClub,
    onSuccess: (_ok, clubId) => {
      void qc.invalidateQueries({ queryKey: clubKeys.club(clubId) });
      void qc.invalidateQueries({ queryKey: clubKeys.list() });
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
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: clubKeys.club(clubId) });
    },
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
}): UseInfiniteQueryResult<{ pages: ClubThreadsPage[]; pageParams: unknown[] }, Error> {
  const { clubId, groupId = null, sort = "hot", kind = null } = params;
  return useInfiniteQuery({
    queryKey: clubKeys.threads(clubId ?? "", groupId, sort, kind),
    queryFn: ({ pageParam }) =>
      fetchClubThreads({
        clubId: clubId ?? "",
        groupId,
        sort,
        kind,
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

export function useClubReplies(params: {
  threadId: string | undefined;
  sort?: ClubReplySort;
}): UseQueryResult<ClubReplyRow[], Error> {
  const { threadId, sort = "chronological" } = params;
  return useQuery({
    queryKey: clubKeys.replies(threadId ?? "", sort),
    queryFn: () => fetchClubReplies({ threadId: threadId ?? "", sort }),
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
}

export function useCreateClubThread(
  clubId: string,
): UseMutationResult<CreateThreadResult, Error, CreateThreadVars> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createClubThread,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: clubKeys.club(clubId) });
    },
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
): UseMutationResult<string, Error, ReplyVars> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: replyToClubThread,
    onSuccess: (_id, vars) => {
      // Odpowiedz zmienia licznik na liscie tematow i na karcie watku,
      // wiec inwalidujemy oba - a nie tylko liste odpowiedzi.
      void qc.invalidateQueries({ queryKey: clubKeys.replies(vars.threadId, "chronological") });
      void qc.invalidateQueries({ queryKey: clubKeys.replies(vars.threadId, "best") });
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
  { threadId: string; title: string; body: string; reason?: string | null }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: editClubThread,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: clubKeys.thread(clubId, threadSlug) });
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
      void qc.invalidateQueries({ queryKey: clubKeys.replies(threadId, "chronological") });
      void qc.invalidateQueries({ queryKey: clubKeys.replies(threadId, "best") });
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
      void qc.invalidateQueries({ queryKey: clubKeys.thread(clubId, threadSlug) });
      void qc.invalidateQueries({ queryKey: clubKeys.replies(vars.threadId, "chronological") });
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
): UseQueryResult<AdminClubReplyRow[], Error> {
  return useQuery({
    queryKey: clubKeys.adminReplies(threadId ?? ""),
    queryFn: () => fetchAdminClubReplies({ threadId: threadId ?? "" }),
    staleTime: 10_000,
    enabled: Boolean(threadId),
  });
}

export function useClubModerationQueue(
  clubId: string | undefined,
): UseQueryResult<AdminClubModerationItem[], Error> {
  return useQuery({
    queryKey: clubKeys.moderationQueue(clubId ?? ""),
    queryFn: () => fetchClubModerationQueue(clubId ?? ""),
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

export function useBulkModerateClub(
  clubId: string,
): UseMutationResult<number, Error, Omit<ModerateVars, "targetId"> & { targetIds: string[] }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: bulkModerateClubTargets,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: clubKeys.club(clubId) });
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
