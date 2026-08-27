// Hooki panelu agendy: sesje, sciezki, sale, obsada, zapisy i kolizje.
//
// JEDNA FABRYKA KLUCZY NA CALY MODUL. Zapis sesji zmienia liste sesji ORAZ
// liczniki sciezki ORAZ zajetosc sali ORAZ raport kolizji. Gdyby kazdy ekran
// mial wlasny literal klucza, po zapisie odswiezalby sie tylko ten, na ktorym
// stoi kursor, a zakladka kolizji pokazywalaby konflikt, ktorego juz nie ma.
//
// UNIEWAZNIAMY GALAZ WYDARZENIA, NIE POJEDYNCZE ZAPYTANIE - kazda mutacja tego
// modulu potrafi ruszyc wiecej niz jedna liste; zapytania innych wydarzen
// zostaja nietkniete.
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import {
  deleteEventRoom,
  deleteEventSession,
  deleteEventTrack,
  fetchAgendaConflicts,
  fetchEventRooms,
  fetchEventSessions,
  fetchEventTracks,
  fetchSessionDetail,
  fetchSessionSignups,
  reorderSessions,
  saveEventRoom,
  saveEventSession,
  saveEventTrack,
  setSessionSignup,
  setSessionSpeakers,
  setSessionsStatus,
  type AgendaConflictRow,
  type EventRoomInput,
  type EventRoomRow,
  type EventSessionDetailRow,
  type EventSessionInput,
  type EventSessionRow,
  type EventSessionSignupRow,
  type EventTrackInput,
  type EventTrackRow,
  type SessionOrderItem,
  type SessionSignupInput,
  type SessionSpeakerInput,
  type SessionsQuery,
  type SessionsStatusInput,
} from "@/lib/events/sessionsApi";
import type { Json } from "@/integrations/supabase/types";

export const agendaKeys = {
  all: ["event-agenda"] as const,
  event: (eventId: string) => [...agendaKeys.all, eventId] as const,
  // KLUCZ PRZYJMUJE `null`, BO ZAPYTANIE BYWA WYLACZONE. Wczesniej wolajacy
  // podstawial atrape `{ eventId: "none" }` przez `as unknown as` - rzutowanie
  // klamalo o ksztalcie (brakowalo czterech pol), a klucz i tak byl sztuczny.
  // `null` jest tu PRAWDA: zapytanie z `enabled: false` nie ma zapytania.
  sessions: (query: SessionsQuery | null) =>
    query === null
      ? ([...agendaKeys.all, "sessions", "idle"] as const)
      : ([...agendaKeys.event(query.eventId), "sessions", query] as const),
  tracks: (eventId: string) => [...agendaKeys.event(eventId), "tracks"] as const,
  rooms: (eventId: string) => [...agendaKeys.event(eventId), "rooms"] as const,
  conflicts: (eventId: string) => [...agendaKeys.event(eventId), "conflicts"] as const,
  session: (sessionId: string) => [...agendaKeys.all, "session", sessionId] as const,
  signups: (sessionId: string) => [...agendaKeys.all, "session", sessionId, "signups"] as const,
};

// Program zmienia sie PRZED wydarzeniem, wiec sesje i katalogi moga lezec w
// cache dluzej. Zapisy na sesje i kolizje starzeja sie szybko - w dniu
// wydarzenia organizator patrzy na nie co kilkadziesiat sekund.
const CONFIG_STALE_MS = 60_000;
const LIVE_STALE_MS = 15_000;

export function useEventSessions(query: SessionsQuery | null): UseQueryResult<EventSessionRow[]> {
  return useQuery({
    queryKey: agendaKeys.sessions(query),
    queryFn: () => fetchEventSessions(query as SessionsQuery),
    enabled: query !== null,
    staleTime: CONFIG_STALE_MS,
  });
}

export function useEventTracks(eventId: string | null): UseQueryResult<EventTrackRow[]> {
  return useQuery({
    queryKey: agendaKeys.tracks(eventId ?? "none"),
    queryFn: () => fetchEventTracks(eventId as string),
    enabled: eventId !== null,
    staleTime: CONFIG_STALE_MS,
  });
}

export function useEventRooms(eventId: string | null): UseQueryResult<EventRoomRow[]> {
  return useQuery({
    queryKey: agendaKeys.rooms(eventId ?? "none"),
    queryFn: () => fetchEventRooms(eventId as string),
    enabled: eventId !== null,
    staleTime: CONFIG_STALE_MS,
  });
}

export function useAgendaConflicts(eventId: string | null): UseQueryResult<AgendaConflictRow[]> {
  return useQuery({
    queryKey: agendaKeys.conflicts(eventId ?? "none"),
    queryFn: () => fetchAgendaConflicts(eventId as string),
    enabled: eventId !== null,
    staleTime: LIVE_STALE_MS,
  });
}

export function useSessionDetail(
  sessionId: string | null,
): UseQueryResult<EventSessionDetailRow | null> {
  return useQuery({
    queryKey: agendaKeys.session(sessionId ?? "none"),
    queryFn: () => fetchSessionDetail(sessionId as string),
    enabled: sessionId !== null,
    staleTime: CONFIG_STALE_MS,
  });
}

export function useSessionSignups(
  sessionId: string | null,
): UseQueryResult<EventSessionSignupRow[]> {
  return useQuery({
    queryKey: agendaKeys.signups(sessionId ?? "none"),
    queryFn: () => fetchSessionSignups(sessionId as string),
    enabled: sessionId !== null,
    staleTime: LIVE_STALE_MS,
  });
}

/** Wspolne uniewaznienie - kazda mutacja agendy rusza wiecej niz jedna liste. */
function useInvalidateEvent(): (eventId: string) => Promise<void> {
  const queryClient = useQueryClient();
  return async (eventId: string) => {
    await queryClient.invalidateQueries({ queryKey: agendaKeys.event(eventId) });
    // DRUGIE UNIEWAZNIENIE, BO SZCZEGOL LEZY POZA GALEZIA WYDARZENIA.
    // `agendaKeys.session(id)` to `["event-agenda", "session", id]`, a wiec NIE
    // ma przedrostka `agendaKeys.event(eventId)` - sam pierwszy wiersz zostawial
    // szczegol w cache na `CONFIG_STALE_MS`. Dialog edycji czyta wlasnie
    // szczegol (to on niesie `stream_url` i `recording_url`, odciete od
    // klienckiego SELECT-a), wiec bez tej linii ponowne otwarcie sesji zaraz
    // po zapisie pokazywaloby WARTOSC SPRZED zapisu - i odsylalo ja z powrotem.
    await queryClient.invalidateQueries({ queryKey: [...agendaKeys.all, "session"] });
  };
}

export function useSaveEventSession(
  eventId: string,
): UseMutationResult<string, Error, EventSessionInput> {
  const invalidate = useInvalidateEvent();
  return useMutation({
    mutationFn: saveEventSession,
    onSuccess: () => invalidate(eventId),
  });
}

export function useDeleteEventSession(eventId: string): UseMutationResult<boolean, Error, string> {
  const invalidate = useInvalidateEvent();
  return useMutation({
    mutationFn: deleteEventSession,
    onSuccess: () => invalidate(eventId),
  });
}

export function useReorderSessions(
  eventId: string,
): UseMutationResult<number, Error, readonly SessionOrderItem[]> {
  const invalidate = useInvalidateEvent();
  return useMutation({
    mutationFn: reorderSessions,
    onSuccess: () => invalidate(eventId),
  });
}

export function useSetSessionsStatus(
  eventId: string,
): UseMutationResult<number, Error, SessionsStatusInput> {
  const invalidate = useInvalidateEvent();
  return useMutation({
    mutationFn: setSessionsStatus,
    onSuccess: () => invalidate(eventId),
  });
}

export function useSetSessionsTrack(
  eventId: string,
): UseMutationResult<number, Error, SessionsTrackInput> {
  const invalidate = useInvalidateEvent();
  return useMutation({
    mutationFn: setSessionsTrack,
    onSuccess: () => invalidate(eventId),
  });
}



export function useSaveEventTrack(
  eventId: string,
): UseMutationResult<string, Error, EventTrackInput> {
  const invalidate = useInvalidateEvent();
  return useMutation({
    mutationFn: saveEventTrack,
    onSuccess: () => invalidate(eventId),
  });
}

export function useDeleteEventTrack(eventId: string): UseMutationResult<boolean, Error, string> {
  const invalidate = useInvalidateEvent();
  return useMutation({
    mutationFn: deleteEventTrack,
    onSuccess: () => invalidate(eventId),
  });
}

export function useSaveEventRoom(
  eventId: string,
): UseMutationResult<string, Error, EventRoomInput> {
  const invalidate = useInvalidateEvent();
  return useMutation({
    mutationFn: saveEventRoom,
    onSuccess: () => invalidate(eventId),
  });
}

export function useDeleteEventRoom(eventId: string): UseMutationResult<boolean, Error, string> {
  const invalidate = useInvalidateEvent();
  return useMutation({
    mutationFn: deleteEventRoom,
    onSuccess: () => invalidate(eventId),
  });
}

export interface SetSessionSpeakersVariables {
  sessionId: string;
  speakers: readonly SessionSpeakerInput[];
}

export function useSetSessionSpeakers(
  eventId: string,
): UseMutationResult<number, Error, SetSessionSpeakersVariables> {
  const invalidate = useInvalidateEvent();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables) => setSessionSpeakers(variables.sessionId, variables.speakers),
    onSuccess: async (_result, variables) => {
      // Obsada zmienia raport kolizji prelegentow, wiec galaz wydarzenia idzie
      // do uniewaznienia razem ze szczegolem sesji.
      await queryClient.invalidateQueries({ queryKey: agendaKeys.session(variables.sessionId) });
      await invalidate(eventId);
    },
  });
}

export function useSetSessionSignup(
  eventId: string,
): UseMutationResult<Json, Error, SessionSignupInput> {
  const invalidate = useInvalidateEvent();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: setSessionSignup,
    onSuccess: async (_result, variables) => {
      await queryClient.invalidateQueries({ queryKey: agendaKeys.signups(variables.sessionId) });
      await invalidate(eventId);
    },
  });
}
