// Hooki PLANU SALI (panel organizatora).
//
// JEDNA FABRYKA KLUCZY, JEDNA GALAZ NA WYDARZENIE. Wszystko - lista planow,
// szczegol planu, kandydaci, miejsca na liscie zgloszen - siedzi pod
// `["event-seating", eventId]`. Zdarzenie domenowe `event_seat.*` /
// `event_seat_map.*` (payload niesie `event_id`) uniewaznia te galaz jednym
// kluczem, a mutacja z panelu robi dokladnie to samo, wiec ekran innego
// wydarzenia nie traci swojego cache.
//
// BEZ AKTUALIZACJI OPTYMISTYCZNYCH (konwencja modulu): przydzial rozstrzyga
// baza pod blokada planu, a odmowa "miejsce zajete" musi byc widoczna od razu,
// a nie jako cofniecie narysowanego juz przydzialu.
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import {
  assignSeat,
  assignSeatsBatch,
  deleteSeatCategory,
  deleteSeatMap,
  deleteSeatSection,
  fetchAllSeatingCandidates,
  fetchSeatingCandidates,
  fetchSeatLookup,
  fetchSeatMapDetail,
  fetchSeatMaps,
  releaseSeats,
  saveSeatCategory,
  saveSeatMap,
  saveSeatSection,
  updateSeats,
  type SeatAssignInput,
  type SeatAssignResult,
  type SeatAssignmentSource,
  type SeatBatchItem,
  type SeatBatchResult,
  type SeatCategoryInput,
  type SeatingCandidateRow,
  type SeatingCandidatesPage,
  type SeatingCandidatesQuery,
  type SeatLookupRow,
  type SeatMapDetail,
  type SeatMapInput,
  type SeatMapRow,
  type SeatReleaseInput,
  type SeatSectionInput,
  type SeatSectionSaveResult,
  type SeatsUpdateInput,
} from "@/lib/events/seatingApi";

export const seatingKeys = {
  all: ["event-seating"] as const,
  event: (eventId: string) => [...seatingKeys.all, eventId] as const,
  maps: (eventId: string) => [...seatingKeys.event(eventId), "maps"] as const,
  map: (eventId: string, mapId: string) => [...seatingKeys.event(eventId), "map", mapId] as const,
  candidates: (eventId: string, query: SeatingCandidatesQuery) =>
    [...seatingKeys.event(eventId), "candidates", query] as const,
  planner: (eventId: string, mapId: string) =>
    [...seatingKeys.event(eventId), "planner", mapId] as const,
  lookup: (eventId: string, registrationIds: readonly string[]) =>
    [...seatingKeys.event(eventId), "lookup", registrationIds] as const,
};

/** Konfiguracja planu zmienia sie rzadko; obsada - w trakcie pracy kilku osob. */
export const SEATING_CONFIG_STALE_MS = 60_000;
export const SEATING_LIVE_STALE_MS = 15_000;

export function useSeatMaps(eventId: string): UseQueryResult<SeatMapRow[], Error> {
  return useQuery({
    queryKey: seatingKeys.maps(eventId),
    queryFn: () => fetchSeatMaps(eventId),
    enabled: eventId !== "",
    staleTime: SEATING_CONFIG_STALE_MS,
  });
}

export function useSeatMapDetail(
  eventId: string,
  mapId: string,
): UseQueryResult<SeatMapDetail, Error> {
  return useQuery({
    queryKey: seatingKeys.map(eventId, mapId),
    queryFn: () => fetchSeatMapDetail(mapId),
    enabled: eventId !== "" && mapId !== "",
    staleTime: SEATING_LIVE_STALE_MS,
  });
}

/** `null` = zapytanie bezczynne (np. plan jeszcze nie wybrany). */
export function useSeatingCandidates(
  eventId: string,
  query: SeatingCandidatesQuery | null,
): UseQueryResult<SeatingCandidatesPage, Error> {
  return useQuery({
    queryKey:
      query === null
        ? [...seatingKeys.event(eventId), "candidates", "idle"]
        : seatingKeys.candidates(eventId, query),
    queryFn: () => fetchSeatingCandidates(query as SeatingCandidatesQuery),
    enabled: eventId !== "" && query !== null,
    staleTime: SEATING_LIVE_STALE_MS,
  });
}

/** Wszyscy kandydaci planu - wejscie auto-przydzialu (tylko przy otwartym dialogu). */
export function useAllSeatingCandidates(
  eventId: string,
  mapId: string,
  enabled: boolean,
): UseQueryResult<SeatingCandidateRow[], Error> {
  return useQuery({
    queryKey: seatingKeys.planner(eventId, mapId),
    queryFn: () => fetchAllSeatingCandidates(mapId),
    enabled: enabled && eventId !== "" && mapId !== "",
    staleTime: SEATING_LIVE_STALE_MS,
  });
}

/** Miejsca na sali dla widocznych wierszy listy zgloszen. */
export function useSeatLookup(
  eventId: string,
  registrationIds: readonly string[],
): UseQueryResult<SeatLookupRow[], Error> {
  return useQuery({
    queryKey: seatingKeys.lookup(eventId, registrationIds),
    queryFn: () => fetchSeatLookup(eventId, registrationIds),
    enabled: eventId !== "" && registrationIds.length > 0,
    staleTime: SEATING_LIVE_STALE_MS,
  });
}

/** Kazda mutacja planu uniewaznia cala galaz wydarzenia - jeden helper. */
function useSeatingMutation<TInput, TResult>(
  eventId: string,
  run: (input: TInput) => Promise<TResult>,
): UseMutationResult<TResult, Error, TInput> {
  const queryClient = useQueryClient();
  return useMutation<TResult, Error, TInput>({
    mutationFn: run,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: seatingKeys.event(eventId) });
    },
  });
}

export function useSaveSeatMap(eventId: string) {
  return useSeatingMutation<SeatMapInput, string>(eventId, saveSeatMap);
}

export function useDeleteSeatMap(eventId: string) {
  return useSeatingMutation<string, boolean>(eventId, deleteSeatMap);
}

export function useSaveSeatCategory(eventId: string) {
  return useSeatingMutation<SeatCategoryInput, string>(eventId, saveSeatCategory);
}

export function useDeleteSeatCategory(eventId: string) {
  return useSeatingMutation<string, boolean>(eventId, deleteSeatCategory);
}

export function useSaveSeatSection(eventId: string) {
  return useSeatingMutation<SeatSectionInput, SeatSectionSaveResult>(eventId, saveSeatSection);
}

export function useDeleteSeatSection(eventId: string) {
  return useSeatingMutation<string, boolean>(eventId, deleteSeatSection);
}

export function useUpdateSeats(eventId: string) {
  return useSeatingMutation<SeatsUpdateInput, number>(eventId, updateSeats);
}

export function useAssignSeat(eventId: string) {
  return useSeatingMutation<SeatAssignInput, SeatAssignResult>(eventId, assignSeat);
}

export function useAssignSeatsBatch(eventId: string) {
  return useSeatingMutation<
    { mapId: string; source: SeatAssignmentSource; items: readonly SeatBatchItem[] },
    SeatBatchResult
  >(eventId, assignSeatsBatch);
}

export function useReleaseSeats(eventId: string) {
  return useSeatingMutation<SeatReleaseInput, number>(eventId, releaseSeats);
}
