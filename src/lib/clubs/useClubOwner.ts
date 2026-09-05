// Kluby - hooki WLASCICIELSKIE: zgloszenie klubu przez czlonka i edycja danych
// klubu przez prowadzacego.
//
// DLACZEGO OSOBNY PLIK, A NIE `useClubAdmin.ts`. Tamten plik jest o PANELU:
// kazdy jego hook wola RPC z bramka `is_club_admin`, wiec import z niego
// wciaga do grafu widoku produktowego kolejke moderacji i katalog zaproszen.
// Te dwie czynnosci sa produktowe - dzieja sie na /club i na stronie klubu,
// przez zwyklego czlonka i przez prowadzacego, ktory panelu nie widzi.
//
// ZESTAWY UNIEWAZNIEN wychodza z `clubInvalidations.ts` - to regula produktowa
// (czy naglowek klubu pokaze nowa nazwe), nie szczegol hooka.
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

/** Edycja danych klubu przez prowadzacego. */
export function useUpdateClubSettings(
  clubId: string,
): UseMutationResult<boolean, Error, UpdateClubSettingsVars> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars) => updateClubSettings({ clubId, patch: vars.patch }),
    onSuccess: () => invalidateKeys(qc, clubCardKeys(clubId)),
  });
}
