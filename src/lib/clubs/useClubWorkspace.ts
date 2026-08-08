// Discussion Club - hooki przestrzeni roboczej (A28).
//
// Mutacje kuratorskie uniewazniaja KORZEN klubu (`clubKeys.club(id)`), a nie
// pojedyncza galaz. To nie jest lenistwo, tylko konsekwencja tego, ze przekroj
// (`club_workspace_stats`) liczy dokumenty, wydarzenia i etapy - dodanie
// dokumentu zmienia wiec rowniez kafelek pomiaru. Punktowa inwalidacja
// pokazywalaby nowy dokument obok starego licznika.
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import {
  deleteClubDocument,
  deleteClubEvent,
  deleteClubMilestone,
  fetchClubActivitySeries,
  fetchClubDocuments,
  fetchClubEvents,
  fetchClubMilestones,
  fetchClubWorkspaceStats,
  setClubEventRsvp,
  upsertClubDocument,
  upsertClubEvent,
  upsertClubMilestone,
  type ClubDocumentsPage,
} from "./workspaceApi";
import { clubKeys } from "./queryKeys";
import type {
  ClubActivityPoint,
  ClubDocumentRow,
  ClubDocumentUpsertInput,
  ClubEventRow,
  ClubEventUpsertInput,
  ClubMilestoneRow,
  ClubMilestoneUpsertInput,
  ClubRsvpState,
  ClubWorkspaceStatsRow,
} from "./workspaceTypes";

/** Jedno miejsce na regule inwalidacji - patrz naglowek pliku. */
function invalidateWorkspace(qc: QueryClient, clubId: string): void {
  void qc.invalidateQueries({ queryKey: clubKeys.club(clubId) });
}

// ---------------------------------------------------------------------------
// Biblioteka
// ---------------------------------------------------------------------------

export function useClubDocuments(params: {
  clubId: string | undefined;
  groupId?: string | null;
  kind?: string | null;
  search?: string;
  offset?: number;
  limit?: number;
}): UseQueryResult<ClubDocumentsPage, Error> {
  const { clubId, groupId = null, kind = null, search = "", offset = 0, limit = 50 } = params;
  return useQuery({
    queryKey: clubKeys.documents(clubId ?? "none", groupId, kind, search, offset),
    queryFn: () =>
      fetchClubDocuments({
        clubId: clubId ?? "",
        groupId,
        kind,
        // Fraza krotsza niz dwa znaki nie zaweza niczego sensownie, a kosztuje
        // pelne skanowanie ILIKE po obu jezykach.
        search: search.trim().length >= 2 ? search.trim() : null,
        offset,
        limit,
      }),
    enabled: clubId !== undefined && clubId !== "",
    staleTime: 30_000,
  });
}

export function useUpsertClubDocument(
  clubId: string,
): UseMutationResult<string, Error, ClubDocumentUpsertInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ClubDocumentUpsertInput) => upsertClubDocument(clubId, input),
    onSuccess: () => invalidateWorkspace(qc, clubId),
  });
}

export function useDeleteClubDocument(clubId: string): UseMutationResult<boolean, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteClubDocument,
    onSuccess: () => invalidateWorkspace(qc, clubId),
  });
}

// ---------------------------------------------------------------------------
// Kalendarz
// ---------------------------------------------------------------------------

export function useClubEvents(params: {
  clubId: string | undefined;
  from?: string | null;
  to?: string | null;
  kind?: string | null;
  limit?: number;
}): UseQueryResult<ClubEventRow[], Error> {
  const { clubId, from = null, to = null, kind = null, limit = 200 } = params;
  return useQuery({
    queryKey: clubKeys.events(clubId ?? "none", from, to, kind),
    queryFn: () => fetchClubEvents({ clubId: clubId ?? "", from, to, kind, limit }),
    enabled: clubId !== undefined && clubId !== "",
    staleTime: 30_000,
  });
}

export function useUpsertClubEvent(
  clubId: string,
): UseMutationResult<string, Error, ClubEventUpsertInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ClubEventUpsertInput) => upsertClubEvent(clubId, input),
    onSuccess: () => invalidateWorkspace(qc, clubId),
  });
}

export function useDeleteClubEvent(clubId: string): UseMutationResult<boolean, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteClubEvent,
    onSuccess: () => invalidateWorkspace(qc, clubId),
  });
}

export function useClubEventRsvp(
  clubId: string,
): UseMutationResult<boolean, Error, { eventId: string; state: ClubRsvpState }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ eventId, state }: { eventId: string; state: ClubRsvpState }) =>
      setClubEventRsvp(eventId, state),
    onSuccess: () => invalidateWorkspace(qc, clubId),
  });
}

// ---------------------------------------------------------------------------
// Harmonogram
// ---------------------------------------------------------------------------

export function useClubMilestones(
  clubId: string | undefined,
): UseQueryResult<ClubMilestoneRow[], Error> {
  return useQuery({
    queryKey: clubKeys.milestones(clubId ?? "none"),
    queryFn: () => fetchClubMilestones(clubId ?? ""),
    enabled: clubId !== undefined && clubId !== "",
    staleTime: 60_000,
  });
}

export function useUpsertClubMilestone(
  clubId: string,
): UseMutationResult<string, Error, ClubMilestoneUpsertInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ClubMilestoneUpsertInput) => upsertClubMilestone(clubId, input),
    onSuccess: () => invalidateWorkspace(qc, clubId),
  });
}

export function useDeleteClubMilestone(clubId: string): UseMutationResult<boolean, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteClubMilestone,
    onSuccess: () => invalidateWorkspace(qc, clubId),
  });
}

// ---------------------------------------------------------------------------
// Pomiar
//
// Dluzszy `staleTime` niz reszta modulu: przekroj 30-dniowy nie zmienia sie
// miedzy dwoma wejsciami w zakladke, a kazde wejscie liczy go od nowa po
// stronie bazy.
// ---------------------------------------------------------------------------

export function useClubActivitySeries(
  clubId: string | undefined,
  days = 90,
): UseQueryResult<ClubActivityPoint[], Error> {
  return useQuery({
    queryKey: clubKeys.activitySeries(clubId ?? "none", days),
    queryFn: () => fetchClubActivitySeries(clubId ?? "", days),
    enabled: clubId !== undefined && clubId !== "",
    staleTime: 5 * 60_000,
  });
}

export function useClubWorkspaceStats(
  clubId: string | undefined,
  days = 30,
): UseQueryResult<ClubWorkspaceStatsRow | null, Error> {
  return useQuery({
    queryKey: clubKeys.workspaceStats(clubId ?? "none", days),
    queryFn: () => fetchClubWorkspaceStats(clubId ?? "", days),
    enabled: clubId !== undefined && clubId !== "",
    staleTime: 5 * 60_000,
  });
}

export type { ClubDocumentRow, ClubDocumentsPage };
