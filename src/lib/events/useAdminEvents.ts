// Hooki listy wydarzen modulu.
//
// DWA ZAPYTANIA, NIE JEDNO. Lista i liczniki zakladek maja rozne filtry:
// licznik MUSI ignorowac zakladke statusu, inaczej zakladka „Szkice" pokazuje
// liczbe szkicow wsrod szkicow. Sklejone w jedno zapytanie daloby licznik
// bezuzyteczny, a rozdzielone dwa klucze cache pozwalaja odswiezyc liste bez
// mrugania liczb w zakladkach.
//
// `now` JEST ZAMROZONE W KLUCZU ZAPYTANIA co do minuty. Granica
// „przyszle/przeszle" liczy sie z zegara, a `Date.now()` w kazdym renderze dawal
// by nowy klucz i nieskonczona petle zapytan. Minuta jest wlasciwa
// rozdzielczoscia: nikt nie patrzy na liste wydarzen z dokladnoscia do sekundy.
import { useMemo } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import type { EventListParams } from "@/lib/events/eventListParams";
import {
  createEventFromType,
  fetchAdminEventCounts,
  fetchAdminEvents,
  type AdminEventCounts,
  type AdminEventListRow,
  type EventCreateInput,
} from "@/lib/events/eventsListApi";
import { eventTypeKeys } from "@/lib/events/useEventTypes";

export const adminEventKeys = {
  all: ["admin-module-events"] as const,
  list: (params: EventListParams, minute: string) =>
    [...adminEventKeys.all, "list", params, minute] as const,
  counts: (params: EventListParams) => [...adminEventKeys.all, "counts", params] as const,
};

const LIST_STALE_MS = 15_000;

/** Znacznik minuty - stabilny klucz cache dla granicy czasu. */
function minuteStamp(now: Date): string {
  return now.toISOString().slice(0, 16);
}

export function useAdminEventsList(
  params: EventListParams,
  now: Date,
): UseQueryResult<AdminEventListRow[], Error> {
  const minute = minuteStamp(now);
  // Data zamrozona na minute - inaczej kazdy render zmienia argumenty RPC.
  const frozen = useMemo(() => new Date(`${minute}:00.000Z`), [minute]);
  return useQuery({
    queryKey: adminEventKeys.list(params, minute),
    queryFn: () => fetchAdminEvents(params, frozen),
    staleTime: LIST_STALE_MS,
  });
}

export function useAdminEventCounts(
  params: EventListParams,
): UseQueryResult<AdminEventCounts, Error> {
  return useQuery({
    queryKey: adminEventKeys.counts(params),
    queryFn: () => fetchAdminEventCounts(params),
    staleTime: LIST_STALE_MS,
  });
}

/**
 * Utworzenie wydarzenia z rodzaju. Uniewaznia liste I liczniki, a takze katalog
 * rodzajow - licznik uzycia rodzaju wlasnie sie zmienil, wiec ekran katalogu
 * pokazywalby stara liczbe i stara blokade kosza.
 */
export function useCreateEventFromType(): UseMutationResult<string, Error, EventCreateInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createEventFromType,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: adminEventKeys.all });
      void qc.invalidateQueries({ queryKey: eventTypeKeys.all });
      // Stara lista w sekcji spolecznosci czyta te same wiersze.
      void qc.invalidateQueries({ queryKey: ["admin-community-events"] });
    },
  });
}
