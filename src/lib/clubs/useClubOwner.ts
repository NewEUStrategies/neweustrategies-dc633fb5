// Kluby - hooki WLASCICIELSKIE: zgloszenie klubu przez czlonka i edycja danych
// klubu przez prowadzacego.
//
// DLACZEGO OSOBNY PLIK, A NIE `useClubAdmin.ts`. Tamten plik jest o PANELU:
// kazdy jego hook wola RPC z bramka `is_club_admin`, wiec import z niego
// wciaga do grafu widoku produktowego kolejke moderacji i katalog zaproszen.
// Te dwie czynnosci sa produktowe - dzieja sie na /club i na stronie klubu,
// przez zwyklego czlonka i przez prowadzacego, ktory panelu nie widzi.
//
// ZESTAWY UNIEWAZNIEN sa tu skladane INLINE: karta klubu przychodzi z
// `clubInvalidations.ts` (`clubCardKeys`), ale dopisane do niej klucze
// (`memberships`, `myProposals`) nie sa nazwanym skutkiem rejestru - wiec oba
// zestawy omijaja inwarianty `clubInvalidationsForTest`. Ich dokladny sklad
// i te same inwarianty (bez duplikatu, bez prefiksu obok potomka) dowodzi
// `__tests__/clubOwnerHooks.test.tsx`. Docelowo powinny to byc nazwane skutki
// w `clubInvalidations.ts`, bo to regula produktowa (czy /club pokaze nowa
// nazwe), nie szczegol hooka.
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import {
  fetchMyClubProposals,
  proposeClub,
  updateClubSettings,
  type ClubProposalInput,
  type ClubProposalResult,
  type ClubProposalRow,
  type ClubSettingsPatch,
} from "./api";
import { clubKeys } from "./queryKeys";
import { CLUB_STALE_MS, clubCardKeys, invalidateKeys } from "./clubInvalidations";

/** Moje zgloszenia klubow. Wlaczane dopiero dla zalogowanego widza. */
export function useMyClubProposals(enabled: boolean): UseQueryResult<ClubProposalRow[], Error> {
  return useQuery({
    queryKey: clubKeys.myProposals(),
    queryFn: fetchMyClubProposals,
    enabled,
    staleTime: CLUB_STALE_MS,
  });
}

/**
 * Zgloszenie klubu. Po zapisie uniewazniamy takze KATALOG i moje czlonkostwa:
 * zglaszajacy zostaje prowadzacym szkicu, wiec klub pojawia mu sie w „Moich
 * klubach" natychmiast, a nie po wygasnieciu staleTime.
 */
export function useProposeClub(): UseMutationResult<ClubProposalResult, Error, ClubProposalInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: proposeClub,
    onSuccess: (result) =>
      invalidateKeys(qc, [
        ...clubCardKeys(result.id),
        clubKeys.memberships(),
        clubKeys.myProposals(),
      ]),
  });
}

export interface UpdateClubSettingsVars {
  patch: ClubSettingsPatch;
}

/**
 * Edycja danych klubu przez prowadzacego. Poza karta klubu uniewazniamy takze
 * „Moje zgloszenia": `club_my_proposals` zwraca `name_pl` klubow zalozonych
 * przez wolajacego we WSZYSTKICH statusach, a prowadzacy zmieniajacy nazwe
 * zatwierdzonego klubu jest zwykle jego zglaszajacym. Bez tego klucza /club
 * pokazywalo nowa nazwe w „Moich klubach" i stara w sekcji zgloszen tuz nad
 * nimi - az do wygasniecia staleTime.
 */
export function useUpdateClubSettings(
  clubId: string,
): UseMutationResult<boolean, Error, UpdateClubSettingsVars> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars) => updateClubSettings({ clubId, patch: vars.patch }),
    onSuccess: () => invalidateKeys(qc, [...clubCardKeys(clubId), clubKeys.myProposals()]),
  });
}
