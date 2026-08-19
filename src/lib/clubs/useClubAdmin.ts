// Kluby - hooki PANELU ADMINISTRACYJNEGO: odczyt panelu i mutacje ustawien.
//
// Wydzielone z `useClubs.ts` - patrz naglowek `useClubCatalog.ts`. Zestawy
// kluczy uniewaznianych po kazdej mutacji zyja w `clubInvalidations.ts`,
// bo to regula produktowa (czy naglowek pokaze nowy licznik), a nie szczegol
// implementacyjny hooka.
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import {
  editClubReply,
  editClubThread,
  fetchAdminClub,
  fetchAdminClubGroups,
  fetchAdminClubStats,
  fetchAdminClubs,
  checkClubSlugAvailable,
  deleteClubGroup,
  inviteClubSegment,
  setClubMemberRole,
  previewClubCapabilities,
  previewClubSegment,
  removeClubMember,
  reorderClubGroups,
  upsertClub,
  upsertClubGroup,
  upsertClubMember,
  type AdminClubsPage,
} from "./api";
import { adminClubKeys, clubKeys } from "./queryKeys";
import {
  clubCardKeys,
  clubGroupsKeys,
  clubModerationKeys,
  clubSettingsKeys,
  clubUpsertedKeys,
  invalidateKeys,
} from "./clubInvalidations";
import type {
  AdminClubDetailRow,
  AdminClubGroupRow,
  ClubSegmentPreview,
  ClubSegmentRule,
  AdminClubListFilters,
  AdminClubStatsRow,
  ClubCapabilities,
  ClubGroupUpsertInput,
  ClubMemberRole,
  ClubMemberUpsertInput,
  ClubUpsertInput,
} from "./types";

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
    onSuccess: (clubId) => invalidateKeys(qc, clubUpsertedKeys(clubId)),
  });
}

export function useUpsertClubGroup(
  clubId: string,
): UseMutationResult<string, Error, ClubGroupUpsertInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input) => upsertClubGroup({ ...input, club_id: input.club_id ?? clubId }),
    onSuccess: () => invalidateKeys(qc, clubSettingsKeys(clubId)),
  });
}

export function useReorderClubGroups(clubId: string): UseMutationResult<number, Error, string[]> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (groupIds) => reorderClubGroups(clubId, groupIds),
    onSuccess: () => invalidateKeys(qc, clubGroupsKeys(clubId)),
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
    onSuccess: () => invalidateKeys(qc, clubSettingsKeys(clubId)),
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
    onSuccess: () => invalidateKeys(qc, clubCardKeys(clubId)),
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
    onSuccess: () => invalidateKeys(qc, clubSettingsKeys(clubId)),
  });
}

export function useDeleteClubGroup(
  clubId: string,
): UseMutationResult<number, Error, { groupId: string; moveToGroupId?: string | null }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteClubGroup,
    // Kasowanie grupy przenosi watki, wiec uniewaznia takze liste tematow
    // i statystyki - patrz `clubSettingsKeys`.
    onSuccess: () => invalidateKeys(qc, clubSettingsKeys(clubId)),
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
    onSuccess: () => invalidateKeys(qc, clubModerationKeys(clubId)),
  });
}

export function useModeratorEditReply(
  clubId: string,
): UseMutationResult<boolean, Error, { replyId: string; body: string; reason?: string | null }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: editClubReply,
    onSuccess: () => invalidateKeys(qc, clubModerationKeys(clubId)),
  });
}

export function useRemoveClubMember(clubId: string): UseMutationResult<boolean, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId) => removeClubMember(clubId, userId),
    onSuccess: () => invalidateKeys(qc, clubSettingsKeys(clubId)),
  });
}
