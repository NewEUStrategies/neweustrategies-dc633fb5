// Hooki panelu organizatora gieldy spotkan 1-1.
//
// JEDNA FABRYKA KLUCZY NA CALY MODUL. Statystyki, lista i konfiguracja czytaja
// te same wiersze z roznych stron: odznaczenie frekwencji zmienia lise ORAZ
// obciazenie stolika ORAZ wskaznik obecnosci. Gdyby kazdy ekran mial wlasny
// literal klucza, po zapisie odswiezalby sie tylko ten, na ktorym stoi kursor,
// a sasiednia zakladka pokazywalaby nieaktualne liczby - i nikt by tego nie
// zauwazyl, bo dane wygladalyby wiarygodnie.
//
// UNIEWAZNIAMY GALAZ WYDARZENIA, NIE POJEDYNCZE ZAPYTANIE. Kazda mutacja tego
// modulu potrafi ruszyc wiecej niz jedna liste, wiec kasowanie calej galezi
// `meetingKeys.event(eventId)` jest zarazem najprostsze i najbezpieczniejsze;
// zapytania sasiednich wydarzen zostaja nietkniete.
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import {
  arrangeMeeting,
  deleteMeetingTable,
  fetchAdminFreeSlots,
  fetchAdminMeetings,
  fetchMeetingSettings,
  fetchMeetingStats,
  fetchMeetingTables,
  saveMeetingSettings,
  saveMeetingTable,
  setMeetingStatus,
  type AdminMeetingRow,
  type AdminMeetingsQuery,
  type MeetingSettings,
  type MeetingSettingsInput,
  type MeetingTableInput,
  type MeetingFreeSlot,
  type MeetingTableRow,
} from "@/lib/events/meetingsApi";
import {
  searchMeetingParticipants,
  type MeetingParticipantOption,
} from "@/lib/events/meetingParticipants";
import { parseMeetingStats, type MeetingStats } from "@/lib/events/meetingsStats";
import type { Json } from "@/integrations/supabase/types";

export const meetingKeys = {
  all: ["event-meetings"] as const,
  event: (eventId: string) => [...meetingKeys.all, eventId] as const,
  tables: (eventId: string) => [...meetingKeys.event(eventId), "tables"] as const,
  settings: (eventId: string) => [...meetingKeys.event(eventId), "settings"] as const,
  stats: (eventId: string) => [...meetingKeys.event(eventId), "stats"] as const,
  list: (query: AdminMeetingsQuery) =>
    [...meetingKeys.event(query.eventId), "list", query] as const,
};

// Lista i statystyki starzeja sie szybko - w dniu wydarzenia organizator patrzy
// na ekran co kilkadziesiat sekund. Konfiguracja i stoliki zmieniaja sie przed
// wydarzeniem, nie w jego trakcie, wiec moga lezec w cache dluzej.
const LIVE_STALE_MS = 15_000;
const SETUP_STALE_MS = 60_000;

/** Puste `eventId` znaczy "organizator jeszcze nie wybral wydarzenia" - nie pytamy bazy. */
function hasEvent(eventId: string | null | undefined): eventId is string {
  return typeof eventId === "string" && eventId.length > 0;
}

export function useMeetingTables(
  eventId: string | null,
): UseQueryResult<MeetingTableRow[], Error> {
  return useQuery({
    queryKey: meetingKeys.tables(eventId ?? ""),
    queryFn: () => fetchMeetingTables(eventId ?? ""),
    enabled: hasEvent(eventId),
    staleTime: SETUP_STALE_MS,
  });
}

export function useMeetingSettings(eventId: string | null): UseQueryResult<MeetingSettings, Error> {
  return useQuery({
    queryKey: meetingKeys.settings(eventId ?? ""),
    queryFn: () => fetchMeetingSettings(eventId ?? ""),
    enabled: hasEvent(eventId),
    staleTime: SETUP_STALE_MS,
  });
}

/**
 * Statystyki gieldy juz sparsowane.
 *
 * `select` biegnie POZA `queryFn`, wiec parsowanie nie powtarza sie przy kazdym
 * renderze komponentu, a surowy `jsonb` nigdy nie wycieka do warstwy widoku.
 */
export function useMeetingStats(eventId: string | null): UseQueryResult<MeetingStats, Error> {
  return useQuery({
    queryKey: meetingKeys.stats(eventId ?? ""),
    queryFn: () => fetchMeetingStats(eventId ?? ""),
    enabled: hasEvent(eventId),
    staleTime: LIVE_STALE_MS,
    select: (raw: Json) => parseMeetingStats(raw),
  });
}

export function useAdminMeetings(
  query: AdminMeetingsQuery,
): UseQueryResult<AdminMeetingRow[], Error> {
  return useQuery({
    queryKey: meetingKeys.list(query),
    queryFn: () => fetchAdminMeetings(query),
    enabled: hasEvent(query.eventId),
    staleTime: LIVE_STALE_MS,
  });
}

function useMeetingInvalidation(eventId: string | null): () => void {
  const qc = useQueryClient();
  return () => {
    if (!hasEvent(eventId)) return;
    void qc.invalidateQueries({ queryKey: meetingKeys.event(eventId) });
  };
}

export function useSaveMeetingTable(
  eventId: string | null,
): UseMutationResult<string, Error, MeetingTableInput> {
  const invalidate = useMeetingInvalidation(eventId);
  return useMutation({ mutationFn: saveMeetingTable, onSuccess: invalidate });
}

export function useDeleteMeetingTable(
  eventId: string | null,
): UseMutationResult<boolean, Error, string> {
  const invalidate = useMeetingInvalidation(eventId);
  return useMutation({ mutationFn: deleteMeetingTable, onSuccess: invalidate });
}

export function useSaveMeetingSettings(
  eventId: string | null,
): UseMutationResult<MeetingSettings, Error, MeetingSettingsInput> {
  const invalidate = useMeetingInvalidation(eventId);
  return useMutation({ mutationFn: saveMeetingSettings, onSuccess: invalidate });
}

export function useSetMeetingStatus(
  eventId: string | null,
): UseMutationResult<
  Json,
  Error,
  { meetingId: string; status: "held" | "no_show" | "cancelled"; reason?: string | null }
> {
  const invalidate = useMeetingInvalidation(eventId);
  return useMutation({ mutationFn: setMeetingStatus, onSuccess: invalidate });
}

export function useArrangeMeeting(
  eventId: string | null,
): UseMutationResult<Json, Error, Parameters<typeof arrangeMeeting>[0]> {
  const invalidate = useMeetingInvalidation(eventId);
  return useMutation({ mutationFn: arrangeMeeting, onSuccess: invalidate });
}

// ---------------------------------------------------------------------------
// DIALOG "UMOW SPOTKANIE": WYSZUKIWARKA OSOB I WSPOLNE WOLNE TERMINY
// ---------------------------------------------------------------------------

/** Lista podpowiedzi zmienia sie tylko przy nowej frazie - trzymamy ja dluzej. */
export function useMeetingParticipants(
  eventId: string | null,
  query: string,
): UseQueryResult<MeetingParticipantOption[], Error> {
  return useQuery({
    queryKey: [...meetingKeys.event(eventId ?? ""), "participants", query] as const,
    queryFn: () => searchMeetingParticipants({ eventId: eventId as string, query }),
    enabled: hasEvent(eventId),
    staleTime: SETUP_STALE_MS,
  });
}

/**
 * Wolne terminy liczy baza dla PARY - dlatego zapytanie rusza dopiero, gdy obie
 * strony sa wybrane, i nigdy nie jest cache'owane dluzej niz kilkanascie sekund:
 * kazde umowione w miedzyczasie spotkanie zabiera miejsce przy stoliku.
 */
export function useMeetingFreeSlots(input: {
  eventId: string | null;
  aRegistrationId: string | null;
  bRegistrationId: string | null;
}): UseQueryResult<MeetingFreeSlot[], Error> {
  const { eventId, aRegistrationId, bRegistrationId } = input;
  const ready =
    hasEvent(eventId) &&
    typeof aRegistrationId === "string" &&
    aRegistrationId.length > 0 &&
    typeof bRegistrationId === "string" &&
    bRegistrationId.length > 0 &&
    aRegistrationId !== bRegistrationId;
  return useQuery({
    queryKey: [
      ...meetingKeys.event(eventId ?? ""),
      "free-slots",
      aRegistrationId,
      bRegistrationId,
    ] as const,
    queryFn: () =>
      fetchAdminFreeSlots({
        eventId: eventId as string,
        aRegistrationId: aRegistrationId as string,
        bRegistrationId: bRegistrationId as string,
      }),
    enabled: ready,
    staleTime: LIVE_STALE_MS,
  });
}
