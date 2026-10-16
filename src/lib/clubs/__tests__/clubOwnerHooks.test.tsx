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
//   2. ZGŁOSZENIE unieważnia DOKŁADNIE kartę nowego klubu, „Moje członkostwa"
//      i „Moje zgłoszenia" - zgłaszający zostaje prowadzącym szkicu
//      (`club_propose` wpisuje go jako `lead`), więc te trzy widoki zmieniają
//      się naraz. Odrzucony zapis nie unieważnia niczego.
//   3. EDYCJA DANYCH KLUBU odświeża także „Moje zgłoszenia". To jest NAPRAWA:
//      `club_my_proposals` zwraca `name_pl` klubów założonych przez wołającego
//      we WSZYSTKICH statusach, a prowadzący, który zmienia nazwę już
//      zatwierdzonego klubu, jest właśnie jego zgłaszającym. Hook unieważniał
//      sam `clubCardKeys` - po powrocie na /club „Moje kluby" (lista,
//      unieważniona) pokazywały nową nazwę, a sekcja „Moje zgłoszenia" tuż
//      nad nimi starą, aż do wygaśnięcia 30-sekundowego `staleTime`.
//   4. INWARIANTY REJESTRU dla obu zestawów. Hooki składają je inline, a nie
//      z nazwanego skutku `clubInvalidations.ts`, więc `clubInvalidationsForTest`
//      ich nie widzi. Sprawdzamy tu te same reguły (bez duplikatu, bez prefiksu
//      obok potomka) na zestawach ZAOBSERWOWANYCH z hooka, nie przepisanych
//      z ręki - szerszy klucz dopisany obok węższego oblewa ten test nawet
//      wtedy, gdy ktoś poprawi oczekiwany zestaw w punktach 2-3.
//
// GRANICA DOWODU. Warstwa danych jest atrapą (`@/test/clubs/apiMock`), a jej
// kontrakt z bazą ma własne testy; `QueryClient` i hooki są PRAWDZIWE, bo
// przedmiotem dowodu jest cache - klucz, bramka i skutek mutacji.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider, type QueryKey } from "@tanstack/react-query";

vi.mock("@/lib/clubs/api", () => clubApiMock);

import { clubApiMock, resetClubApiMock } from "@/test/clubs/apiMock";
import { clubKeys } from "@/lib/clubs/queryKeys";
import { CLUB_STALE_MS, clubCardKeys } from "@/lib/clubs/clubInvalidations";
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

/** Czy `prefix` jest PREFIKSEM `key` - tak react-query dopasowuje zapytania. */
function isPrefixOf(prefix: QueryKey, key: QueryKey): boolean {
  const p = prefix as readonly unknown[];
  const k = key as readonly unknown[];
  return p.length <= k.length && p.every((seg, i) => Object.is(seg, k[i]));
}

/** Te same trzy reguły, które `clubInvalidations.test.ts` stosuje do rejestru. */
function expectRegistryInvariants(keys: readonly QueryKey[]): void {
  expect(keys.length, "zestaw nie unieważnia niczego").toBeGreaterThan(0);
  const serialized = keys.map((k) => JSON.stringify(k));
  expect(new Set(serialized).size, `powtórzony klucz: ${serialized.join(" ")}`).toBe(keys.length);
  keys.forEach((wide, i) =>
    keys.forEach((narrow, j) => {
      if (i === j) return;
      expect(isPrefixOf(wide, narrow), `${serialized[i]} pochłania ${serialized[j]}`).toBe(false);
    }),
  );
}

beforeEach(() => resetClubApiMock());

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

  it("po zapisie unieważnia DOKŁADNIE kartę nowego klubu, członkostwa i zgłoszenia", async () => {
    const { wrapper, invalidated } = harness();
    clubApiMock.proposeClub.mockResolvedValue({ id: "c-new", slug: "nowy-klub", status: "draft" });

    const { result } = renderHook(() => useProposeClub(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ name_pl: "Nowy klub" });
    });

    // Id pochodzi z ODPOWIEDZI bazy, nie z wejścia - wejście go nie ma.
    expect(keySet(invalidated)).toEqual(
      keySet([...clubCardKeys("c-new"), clubKeys.memberships(), clubKeys.myProposals()]),
    );
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

  it("po zapisie unieważnia kartę klubu z trzech stron ORAZ moje zgłoszenia", async () => {
    const { wrapper, invalidated } = harness();
    clubApiMock.updateClubSettings.mockResolvedValue(true);

    const { result } = renderHook(() => useUpdateClubSettings(CLUB), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ patch: { name_pl: "Nowa nazwa" } });
    });

    expect(keySet(invalidated)).toEqual(keySet([...clubCardKeys(CLUB), clubKeys.myProposals()]));
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

describe("zestawy inline a inwarianty rejestru", () => {
  it("zgłoszenie klubu: bez duplikatu i bez prefiksu obok potomka", async () => {
    const { wrapper, invalidated } = harness();
    clubApiMock.proposeClub.mockResolvedValue({ id: "c-new", slug: "nowy-klub", status: "draft" });

    const { result } = renderHook(() => useProposeClub(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ name_pl: "Nowy klub" });
    });

    expectRegistryInvariants(invalidated);
  });

  it("edycja danych klubu: bez duplikatu i bez prefiksu obok potomka", async () => {
    const { wrapper, invalidated } = harness();
    clubApiMock.updateClubSettings.mockResolvedValue(true);

    const { result } = renderHook(() => useUpdateClubSettings(CLUB), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ patch: { name_pl: "Nowa nazwa" } });
    });

    expectRegistryInvariants(invalidated);
  });
});
