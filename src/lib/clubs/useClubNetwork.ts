// Discussion Club - hooki warstwy SIECIUJACEJ (A32).
//
// REGULA INWALIDACJI. Mutacje tablicy ogloszen i deklaracji kompetencji
// uniewazniaja KORZEN klubu (`clubKeys.club(id)`), a nie pojedyncza galaz -
// ta sama doktryna, co w `useClubWorkspace`. Powod jest tu jeszcze mocniejszy:
// deklaracja kompetencji zmienia jednoczesnie panel skladu (tagi przy twarzy),
// modul "poznaj czlonka" (kryterium doboru) i panel ekspertow w KAZDYM
// otwartym watku. Punktowa inwalidacja musialaby trafiac w trzy klucze naraz,
// a wtedy czwarty zostanie kiedys pominiety.
//
// Wyjatkiem jest prosba o zdanie: dotyczy JEDNEGO watku i nie zmienia niczego
// w klubie, wiec unieważnia wylacznie galaz tego watku.
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import {
  closeClubBoardNotice,
  createClubBoardNotice,
  deleteClubSpotlight,
  fetchClubBoardNotices,
  fetchClubEvent,
  fetchClubEventAttendees,
  fetchClubExperts,
  fetchClubExpertiseAreas,
  fetchClubOutput,
  fetchClubRosterSignal,
  fetchClubSpotlight,
  fetchClubSpotlightHistory,
  fetchClubThreadExperts,
  fetchMyClubExpertise,
  pinClubSpotlight,
  pingClubThreadExpert,
  setMyClubExpertise,
  type ClubBoardPage,
  type ClubExpertsPage,
  type ClubNoticeCreateInput,
  type ClubOutputPage,
  type ClubSpotlightPinInput,
} from "./networkApi";
import { clubKeys } from "./queryKeys";
import type {
  ClubEventAttendeeRow,
  ClubEventViewRow,
  ClubExpertiseArea,
  ClubNoticeKind,
  ClubRosterSignal,
  ClubSpotlightHistoryRow,
  ClubSpotlightRow,
  ClubThreadExpertRow,
} from "./networkTypes";

/** Jedno miejsce na regule inwalidacji klubu - patrz naglowek pliku. */
function invalidateClub(qc: QueryClient, clubId: string): void {
  void qc.invalidateQueries({ queryKey: clubKeys.club(clubId) });
}

// ---------------------------------------------------------------------------
// Ogloszenia "szukam / oferuje"
// ---------------------------------------------------------------------------

/**
 * Zakres tablicy. Nazwa semantyczna, a nie para booleanów, bo to jest wybór
 * ZAKŁADKI na ekranie, a nie dwa niezależne przełączniki: "moje archiwum"
 * i "otwarte moje" to dwa różne widoki, a `mine + includeClosed` w dowolnej
 * kombinacji dawałoby cztery, z czego dwa bez sensu produktowego.
 */
export type ClubBoardScope = "open" | "mine" | "archive";

function scopeFlags(scope: ClubBoardScope): { mine: boolean; includeClosed: boolean } {
  if (scope === "mine") return { mine: true, includeClosed: true };
  if (scope === "archive") return { mine: false, includeClosed: true };
  return { mine: false, includeClosed: false };
}

export function useClubBoardNotices(params: {
  clubId: string | undefined;
  kind?: ClubNoticeKind | null;
  topic?: string | null;
  limit?: number;
  offset?: number;
  scope?: ClubBoardScope;
}): UseQueryResult<ClubBoardPage, Error> {
  const { clubId, kind = null, topic = null, limit = 8, offset = 0, scope = "open" } = params;
  const flags = scopeFlags(scope);
  return useQuery({
    queryKey: clubKeys.board(clubId ?? "none", kind, topic, scope, offset, limit),
    queryFn: () =>
      fetchClubBoardNotices({ clubId: clubId ?? "", kind, topic, limit, offset, ...flags }),
    enabled: clubId !== undefined && clubId !== "",
    // Krotko, bo tablica ogloszen jest powierzchnia, na ktorej swiezosc JEST
    // trescia: ogloszenie sprzed godziny i sprzed tygodnia to dwie rozne
    // wiadomosci o tym samym klubie.
    staleTime: 20_000,
  });
}

export function useCreateClubBoardNotice(
  clubId: string,
): UseMutationResult<string, Error, Omit<ClubNoticeCreateInput, "clubId">> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<ClubNoticeCreateInput, "clubId">) =>
      createClubBoardNotice({ ...input, clubId }),
    onSuccess: () => invalidateClub(qc, clubId),
  });
}

export function useCloseClubBoardNotice(clubId: string): UseMutationResult<boolean, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: closeClubBoardNotice,
    onSuccess: () => invalidateClub(qc, clubId),
  });
}

// ---------------------------------------------------------------------------
// Kompetencje
// ---------------------------------------------------------------------------

export function useMyClubExpertise(clubId: string | undefined): UseQueryResult<string[], Error> {
  return useQuery({
    queryKey: clubKeys.myExpertise(clubId ?? "none"),
    queryFn: () => fetchMyClubExpertise(clubId ?? ""),
    enabled: clubId !== undefined && clubId !== "",
    staleTime: 5 * 60_000,
  });
}

export function useSetMyClubExpertise(
  clubId: string,
): UseMutationResult<number, Error, readonly string[]> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (topics: readonly string[]) => setMyClubExpertise(clubId, topics),
    onSuccess: () => invalidateClub(qc, clubId),
  });
}

export function useClubThreadExperts(params: {
  threadId: string | undefined;
  limit?: number;
}): UseQueryResult<ClubThreadExpertRow[], Error> {
  const { threadId, limit = 6 } = params;
  return useQuery({
    queryKey: clubKeys.threadExperts(threadId ?? "none"),
    queryFn: () => fetchClubThreadExperts(threadId ?? "", limit),
    enabled: threadId !== undefined && threadId !== "",
    staleTime: 60_000,
  });
}

export function usePingClubThreadExpert(
  threadId: string,
): UseMutationResult<boolean, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => pingClubThreadExpert(threadId, userId),
    // Prosba dotyczy JEDNEGO watku - klub obok nie ma powodu sie przeladowac.
    onSuccess: () => void qc.invalidateQueries({ queryKey: clubKeys.threadExperts(threadId) }),
  });
}

// ---------------------------------------------------------------------------
// Kto bedzie na spotkaniu
// ---------------------------------------------------------------------------

export function useClubEventAttendees(params: {
  clubId: string | undefined;
  eventId: string | undefined;
  limit?: number;
  enabled?: boolean;
}): UseQueryResult<ClubEventAttendeeRow[], Error> {
  const { clubId, eventId, limit = 12, enabled = true } = params;
  return useQuery({
    queryKey: clubKeys.eventAttendees(clubId ?? "none", eventId ?? "none", limit),
    queryFn: () => fetchClubEventAttendees(eventId ?? "", limit),
    enabled: enabled && clubId !== undefined && eventId !== undefined && eventId !== "",
    staleTime: 30_000,
  });
}

// ---------------------------------------------------------------------------
// Sklad z sygnalem obecnosci
// ---------------------------------------------------------------------------

export function useClubRosterSignal(params: {
  clubId: string | undefined;
  limit?: number;
}): UseQueryResult<ClubRosterSignal | null, Error> {
  const { clubId, limit = 12 } = params;
  return useQuery({
    queryKey: clubKeys.rosterSignal(clubId ?? "none", limit),
    queryFn: () => fetchClubRosterSignal(clubId ?? "", limit),
    enabled: clubId !== undefined && clubId !== "",
    // Sygnal obecnosci ma byc SYGNALEM: "aktywni w ostatniej dobie" odswiezany
    // raz na kwadrans to liczba, ktora nadal cos znaczy, a nie licznik na zywo.
    staleTime: 60_000,
  });
}

// ---------------------------------------------------------------------------
// Poznaj czlonka
// ---------------------------------------------------------------------------

export function useClubSpotlight(
  clubId: string | undefined,
): UseQueryResult<ClubSpotlightRow | null, Error> {
  return useQuery({
    queryKey: clubKeys.spotlight(clubId ?? "none"),
    queryFn: () => fetchClubSpotlight(clubId ?? ""),
    enabled: clubId !== undefined && clubId !== "",
    // Rotacja jest TYGODNIOWA - odpytywanie czesciej niz raz na kwadrans nie
    // ma prawa oddac innej osoby.
    staleTime: 15 * 60_000,
  });
}

// ---------------------------------------------------------------------------
// Dorobek jako wynik wspolnych rozmow
// ---------------------------------------------------------------------------

export function useClubOutput(params: {
  clubId: string | undefined;
  limit?: number;
  offset?: number;
}): UseQueryResult<ClubOutputPage, Error> {
  const { clubId, limit = 4, offset = 0 } = params;
  return useQuery({
    queryKey: clubKeys.output(clubId ?? "none", limit, offset),
    queryFn: () => fetchClubOutput(clubId ?? "", limit, offset),
    enabled: clubId !== undefined && clubId !== "",
    staleTime: 60_000,
  });
}

// ---------------------------------------------------------------------------
// Katalog ekspertow klubu (A33)
// ---------------------------------------------------------------------------

export function useClubExperts(params: {
  clubId: string | undefined;
  topic?: string | null;
  search?: string;
  limit?: number;
  offset?: number;
}): UseQueryResult<ClubExpertsPage, Error> {
  const { clubId, topic = null, search = "", limit = 24, offset = 0 } = params;
  return useQuery({
    queryKey: clubKeys.experts(clubId ?? "none", topic, search.trim(), offset),
    queryFn: () => fetchClubExperts({ clubId: clubId ?? "", topic, search, limit, offset }),
    enabled: clubId !== undefined && clubId !== "",
    staleTime: 60_000,
  });
}

export function useClubExpertiseAreas(
  clubId: string | undefined,
): UseQueryResult<ClubExpertiseArea[], Error> {
  return useQuery({
    queryKey: clubKeys.expertiseAreas(clubId ?? "none"),
    queryFn: () => fetchClubExpertiseAreas(clubId ?? ""),
    enabled: clubId !== undefined && clubId !== "",
    staleTime: 5 * 60_000,
  });
}

// ---------------------------------------------------------------------------
// Pojedyncze spotkanie (A33)
// ---------------------------------------------------------------------------

export function useClubEvent(params: {
  clubId: string | undefined;
  slug: string;
}): UseQueryResult<ClubEventViewRow | null, Error> {
  const { clubId, slug } = params;
  return useQuery({
    queryKey: clubKeys.event(clubId ?? "none", slug),
    queryFn: () => fetchClubEvent(clubId ?? "", slug),
    enabled: clubId !== undefined && clubId !== "" && slug !== "",
    staleTime: 30_000,
  });
}

// ---------------------------------------------------------------------------
// Archiwum i redakcja przedstawien (A33)
// ---------------------------------------------------------------------------

export function useClubSpotlightHistory(params: {
  clubId: string | undefined;
  limit?: number;
}): UseQueryResult<ClubSpotlightHistoryRow[], Error> {
  const { clubId, limit = 12 } = params;
  return useQuery({
    queryKey: clubKeys.spotlightHistory(clubId ?? "none"),
    queryFn: () => fetchClubSpotlightHistory(clubId ?? "", limit),
    enabled: clubId !== undefined && clubId !== "",
    staleTime: 5 * 60_000,
  });
}

export function usePinClubSpotlight(
  clubId: string,
): UseMutationResult<string, Error, ClubSpotlightPinInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ClubSpotlightPinInput) => pinClubSpotlight(clubId, input),
    onSuccess: () => invalidateClub(qc, clubId),
  });
}

export function useDeleteClubSpotlight(clubId: string): UseMutationResult<boolean, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteClubSpotlight,
    onSuccess: () => invalidateClub(qc, clubId),
  });
}
