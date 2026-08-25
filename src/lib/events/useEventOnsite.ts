// Hooki modulu ON-SITE: punkty kontrolne, odprawa, dziennik, urzadzenia,
// identyfikatory, leady, statystyki.
//
// JEDNA FABRYKA KLUCZY NA CALY MODUL. Odprawa zmienia dziennik ORAZ zajetosc
// punktu ORAZ statystyki - gdyby kazdy ekran mial wlasny literal klucza, po
// pikniecie odswiezalby sie tylko ten panel, na ktorym stoi kursor, a operator
// przy bramce czytalby nieaktualna zajetosc.
//
// TOKEN URZADZENIA NIE WCHODZI DO CACHE. Mutacja wydania zwraca jawny token
// wywolujacemu, ale nie zapisujemy go w zadnym `queryKey` - React Query trzyma
// dane w pamieci strony i w devtoolsach, a to nie jest miejsce na poswiadczenie.
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import {
  deleteBadgeTemplate,
  deleteCheckpoint,
  fetchBadgePrints,
  fetchBadgeTemplates,
  fetchCheckins,
  fetchCheckpoints,
  fetchLeadScans,
  fetchOnsiteStats,
  fetchScannerDevices,
  issueScannerDevice,
  recordBadgePrint,
  recordManualCheckin,
  revokeScannerDevice,
  saveBadgeTemplate,
  saveCheckpoint,
  searchCheckinPeople,
  setScannerDeviceActive,
  type BadgePrintInput,
  type BadgePrintRow,
  type BadgePrintsQuery,
  type BadgeTemplateInput,
  type BadgeTemplateRow,
  type CheckinOutcome,
  type CheckinSearchRow,
  type CheckinsQuery,
  type CheckpointInput,
  type EventCheckinRow,
  type EventCheckpointRow,
  type LeadScanRow,
  type LeadScansQuery,
  type ManualCheckinInput,
  type OnsiteStats,
  type ScannerDeviceCredential,
  type ScannerDeviceIssueInput,
  type ScannerDeviceRow,
} from "@/lib/events/onsiteApi";

export const onsiteKeys = {
  all: ["event-onsite"] as const,
  event: (eventId: string) => [...onsiteKeys.all, eventId] as const,
  checkpoints: (eventId: string) => [...onsiteKeys.event(eventId), "checkpoints"] as const,
  search: (eventId: string, q: string) => [...onsiteKeys.event(eventId), "search", q] as const,
  checkins: (query: CheckinsQuery) => [...onsiteKeys.event(query.eventId), "checkins", query],
  stats: (eventId: string, bucketMinutes: number) =>
    [...onsiteKeys.event(eventId), "stats", bucketMinutes] as const,
  devices: (eventId: string) => [...onsiteKeys.event(eventId), "devices"] as const,
  templates: (eventId: string) => [...onsiteKeys.event(eventId), "badge-templates"] as const,
  prints: (query: BadgePrintsQuery) => [...onsiteKeys.event(query.eventId), "badge-prints", query],
  leads: (query: LeadScansQuery) => [...onsiteKeys.event(query.eventId), "lead-scans", query],
};

/* --------------------------------------------------------------- zapytania --- */

export function useCheckpoints(
  eventId: string,
  enabled = true,
): UseQueryResult<EventCheckpointRow[]> {
  return useQuery({
    queryKey: onsiteKeys.checkpoints(eventId),
    queryFn: () => fetchCheckpoints(eventId),
    enabled: enabled && eventId !== "",
  });
}

/** Szukanie osoby przy bramce - min. 2 znaki, bo baza odmawia krotszym. */
export function useCheckinSearch(
  eventId: string,
  q: string,
  enabled = true,
): UseQueryResult<CheckinSearchRow[]> {
  const query = q.trim();
  return useQuery({
    queryKey: onsiteKeys.search(eventId, query),
    queryFn: () => searchCheckinPeople({ eventId, q: query }),
    enabled: enabled && eventId !== "" && query.length >= 2,
  });
}

export function useCheckins(
  query: CheckinsQuery,
  enabled = true,
): UseQueryResult<EventCheckinRow[]> {
  return useQuery({
    queryKey: onsiteKeys.checkins(query),
    queryFn: () => fetchCheckins(query),
    enabled: enabled && query.eventId !== "",
  });
}

/**
 * Statystyki na miejscu. `refetchInterval` jest celowy: pulpit organizatora w
 * dniu wydarzenia bez odswiezania klamie po pierwszej minucie.
 */
export function useOnsiteStats(
  eventId: string,
  bucketMinutes = 15,
  enabled = true,
): UseQueryResult<OnsiteStats> {
  return useQuery({
    queryKey: onsiteKeys.stats(eventId, bucketMinutes),
    queryFn: () => fetchOnsiteStats(eventId, bucketMinutes),
    enabled: enabled && eventId !== "",
    refetchInterval: enabled && eventId !== "" ? 30_000 : false,
  });
}

export function useScannerDevices(
  eventId: string,
  enabled = true,
): UseQueryResult<ScannerDeviceRow[]> {
  return useQuery({
    queryKey: onsiteKeys.devices(eventId),
    queryFn: () => fetchScannerDevices(eventId),
    enabled: enabled && eventId !== "",
  });
}

export function useBadgeTemplates(
  eventId: string,
  enabled = true,
): UseQueryResult<BadgeTemplateRow[]> {
  return useQuery({
    queryKey: onsiteKeys.templates(eventId),
    queryFn: () => fetchBadgeTemplates(eventId),
    enabled: enabled && eventId !== "",
  });
}

export function useBadgePrints(
  query: BadgePrintsQuery,
  enabled = true,
): UseQueryResult<BadgePrintRow[]> {
  return useQuery({
    queryKey: onsiteKeys.prints(query),
    queryFn: () => fetchBadgePrints(query),
    enabled: enabled && query.eventId !== "",
  });
}

export function useLeadScans(query: LeadScansQuery, enabled = true): UseQueryResult<LeadScanRow[]> {
  return useQuery({
    queryKey: onsiteKeys.leads(query),
    queryFn: () => fetchLeadScans(query),
    enabled: enabled && query.eventId !== "",
  });
}

/* ---------------------------------------------------------------- mutacje --- */

/** Wszystkie mutacje modulu uniewazniaja te sama galaz wydarzenia. */
function useOnsiteMutation<TInput, TResult>(
  eventId: string,
  run: (input: TInput) => Promise<TResult>,
): UseMutationResult<TResult, Error, TInput> {
  const queryClient = useQueryClient();
  return useMutation<TResult, Error, TInput>({
    mutationFn: run,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: onsiteKeys.event(eventId) });
    },
  });
}

export function useSaveCheckpoint(eventId: string) {
  return useOnsiteMutation<CheckpointInput, string>(eventId, saveCheckpoint);
}

export function useDeleteCheckpoint(eventId: string) {
  return useOnsiteMutation<string, boolean>(eventId, deleteCheckpoint);
}

export function useManualCheckin(eventId: string) {
  return useOnsiteMutation<ManualCheckinInput, CheckinOutcome>(eventId, recordManualCheckin);
}

export function useIssueScannerDevice(eventId: string) {
  return useOnsiteMutation<ScannerDeviceIssueInput, ScannerDeviceCredential>(
    eventId,
    issueScannerDevice,
  );
}

export function useRevokeScannerDevice(eventId: string) {
  return useOnsiteMutation<string, boolean>(eventId, revokeScannerDevice);
}

export function useSetScannerDeviceActive(eventId: string) {
  return useOnsiteMutation<{ deviceId: string; isActive: boolean }, boolean>(eventId, (input) =>
    setScannerDeviceActive(input.deviceId, input.isActive),
  );
}

export function useSaveBadgeTemplate(eventId: string) {
  return useOnsiteMutation<BadgeTemplateInput, string>(eventId, saveBadgeTemplate);
}

export function useDeleteBadgeTemplate(eventId: string) {
  return useOnsiteMutation<string, boolean>(eventId, deleteBadgeTemplate);
}

export function useRecordBadgePrint(eventId: string) {
  return useOnsiteMutation<BadgePrintInput, Record<string, unknown>>(eventId, recordBadgePrint);
}
