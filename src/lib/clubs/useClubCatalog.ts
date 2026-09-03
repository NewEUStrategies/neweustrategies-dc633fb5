// Kluby - hooki ODCZYTU PRODUKTOWEGO (katalog, karta, dzialy, czlonkowie).
//
// Wydzielone z `useClubs.ts`, ktory urosl do 1 258 linii i 70 hookow w jednym
// pliku. Podzial idzie po DOMENIE, nie po typie hooka: kto czyta katalog
// klubow, nie potrzebuje w tym samym module kolejki moderacji ani zaproszen.
// `useClubs.ts` re-eksportuje calosc, wiec zaden z 29 konsumentow nie zmienia
// importu - ten sam wzorzec, co przy podziale workspace klubu i watku
// (bramka `workspaceModuleBoundary.test.ts`).
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import {
  fetchClubBySlug,
  fetchClubGroups,
  fetchClubList,
  fetchClubActivityFeed,
  fetchClubMembers,
  fetchMyClubMemberships,
  type ClubListPage,
  type ClubMembersPage,
} from "./api";
import { clubKeys } from "./queryKeys";
import { CLUB_STALE_MS } from "./clubInvalidations";
import type {
  ClubActivityRow,
  ClubActivitySort,
  ClubGroupRow,
  ClubMemberStatus,
  ClubMembershipRow,
  ClubViewRow,
} from "./types";

// ---------------------------------------------------------------------------
// Odczyt
// ---------------------------------------------------------------------------

export function useClubList(enabled = true, limit = 100): UseQueryResult<ClubListPage, Error> {
  return useQuery({
    // Limit JEST czescia klucza: "pokaz wiecej" zmienia rozmiar strony, a bez
    // tego trafialoby w ten sam wpis cache i katalog zostawalby na setce.
    queryKey: [...clubKeys.list(), limit] as const,
    queryFn: () => fetchClubList({ limit }),
    staleTime: CLUB_STALE_MS,
    enabled,
  });
}

export function useMyClubMemberships(enabled = true): UseQueryResult<ClubMembershipRow[], Error> {
  return useQuery({
    queryKey: clubKeys.memberships(),
    queryFn: fetchMyClubMemberships,
    staleTime: CLUB_STALE_MS,
    enabled,
  });
}

/**
 * Strumien aktywnosci na stronie glownej klubow. Krotki staleTime, bo to
 * powierzchnia "co sie dzieje" - lista sprzed piecu minut przeczy jej celowi.
 */
export function useClubActivityFeed(params: {
  sort: ClubActivitySort;
  policyArea: string | null;
  limit?: number;
  enabled?: boolean;
}): UseQueryResult<ClubActivityRow[], Error> {
  const { sort, policyArea, limit, enabled = true } = params;
  return useQuery({
    queryKey: clubKeys.activity(sort, policyArea),
    queryFn: () => fetchClubActivityFeed({ sort, policyArea, limit }),
    staleTime: 30_000,
    enabled,
  });
}

export function useClubBySlug(slug: string | undefined): UseQueryResult<ClubViewRow | null, Error> {
  // Karta klubu zalezy od TOZSAMOSCI czytajacego: ta sama trasa zwraca inne
  // `can_read`/`my_role` dla anonima i dla czlonka. Loader trasy dziala bez
  // sesji (SSR), wiec jego wynik nie moze byc podany zalogowanemu - stad klucz
  // z widzem i wstrzymanie zapytania, dopoki sesja nie jest rozstrzygnieta
  // (inaczej przez moment renderowalaby sie bramka dostepu).
  const { user, loading } = useAuth();
  return useQuery({
    queryKey: clubKeys.bySlugViewer(slug ?? "", user?.id ?? null),
    queryFn: () => fetchClubBySlug(slug ?? ""),
    staleTime: CLUB_STALE_MS,
    enabled: Boolean(slug) && !loading,
  });
}

export function useClubGroups(clubId: string | undefined): UseQueryResult<ClubGroupRow[], Error> {
  return useQuery({
    queryKey: clubKeys.groups(clubId ?? ""),
    queryFn: () => fetchClubGroups(clubId ?? ""),
    staleTime: CLUB_STALE_MS,
    enabled: Boolean(clubId),
  });
}

export function useClubMembers(params: {
  clubId: string | undefined;
  status?: ClubMemberStatus | null;
  limit?: number;
  offset?: number;
}): UseQueryResult<ClubMembersPage, Error> {
  const { clubId, status = "active", limit = 50, offset = 0 } = params;
  return useQuery({
    // Limit JEST częścią klucza: dwa widoki tej samej listy z różnymi limitami
    // (zakładka członków 50, panel moderacji 100) liczyły ten sam klucz, więc
    // ten, który trafił drugi, dostawał krótszą stronę z cache i milczał o tym.
    queryKey: clubKeys.members(clubId ?? "", status, offset, limit),
    queryFn: () => fetchClubMembers({ clubId: clubId ?? "", status, limit, offset }),
    staleTime: CLUB_STALE_MS,
    enabled: Boolean(clubId),
  });
}

// USUNIETO `useClubCapabilities`. Hook mial zero konsumentow w calym src:
// kazdy ekran produktowy czyta zdolnosci z kolumn, ktore RPC i tak zwraca
// razem z trescia (`club_view.can_*`, `club_threads_list`, `club_thread_view`),
// bo tam sa policzone dla TEJ SAMEJ pary (klub, grupa), ktorej dotyczy widok.
// Osobne zapytanie o to samo bylo drugim zrodlem tej samej prawdy - i tym
// samym drugim miejscem, w ktorym moglaby sie rozjechac. Zdolnosci w panelu
// czyta `useClubCapabilitiesPreview`, ktore odpowiada na INNE pytanie:
// "co zobaczy wskazana osoba", a nie "co widze ja".
