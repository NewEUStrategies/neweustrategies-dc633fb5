// Kluby - hooki ZAPROSZEN i SAMOOBSLUGI CZLONKOSTWA.
//
// Wydzielone z `useClubs.ts` - patrz naglowek `useClubCatalog.ts`. Trzy
// sciezki wejscia (osoba z platformy, e-mail, link) plus dolaczenie, wyjscie,
// odpowiedz na zaproszenie i poziom powiadomien.
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import {
  acceptClubRules,
  createClubInviteLink,
  fetchClubInvitations,
  fetchClubInviteLinks,
  fetchMyClubInvitations,
  inviteClubMember,
  inviteClubMemberByEmail,
  joinClub,
  leaveClub,
  redeemClubInviteLink,
  respondClubInvitation,
  revokeClubInviteLink,
  setClubNotifyLevel,
} from "./api";
import { clubKeys } from "./queryKeys";
import {
  CLUB_STALE_MS,
  clubCardKeys,
  clubInvitationsKeys,
  clubInviteLinksKeys,
  clubMembershipKeys,
  clubMembershipsOnlyKeys,
  clubOnlyKeys,
  clubTreeKeys,
  invalidateKeys,
} from "./clubInvalidations";
import type {
  AdminClubInvitationRow,
  AdminClubInviteLinkRow,
  ClubInviteLinkInput,
  ClubMemberRole,
  ClubMyInvitationRow,
  ClubNotifyLevel,
} from "./types";

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
    staleTime: CLUB_STALE_MS,
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
    onSuccess: () => invalidateKeys(qc, clubOnlyKeys(clubId)),
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
    onSuccess: () => invalidateKeys(qc, clubInvitationsKeys(clubId)),
  });
}

export function useCreateClubInviteLink(
  clubId: string,
): UseMutationResult<{ id: string; token: string }, Error, Omit<ClubInviteLinkInput, "clubId">> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input) => createClubInviteLink({ ...input, clubId }),
    onSuccess: () => invalidateKeys(qc, clubInviteLinksKeys(clubId)),
  });
}

export function useRevokeClubInviteLink(clubId: string): UseMutationResult<boolean, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: revokeClubInviteLink,
    onSuccess: () => invalidateKeys(qc, clubInviteLinksKeys(clubId)),
  });
}

// --- samoobsluga czlonkostwa -----------------------------------------------

export function useJoinClub(): UseMutationResult<string, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: joinClub,
    onSuccess: (_status, clubId) => invalidateKeys(qc, clubMembershipKeys(clubId)),
  });
}

export function useLeaveClub(): UseMutationResult<boolean, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: leaveClub,
    onSuccess: (_ok, clubId) => invalidateKeys(qc, clubMembershipKeys(clubId)),
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
    onSuccess: () => invalidateKeys(qc, clubTreeKeys()),
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
    onSuccess: () => invalidateKeys(qc, clubTreeKeys()),
  });
}

export function useSetClubNotifyLevel(
  clubId: string,
): UseMutationResult<boolean, Error, ClubNotifyLevel> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (level) => setClubNotifyLevel({ clubId, level }),
    onSuccess: () => invalidateKeys(qc, clubMembershipsOnlyKeys()),
  });
}

export function useAcceptClubRules(clubId: string): UseMutationResult<boolean, Error, void> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => acceptClubRules(clubId),
    onSuccess: () => invalidateKeys(qc, clubCardKeys(clubId)),
  });
}
