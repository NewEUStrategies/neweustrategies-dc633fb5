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
//
// PONOWNA WYSYLKA BILETU TEZ UNIEWAZNIA GALAZ. Zmienia znacznik wysylki, ktory
// panel czyta z `admin_event_registration_group_links` - a to zapytanie siedzi
// pod `registrationKeys.event(eventId)`, wiec decyzja organizatora odswieza je
// razem z lista.
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  decideRegistration,
  deleteEventTicket,
  deleteRegistrationField,
  fetchEventTickets,
  fetchRegistrationCounts,
  fetchRegistrationFields,
  fetchRegistrationGroupLinks,
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
  type RegistrationGroupLink,
  type RegistrationUpsertInput,
  type RegistrationsPage,
  type RegistrationsQuery,
  type WaitlistPromoteInput,
} from "@/lib/events/registrationsApi";
import { parseRegistrationCounts, type RegistrationCounts } from "@/lib/events/registrationCounts";
import { resendEventTicket } from "@/lib/events/ticketResend.functions";
import type { Json } from "@/integrations/supabase/types";

/**
 * Fraza w kluczu jest PRZYCIETA, bo warstwa API i tak wysyla ja przez
 * `trimmedOrNull` (`registrationsApi.ts` - `p_q: trimmedOrNull(query.q) ??
 * undefined`). "Kowalska" i "Kowalska " pytaja baze o dokladnie te same
 * wiersze, wiec musza trafiac do JEDNEJ szuflady; tak samo "" i " ", ktore dla
 * bazy oba znacza brak filtra. Bez przyciecia spacja doklejona przy wklejeniu
 * nazwiska ze schowka kasuje trafienie w pamiec i lista ORAZ liczniki id do
 * bazy jeszcze raz - w dniu wydarzenia organizator dostaje kreciolek zamiast
 * danych, ktore juz ma.
 */
function withTrimmedQ<T extends { q: string }>(query: T): T {
  return { ...query, q: query.q.trim() };
}

export const registrationKeys = {
  all: ["event-registrations"] as const,
  event: (eventId: string) => [...registrationKeys.all, eventId] as const,
  tickets: (eventId: string) => [...registrationKeys.event(eventId), "tickets"] as const,
  fields: (eventId: string) => [...registrationKeys.event(eventId), "fields"] as const,
  // Strona listy jest czescia klucza: inna strona = inne wiersze powiazan.
  groupLinks: (eventId: string, registrationIds: readonly string[]) =>
    [...registrationKeys.event(eventId), "group-links", registrationIds] as const,
  // OBA KLUCZE PRZYJMUJA `null` - patrz uzasadnienie przy `agendaKeys.sessions`.
  // Atrapa `{ eventId: "none" }` wymagala rzutowania `as unknown as`, bo nie
  // miala pozostalych pol zapytania; `null` opisuje stan wylaczenia wprost.
  counts: (query: RegistrationCountsQuery | null) =>
    query === null
      ? ([...registrationKeys.all, "counts", "idle"] as const)
      : ([...registrationKeys.event(query.eventId), "counts", withTrimmedQ(query)] as const),
  list: (query: RegistrationsQuery | null) =>
    query === null
      ? ([...registrationKeys.all, "list", "idle"] as const)
      : ([...registrationKeys.event(query.eventId), "list", withTrimmedQ(query)] as const),
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

/**
 * Kto jest gosciem kogo i czy bilet wyszedl - dla wierszy widocznej strony.
 * Okno swiezosci jak lista: znacznik wysylki zmienia sie w sekundy po decyzji
 * organizatora (bilety wychodza zaraz po niej) i w dniu wydarzenia organizator
 * patrzy na niego co chwila.
 */
export function useRegistrationGroupLinks(
  eventId: string | null,
  registrationIds: readonly string[],
): UseQueryResult<RegistrationGroupLink[]> {
  return useQuery({
    queryKey: registrationKeys.groupLinks(eventId ?? "none", registrationIds),
    queryFn: () => fetchRegistrationGroupLinks(eventId as string, registrationIds),
    enabled: eventId !== null,
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

export interface TicketResendInput {
  registrationId: string;
  /** `true` = bilety calej przyjetej grupy (od prowadzacego), `false` = tylko ten wiersz. */
  includeGroup: boolean;
}

/**
 * Ponowna wysylka biletu z kodem QR. Zwraca liczbe wyslanych maili; odmowa bazy
 * (`ticket_not_issuable`, `not_found`, `forbidden`) staje sie WYJATKIEM, zeby
 * panel pokazal ja tym samym slownikiem odmow, co reszte decyzji.
 */
export function useResendEventTicket(
  eventId: string,
): UseMutationResult<number, Error, TicketResendInput> {
  const invalidate = useInvalidateEvent();
  const resend = useServerFn(resendEventTicket);
  return useMutation({
    mutationFn: async (input: TicketResendInput) => {
      const result = await resend({ data: input });
      if (!result.ok) throw new Error(result.error);
      return result.sent;
    },
    onSuccess: () => invalidate(eventId),
  });
}
