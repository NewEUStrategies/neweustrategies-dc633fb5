// Hooki WŁAŚCICIELSKIE klubów (`useClubOwner.ts`) - zgłoszenie klubu przez
// członka i edycja danych klubu przez prowadzącego. Do wydania 13 plik stał na
// zerze, a `clubOwner.test.ts` mimo nazwy dowodzi WARSTWY DANYCH (`api.ts`:
// które RPC, jaki kod błędu limitu), nie hooków.
//
// CO TEN PLIK DOWODZI - to, czego react-query za nas nie sprawdzi:
//
//   1. ZAPYTANIE „MOJE ZGŁOSZENIA" leży pod `clubKeys.myProposals()` ze
//      wspólnym `CLUB_STALE_MS` i NIE odpytuje bazy dla gościa (`enabled`):
//      `club_my_proposals` bez sesji to round-trip po pustą listę.
//   2. ZGŁOSZENIE unieważnia DOKŁADNIE skutek `clubProposedKeys` nowego klubu,
//      liczony z id z ODPOWIEDZI bazy (wejście formularza go nie ma).
//      Odrzucony zapis nie unieważnia niczego.
//   3. EDYCJA DANYCH KLUBU unieważnia DOKŁADNIE `clubOwnerSettingsKeys`, a nowa
//      nazwa dociera do „Moich zgłoszeń" na PRAWDZIWYM cache'u. To jest
//      NAPRAWA: hook unieważniał sam `clubCardKeys` - po powrocie na /club
//      „Moje kluby" (lista, unieważniona) pokazywały nową nazwę, a sekcja
//      „Moje zgłoszenia" tuż nad nimi starą, aż do wygaśnięcia 30-sekundowego
//      `staleTime`.
//   4. HOOK WOŁA NAZWANY SKUTEK, a nie jego kopię inline - stąd szpieg na
//      module reguł. Skład obu skutków i inwarianty rejestru (bez duplikatu,
//      bez prefiksu obok potomka) dowodzi `clubInvalidations.test.ts`, bo oba
//      stoją w `clubInvalidationsForTest`. Kopia inline przeszłaby asercję
//      zestawu, ale omijałaby te inwarianty - to był stan sprzed wydzielenia
//      skutków, kiedy ten plik trzymał ich własną kopię.
//
// GRANICA DOWODU. Warstwa danych jest atrapą (`@/test/clubs/apiMock`), a jej
// kontrakt z bazą ma własne testy; `QueryClient` i hooki są PRAWDZIWE, bo
// przedmiotem dowodu jest cache - klucz, bramka i skutek mutacji.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider, type QueryKey } from "@tanstack/react-query";

vi.mock("@/lib/clubs/api", () => clubApiMock);
// Moduł reguł zostaje PRAWDZIWY - szpieg tylko notuje, że hook sięgnął po
// nazwany skutek, i oddaje jego prawdziwy wynik.
vi.mock("@/lib/clubs/clubInvalidations", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/clubs/clubInvalidations")>();
  return {
    ...real,
    clubProposedKeys: vi.fn(real.clubProposedKeys),
    clubOwnerSettingsKeys: vi.fn(real.clubOwnerSettingsKeys),
  };
});

import { clubApiMock, resetClubApiMock } from "@/test/clubs/apiMock";
import { clubKeys } from "@/lib/clubs/queryKeys";
import {
  CLUB_STALE_MS,
  clubOwnerSettingsKeys,
  clubProposedKeys,
} from "@/lib/clubs/clubInvalidations";
import type { ClubProposalRow } from "@/lib/clubs/api";
import {
  useMyClubProposals,
  useProposeClub,
  useUpdateClubSettings,
} from "@/lib/clubs/useClubOwner";

const CLUB = "club-1";

function proposal(over: Partial<ClubProposalRow> = {}): ClubProposalRow {
  return {
    id: CLUB,
    slug: "polityka-energetyczna",
    name_pl: "Polityka energetyczna",
    name_en: "Energy policy",
    status: "active",
    policy_area: null,
    created_at: "2026-10-01T10:00:00.000Z",
    ...over,
  };
}

/**
 * Świeży klient per test, bez ponowień (porażka mutacji ma być jedną
 * porażką, nie trzema z backoffem), ze szpiegiem na `invalidateQueries` -
 * to jedyny obserwowalny skutek mutacji poza samym zapisem.
 */
function harness() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidated: QueryKey[] = [];
  const original = queryClient.invalidateQueries.bind(queryClient);
  queryClient.invalidateQueries = ((filters?: { queryKey?: QueryKey }) => {
    if (filters?.queryKey) invalidated.push(filters.queryKey);
    return original(filters);
  }) as typeof queryClient.invalidateQueries;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper, invalidated };
}

/** Zestaw kluczy bez kolejności - kolejność unieważnień nie jest kontraktem. */
function keySet(keys: readonly QueryKey[]): string[] {
  return keys.map((k) => JSON.stringify(k)).sort();
}

/**
 * Hook zawołał nazwany skutek DOKŁADNIE raz, z tym argumentem, i unieważnił
 * DOKŁADNIE jego wynik - ani klucza mniej, ani doklejonego obok.
 */
function expectNamedEffect(
  effect: typeof clubProposedKeys,
  arg: string,
  invalidated: readonly QueryKey[],
): void {
  const spy = vi.mocked(effect);
  expect(spy).toHaveBeenCalledTimes(1);
  expect(spy).toHaveBeenCalledWith(arg);
  const produced = spy.mock.results[0]?.value as readonly QueryKey[];
  expect(keySet(invalidated)).toEqual(keySet(produced));
}

beforeEach(() => {
  resetClubApiMock();
  vi.mocked(clubProposedKeys).mockClear();
  vi.mocked(clubOwnerSettingsKeys).mockClear();
});

describe("useMyClubProposals", () => {
  it("dla gościa (enabled=false) nie odpytuje bazy i nie zakłada wpisu w toku", async () => {
    const { wrapper, queryClient } = harness();

    const { result } = renderHook(() => useMyClubProposals(false), { wrapper });

    await act(async () => {});
    expect(clubApiMock.fetchMyClubProposals).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe("idle");
    expect(queryClient.getQueryData(clubKeys.myProposals())).toBeUndefined();
  });

  it("dla zalogowanego czyta zgłoszenia pod kluczem myProposals ze wspólnym staleTime", async () => {
    const { wrapper, queryClient } = harness();
    const rows = [proposal({ status: "draft" })];
    clubApiMock.fetchMyClubProposals.mockResolvedValue(rows);

    const { result } = renderHook(() => useMyClubProposals(true), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(rows);
    expect(clubApiMock.fetchMyClubProposals).toHaveBeenCalledTimes(1);
    // Klucz jest kontraktem z mutacjami: to pod nim `useProposeClub`
    // i `useUpdateClubSettings` szukają wpisu do unieważnienia.
    expect(queryClient.getQueryData(clubKeys.myProposals())).toEqual(rows);
    const query = queryClient.getQueryCache().find({ queryKey: clubKeys.myProposals() });
    expect((query?.options as { staleTime?: number }).staleTime).toBe(CLUB_STALE_MS);
  });

  it("drugi odbiorca w oknie staleTime czyta z cache, bez drugiego odczytu", async () => {
    const { wrapper } = harness();
    clubApiMock.fetchMyClubProposals.mockResolvedValue([proposal()]);

    const first = renderHook(() => useMyClubProposals(true), { wrapper });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    const second = renderHook(() => useMyClubProposals(true), { wrapper });
    await act(async () => {});

    expect(second.result.current.data).toEqual([proposal()]);
    expect(clubApiMock.fetchMyClubProposals).toHaveBeenCalledTimes(1);
  });
});

describe("useProposeClub", () => {
  it("przekazuje wejście formularza do proposeClub i oddaje szkic", async () => {
    const { wrapper } = harness();
    const input = { name_pl: "Nowy klub", motivation: "Brakuje forum o sieciach" };
    clubApiMock.proposeClub.mockResolvedValue({ id: "c-new", slug: "nowy-klub", status: "draft" });

    const { result } = renderHook(() => useProposeClub(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync(input);
    });

    expect(clubApiMock.proposeClub).toHaveBeenCalledTimes(1);
    expect(clubApiMock.proposeClub.mock.calls[0]?.[0]).toEqual(input);
    await waitFor(() =>
      expect(result.current.data).toEqual({ id: "c-new", slug: "nowy-klub", status: "draft" }),
    );
  });

  it("po zapisie unieważnia DOKŁADNIE skutek clubProposedKeys nowego klubu", async () => {
    const { wrapper, invalidated } = harness();
    clubApiMock.proposeClub.mockResolvedValue({ id: "c-new", slug: "nowy-klub", status: "draft" });

    const { result } = renderHook(() => useProposeClub(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ name_pl: "Nowy klub" });
    });

    // Id pochodzi z ODPOWIEDZI bazy, nie z wejścia - wejście go nie ma.
    expectNamedEffect(clubProposedKeys, "c-new", invalidated);
  });

  it("odrzucony zapis (limit dobowy) nie unieważnia niczego", async () => {
    const { wrapper, invalidated } = harness();
    clubApiMock.proposeClub.mockRejectedValue(new Error("clubs: proposal quota exceeded"));

    const { result } = renderHook(() => useProposeClub(), { wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync({ name_pl: "X" })).rejects.toThrow(/quota/);
    });

    expect(invalidated).toEqual([]);
  });
});

describe("useUpdateClubSettings", () => {
  it("woła updateClubSettings z id klubu z hooka i łatą z wywołania", async () => {
    const { wrapper } = harness();
    clubApiMock.updateClubSettings.mockResolvedValue(true);

    const { result } = renderHook(() => useUpdateClubSettings(CLUB), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ patch: { name_pl: "Nowa nazwa", tagline_pl: null } });
    });

    expect(clubApiMock.updateClubSettings).toHaveBeenCalledWith({
      clubId: CLUB,
      patch: { name_pl: "Nowa nazwa", tagline_pl: null },
    });
    await waitFor(() => expect(result.current.data).toBe(true));
  });

  it("po zapisie unieważnia DOKŁADNIE skutek clubOwnerSettingsKeys tego klubu", async () => {
    const { wrapper, invalidated } = harness();
    clubApiMock.updateClubSettings.mockResolvedValue(true);

    const { result } = renderHook(() => useUpdateClubSettings(CLUB), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ patch: { name_pl: "Nowa nazwa" } });
    });

    expectNamedEffect(clubOwnerSettingsKeys, CLUB, invalidated);
  });

  // REGRESJA: przed naprawą lista „Moje zgłoszenia" na /club zostawała ze
  // starą nazwą obok nowej w „Moich klubach" - `staleTime` 30 s chronił
  // stary wpis przed odczytem, a mutacja go nie unieważniała.
  it("zmiana nazwy klubu dociera do listy moich zgłoszeń bez czekania na staleTime", async () => {
    const { wrapper } = harness();
    clubApiMock.fetchMyClubProposals.mockResolvedValueOnce([proposal({ name_pl: "Stara nazwa" })]);
    clubApiMock.fetchMyClubProposals.mockResolvedValue([proposal({ name_pl: "Nowa nazwa" })]);
    clubApiMock.updateClubSettings.mockResolvedValue(true);

    const { result } = renderHook(
      () => ({ proposals: useMyClubProposals(true), save: useUpdateClubSettings(CLUB) }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.proposals.data?.[0]?.name_pl).toBe("Stara nazwa"));

    await act(async () => {
      await result.current.save.mutateAsync({ patch: { name_pl: "Nowa nazwa" } });
    });

    await waitFor(() => expect(result.current.proposals.data?.[0]?.name_pl).toBe("Nowa nazwa"));
    expect(clubApiMock.fetchMyClubProposals).toHaveBeenCalledTimes(2);
  });

  it("odrzucony zapis (brak uprawnień) nie unieważnia niczego", async () => {
    const { wrapper, invalidated } = harness();
    clubApiMock.updateClubSettings.mockRejectedValue(new Error("clubs: forbidden"));

    const { result } = renderHook(() => useUpdateClubSettings(CLUB), { wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync({ patch: { name_pl: "X" } })).rejects.toThrow(
        /forbidden/,
      );
    });

    expect(invalidated).toEqual([]);
  });
});
