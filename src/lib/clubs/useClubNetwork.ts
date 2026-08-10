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
  fetchClubBoardNotices,
  fetchClubEventAttendees,
  fetchClubOutput,
  fetchClubRosterSignal,
  fetchClubSpotlight,
  fetchClubThreadExperts,
  fetchMyClubExpertise,
  pingClubThreadExpert,
  setMyClubExpertise,
  type ClubBoardPage,
  type ClubNoticeCreateInput,
  type ClubOutputPage,
} from "./networkApi";
import { clubKeys } from "./queryKeys";
import type {
  ClubEventAttendeeRow,
  ClubNoticeKind,
  ClubRosterSignal,
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

export function useClubBoardNotices(params: {
  clubId: string | undefined;
  kind?: ClubNoticeKind | null;
  topic?: string | null;
  limit?: number;
}): UseQueryResult<ClubBoardPage, Error> {
  const { clubId, kind = null, topic = null, limit = 8 } = params;
  return useQuery({
    queryKey: clubKeys.board(clubId ?? "none", kind, topic),
    queryFn: () => fetchClubBoardNotices({ clubId: clubId ?? "", kind, topic, limit }),
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
    queryKey: clubKeys.eventAttendees(clubId ?? "none", eventId ?? "none"),
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
}): UseQueryResult<ClubOutputPage, Error> {
  const { clubId, limit = 4 } = params;
  return useQuery({
    queryKey: clubKeys.output(clubId ?? "none", limit),
    queryFn: () => fetchClubOutput(clubId ?? "", limit),
    enabled: clubId !== undefined && clubId !== "",
    staleTime: 60_000,
  });
}
