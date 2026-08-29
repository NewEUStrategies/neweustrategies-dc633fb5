// Hooki PLASZCZYZNY UCZESTNIKA gieldy spotkan 1-1.
//
// OSOBNA FABRYKA KLUCZY NIZ PANEL ORGANIZATORA, I TO JEST CELOWE. Panel
// identyfikuje wydarzenie przez `eventId` (organizator wybiera je z listy),
// uczestnik wchodzi z adresu, czyli przez `slug`. Wspolna fabryka musialaby
// przyjmowac jedno albo drugie i przy pierwszym uniewaznieniu rozjechalaby sie
// po cichu: `event(slug)` nigdy nie zrownuje sie z `event(uuid)`, wiec zapis
// okna dostepnosci odswiezalby galaz, ktorej nikt nie czyta.
//
// KAZDA MUTACJA UNIEWAZNIA CALA GALAZ WYDARZENIA. Przyjecie zaproszenia zmienia
// jednoczesnie: liste spotkan, licznik w naglowku (`invites_used`, podsumowanie)
// oraz zbior wolnych terminow kazdej pary - bo miejsce przy stoliku wlasnie
// znikelo. Punktowe uniewaznienie listy zostawialoby na ekranie licznik sprzed
// decyzji, czyli liczbe wygladajaca wiarygodnie i nieprawdziwa.
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import {
  cancelMeeting,
  deleteMyAvailability,
  fetchMeetingExchange,
  fetchMeetingDirectory,
  fetchMyFreeSlots,
  fetchMyMeetings,
  inviteToMeeting,
  respondToMeeting,
  rescheduleMeeting,
  saveMyAvailability,
  setMeetingDirectoryVisibility,
  type MeetingFreeSlot,
  type MeetingStatusFilter,
  type MyMeetingRow,
} from "@/lib/events/meetingsApi";
import { parseMeetingExchange, type MeetingExchange } from "@/lib/events/meetingExchange";
import type { MeetingDirectory } from "@/lib/events/meetingDirectory";
import type { Json } from "@/integrations/supabase/types";

export const myMeetingKeys = {
  all: ["event-meetings-mine"] as const,
  event: (slug: string) => [...myMeetingKeys.all, slug] as const,
  exchange: (slug: string) => [...myMeetingKeys.event(slug), "exchange"] as const,
  list: (slug: string, status: MeetingStatusFilter) =>
    [...myMeetingKeys.event(slug), "list", status] as const,
  slots: (slug: string, counterpartRegistrationId: string) =>
    [...myMeetingKeys.event(slug), "slots", counterpartRegistrationId] as const,
  directory: (slug: string, q: string, groupId: string | null, offset: number) =>
    [...myMeetingKeys.event(slug), "directory", q, groupId ?? "all", offset] as const,
};

// Uczestnik patrzy na ten ekran w dniu wydarzenia, miedzy sesjami - dane maja
// byc swieze, a nie oszczedne. Wolne terminy znikaja najszybciej ze wszystkiego,
// bo zabiera je kazda para, ktora wlasnie sie umowila.
const STATE_STALE_MS = 20_000;
const SLOTS_STALE_MS = 10_000;

function hasSlug(slug: string | null | undefined): slug is string {
  return typeof slug === "string" && slug.length > 0;
}

/** Caly stan gieldy jednym wywolaniem, juz sparsowany (surowy `jsonb` nie wychodzi z tej warstwy). */
export function useMeetingExchange(slug: string | null): UseQueryResult<MeetingExchange, Error> {
  return useQuery({
    queryKey: myMeetingKeys.exchange(slug ?? ""),
    queryFn: () => fetchMeetingExchange({ eventSlug: slug as string }),
    enabled: hasSlug(slug),
    staleTime: STATE_STALE_MS,
    select: (raw: Json) => parseMeetingExchange(raw),
    // Uczestnik niezapisany na wydarzenie dostaje z bazy `not_registered` -
    // ponawianie takiego zapytania nie zmieni odpowiedzi, a opozni komunikat.
    retry: false,
  });
}

export function useMyMeetings(
  slug: string | null,
  status: MeetingStatusFilter = "all",
): UseQueryResult<MyMeetingRow[], Error> {
  return useQuery({
    queryKey: myMeetingKeys.list(slug ?? "", status),
    queryFn: () => fetchMyMeetings({ eventSlug: slug as string, status }),
    enabled: hasSlug(slug),
    staleTime: STATE_STALE_MS,
    retry: false,
  });
}

/** Wspolne wolne terminy z JEDNYM rozmowca; liczy je baza, bo tylko ona zna stan stolikow. */
export function useMyFreeSlots(input: {
  slug: string | null;
  counterpartRegistrationId: string | null;
}): UseQueryResult<MeetingFreeSlot[], Error> {
  const { slug, counterpartRegistrationId } = input;
  const ready =
    hasSlug(slug) &&
    typeof counterpartRegistrationId === "string" &&
    counterpartRegistrationId.length > 0;
  return useQuery({
    queryKey: myMeetingKeys.slots(slug ?? "", counterpartRegistrationId ?? ""),
    queryFn: () =>
      fetchMyFreeSlots({
        eventSlug: slug as string,
        counterpartRegistrationId: counterpartRegistrationId as string,
      }),
    enabled: ready,
    staleTime: SLOTS_STALE_MS,
    retry: false,
  });
}

function useMyInvalidation(slug: string | null): () => void {
  const qc = useQueryClient();
  return () => {
    if (!hasSlug(slug)) return;
    void qc.invalidateQueries({ queryKey: myMeetingKeys.event(slug) });
  };
}

export function useSaveMyAvailability(
  slug: string | null,
): UseMutationResult<string, Error, Parameters<typeof saveMyAvailability>[0]> {
  const invalidate = useMyInvalidation(slug);
  return useMutation({ mutationFn: saveMyAvailability, onSuccess: invalidate });
}

export function useDeleteMyAvailability(
  slug: string | null,
): UseMutationResult<boolean, Error, string> {
  const invalidate = useMyInvalidation(slug);
  return useMutation({ mutationFn: deleteMyAvailability, onSuccess: invalidate });
}

export function useInviteToMeeting(
  slug: string | null,
): UseMutationResult<Json, Error, Parameters<typeof inviteToMeeting>[0]> {
  const invalidate = useMyInvalidation(slug);
  return useMutation({ mutationFn: inviteToMeeting, onSuccess: invalidate });
}

export function useRespondToMeeting(
  slug: string | null,
): UseMutationResult<Json, Error, Parameters<typeof respondToMeeting>[0]> {
  const invalidate = useMyInvalidation(slug);
  return useMutation({ mutationFn: respondToMeeting, onSuccess: invalidate });
}

export function useCancelMyMeeting(
  slug: string | null,
): UseMutationResult<Json, Error, Parameters<typeof cancelMeeting>[0]> {
  const invalidate = useMyInvalidation(slug);
  return useMutation({ mutationFn: cancelMeeting, onSuccess: invalidate });
}

export function useRescheduleMyMeeting(
  slug: string | null,
): UseMutationResult<Json, Error, Parameters<typeof rescheduleMeeting>[0]> {
  const invalidate = useMyInvalidation(slug);
  return useMutation({ mutationFn: rescheduleMeeting, onSuccess: invalidate });
}

/**
 * Katalog uczestnikow gieldy.
 *
 * `staleTime` jest KROTKI, bo lista niesie stan rozmowy miedzy nami a kazda
 * osoba - a ten zmienia sie dokladnie w chwili, w ktorej ktos przyjmie albo
 * odrzuci zaproszenie. Nieaktualny stan pokazalby przycisk "Zapros" komus,
 * z kim juz jestesmy umowieni.
 */
export function useMeetingDirectory(
  slug: string | null,
  input: { q: string; groupId: string | null; offset: number; limit: number },
  enabled = true,
): UseQueryResult<MeetingDirectory, Error> {
  return useQuery({
    queryKey: myMeetingKeys.directory(slug ?? "", input.q, input.groupId, input.offset),
    queryFn: () =>
      fetchMeetingDirectory({
        eventSlug: slug ?? "",
        q: input.q === "" ? undefined : input.q,
        groupId: input.groupId,
        limit: input.limit,
        offset: input.offset,
      }),
    enabled: enabled && hasSlug(slug),
    staleTime: STATE_STALE_MS,
    // POPRZEDNIE OKNO ZOSTAJE NA EKRANIE W TRAKCIE ZMIANY FRAZY LUB STRONY.
    // Fraza, grupa i offset siedza w KLUCZU zapytania, wiec kazde nacisniecie
    // klawisza trafialo w pusta szuflade: `isPending` znowu stawalo sie prawda,
    // a `ParticipantDirectoryPanel` ma na tym warunku wczesny zwrot ze
    // szkieletem PRZED naglowkiem i filtrami. Skutek dla uczestnika: pole
    // wyszukiwania znikalo razem z lista, tracilo fokus, a kolejne znaki lecialy
    // w prozne. Ten sam wzorzec i z tego samego powodu stoi w
    // `lib/experts/materials.ts`.
    placeholderData: keepPreviousData,
  });
}

/** Wlasna obecnosc w katalogu; po zmianie lista i stan gieldy sa nieaktualne. */
export function useSetDirectoryVisibility(
  slug: string,
): UseMutationResult<boolean, Error, boolean> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (listed: boolean) => setMeetingDirectoryVisibility({ eventSlug: slug, listed }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: myMeetingKeys.event(slug) });
    },
  });
}
