// Hooki panelu zapisow i biletow wydarzenia.
//
// JEDNA FABRYKA KLUCZY NA CALY MODUL. Zatwierdzenie zgloszenia zmienia lise ORAZ
// liczniki statusow ORAZ liczbe sprzedanych miejsc na bilecie. Gdyby kazdy ekran
// mial wlasny literal klucza, po decyzji odswiezalby sie tylko ten, na ktorym
// stoi kursor, a zakladka obok pokazywalaby nieaktualna pule - i nikt by tego nie
// zauwazyl, bo liczby wygladalyby wiarygodnie.
//
// UNIEWAZNIAMY GALAZ WYDARZENIA, NIE POJEDYNCZE ZAPYTANIE. Kazda mutacja tego
// modulu potrafi ruszyc wiecej niz jedna lise (promocja z rezerwy rusza
// wszystkie trzy), wiec kasowanie `registrationKeys.event(eventId)` jest zarazem
// najprostsze i najbezpieczniejsze; zapytania innych wydarzen zostaja nietkniete.
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import {
  decideRegistration,
  deleteEventTicket,
  deleteRegistrationField,
  fetchEventTickets,
  fetchRegistrationCounts,
  fetchRegistrationFields,
  fetchRegistrations,
  markRegistrationsNotified,
  promoteFromWaitlist,
  saveEventTicket,
  saveRegistration,
  saveRegistrationField,
  type EventRegistrationFieldRow,
  type EventTicketInput,
  type EventTicketRow,
  type RegistrationCountsQuery,
  type RegistrationDecisionInput,
  type RegistrationFieldInput,
  type RegistrationUpsertInput,
  type RegistrationsPage,
  type RegistrationsQuery,
  type WaitlistPromoteInput,
} from "@/lib/events/registrationsApi";
import { parseRegistrationCounts, type RegistrationCounts } from "@/lib/events/registrationCounts";
import type { Json } from "@/integrations/supabase/types";

export const registrationKeys = {
  all: ["event-registrations"] as const,
  event: (eventId: string) => [...registrationKeys.all, eventId] as const,
  tickets: (eventId: string) => [...registrationKeys.event(eventId), "tickets"] as const,
  fields: (eventId: string) => [...registrationKeys.event(eventId), "fields"] as const,
  // OBA KLUCZE PRZYJMUJA `null` - patrz uzasadnienie przy `agendaKeys.sessions`.
  // Atrapa `{ eventId: "none" }` wymagala rzutowania `as unknown as`, bo nie
  // miala pozostalych pol zapytania; `null` opisuje stan wylaczenia wprost.
  counts: (query: RegistrationCountsQuery | null) =>
    query === null
      ? ([...registrationKeys.all, "counts", "idle"] as const)
      : ([...registrationKeys.event(query.eventId), "counts", query] as const),
  list: (query: RegistrationsQuery | null) =>
    query === null
      ? ([...registrationKeys.all, "list", "idle"] as const)
      : ([...registrationKeys.event(query.eventId), "list", query] as const),
};

// Lista i liczniki starzeja sie szybko - w dniu wydarzenia organizator patrzy na
// ekran co kilkadziesiat sekund. Bilety i pola formularza zmieniaja sie PRZED
// wydarzeniem, wiec moga lezec w cache dluzej.
const LIVE_STALE_MS = 15_000;
const CONFIG_STALE_MS = 60_000;

export function useEventTickets(eventId: string | null): UseQueryResult<EventTicketRow[]> {
  return useQuery({
    queryKey: registrationKeys.tickets(eventId ?? "none"),
    queryFn: () => fetchEventTickets(eventId as string),
    enabled: eventId !== null,
    staleTime: CONFIG_STALE_MS,
  });
}

export function useRegistrationFields(
  eventId: string | null,
): UseQueryResult<EventRegistrationFieldRow[]> {
  return useQuery({
    queryKey: registrationKeys.fields(eventId ?? "none"),
    queryFn: () => fetchRegistrationFields(eventId as string),
    enabled: eventId !== null,
    staleTime: CONFIG_STALE_MS,
  });
}

export function useRegistrationsList(
  query: RegistrationsQuery | null,
): UseQueryResult<RegistrationsPage> {
  return useQuery({
    queryKey: registrationKeys.list(query),
    queryFn: () => fetchRegistrations(query as RegistrationsQuery),
    enabled: query !== null,
    staleTime: LIVE_STALE_MS,
  });
}

export function useRegistrationCounts(
  query: RegistrationCountsQuery | null,
): UseQueryResult<RegistrationCounts> {
  return useQuery({
    queryKey: registrationKeys.counts(query),
    queryFn: async () =>
      parseRegistrationCounts(await fetchRegistrationCounts(query as RegistrationCountsQuery)),
    enabled: query !== null,
    staleTime: LIVE_STALE_MS,
  });
}

/** Wspolne uniewaznienie - kazda mutacja tego modulu rusza wiecej niz jedna lise. */
function useInvalidateEvent(): (eventId: string) => Promise<void> {
  const queryClient = useQueryClient();
  return async (eventId: string) => {
    await queryClient.invalidateQueries({ queryKey: registrationKeys.event(eventId) });
  };
}

export function useSaveEventTicket(
  eventId: string,
): UseMutationResult<string, Error, EventTicketInput> {
  const invalidate = useInvalidateEvent();
  return useMutation({
    mutationFn: saveEventTicket,
    onSuccess: () => invalidate(eventId),
  });
}

export function useDeleteEventTicket(eventId: string): UseMutationResult<boolean, Error, string> {
  const invalidate = useInvalidateEvent();
  return useMutation({
    mutationFn: deleteEventTicket,
    onSuccess: () => invalidate(eventId),
  });
}

export function useSaveRegistrationField(
  eventId: string,
): UseMutationResult<string, Error, RegistrationFieldInput> {
  const invalidate = useInvalidateEvent();
  return useMutation({
    mutationFn: saveRegistrationField,
    onSuccess: () => invalidate(eventId),
  });
}

export function useDeleteRegistrationField(
  eventId: string,
): UseMutationResult<boolean, Error, string> {
  const invalidate = useInvalidateEvent();
  return useMutation({
    mutationFn: deleteRegistrationField,
    onSuccess: () => invalidate(eventId),
  });
}

export function useDecideRegistration(
  eventId: string,
): UseMutationResult<Json, Error, RegistrationDecisionInput> {
  const invalidate = useInvalidateEvent();
  return useMutation({
    mutationFn: decideRegistration,
    onSuccess: () => invalidate(eventId),
  });
}

export function useSaveRegistration(
  eventId: string,
): UseMutationResult<string, Error, RegistrationUpsertInput> {
  const invalidate = useInvalidateEvent();
  return useMutation({
    mutationFn: saveRegistration,
    onSuccess: () => invalidate(eventId),
  });
}

export function usePromoteFromWaitlist(
  eventId: string,
): UseMutationResult<Json, Error, WaitlistPromoteInput> {
  const invalidate = useInvalidateEvent();
  return useMutation({
    mutationFn: promoteFromWaitlist,
    onSuccess: () => invalidate(eventId),
  });
}

export function useMarkRegistrationsNotified(
  eventId: string,
): UseMutationResult<number, Error, readonly string[]> {
  const invalidate = useInvalidateEvent();
  return useMutation({
    mutationFn: markRegistrationsNotified,
    onSuccess: () => invalidate(eventId),
  });
}
