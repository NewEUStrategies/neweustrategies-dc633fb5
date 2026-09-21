// Podpowiedzi do @wzmianki - `useMentionSuggestions`.
//
// CO TEN PLIK DOWODZI.
// (1) LISTA JEST MIESZANA. RPC `search_people_orgs` oddaje OSOBY I ORGANIZACJE,
//     a hak przepuszcza jedne i drugie, oznaczając wiersz polem `kind`. Wcześniej
//     odsiewał wszystko poza osobami - firma dała się wspomnieć tylko z pamięci,
//     bo podpowiedź jej nie pokazywała.
// (2) LOGO WCHODZI JAKO AWATAR. Gałąź UNION organizacji zwraca `avatar_url = NULL`
//     i wypełnia `logo_url`; gdyby hak czytał tylko pierwszą kolumnę, każda firma
//     na liście byłaby bez znaku graficznego. Bierzemy pierwszą niepustą.
// (3) SLUG JEST WARUNKIEM WSTĘPU - NIEZALEŻNIE OD RODZAJU. Wpis bez sluga nie da
//     się wstawić do treści (`@` + nic), więc odpada i dla osoby, i dla firmy.
// (4) BRAK AKTYWNEJ WZMIANKI TO ZERO ZAPYTAŃ. `query === null` (kursor poza
//     wzmianką) nie może odpalać RPC - inaczej samo pisanie komentarza
//     wyliczałoby katalog osób tenanta.
// (5) JĘZYK UI WYBIERA ETYKIETĘ I PODPIS; pusty query pomija `_q` (lista „na
//     starcie" po samym `@`), a błąd RPC degraduje do pustej listy, nie do
//     wysypanego pola tekstowego.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// (a) WIDOKU LISTY (ikona organizacji, dymek podglądu, nawigacja klawiaturą) -
//     to `MentionTextarea.test.tsx` i atom `MentionSuggestionList`.
// (b) IZOLACJI TENANTA I REGUŁ WIDOCZNOŚCI - egzekwuje je SECURITY DEFINER po
//     stronie bazy, a nie ten hak; testy RPC stoją przy migracji.
// (c) DEBOUNCE'U - należy do wołającego (`MentionTextarea`), nie do haka.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: rpcMock } }));

import {
  useMentionSuggestions,
  MENTION_SUGGESTION_LIMIT,
} from "@/lib/mentions/useMentionSuggestions";

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

/** Wiersz osoby z RPC - zdjęcie w `avatar_url`, `logo_url` puste. */
function personRow(over: Record<string, unknown> = {}) {
  return {
    kind: "person",
    id: "u1",
    slug: "jan-kowalski",
    label_pl: "Jan Kowalski",
    label_en: "Jan Kowalski",
    sublabel_pl: "Analityk",
    sublabel_en: "Analyst",
    avatar_url: "https://cdn/jan.png",
    logo_url: null,
    verified: true,
    post_count: 3,
    score: 1,
    ...over,
  };
}

/**
 * Wiersz organizacji. `avatar_url` JEST `null` celowo - tak wygląda druga
 * gałąź UNION-u w `search_people_orgs`; znak graficzny przychodzi `logo_url`.
 */
function orgRow(over: Record<string, unknown> = {}) {
  return {
    kind: "organization",
    id: "o1",
    slug: "acme",
    label_pl: "ACME Polska",
    label_en: "ACME Poland",
    sublabel_pl: "Energetyka",
    sublabel_en: "Energy",
    avatar_url: null,
    logo_url: "https://cdn/acme.png",
    verified: false,
    post_count: 0,
    score: 1,
    ...over,
  };
}

beforeEach(() => rpcMock.mockReset());

describe("useMentionSuggestions", () => {
  it("bez aktywnej wzmianki (query null) NIE pyta bazy", async () => {
    renderHook(() => useMentionSuggestions(null, "pl"), { wrapper: wrapper() });
    // enabled:false -> RPC nie leci (bezczynny kursor nie wylicza katalogu osób).
    await new Promise((r) => setTimeout(r, 20));
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("przekazuje query i limit, a zwraca OSOBY I ORGANIZACJE", async () => {
    rpcMock.mockResolvedValue({ data: [personRow(), orgRow()], error: null });
    const { result } = renderHook(() => useMentionSuggestions("a", "pl"), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data?.length).toBe(2));

    expect(rpcMock).toHaveBeenCalledWith("search_people_orgs", {
      _q: "a",
      _limit: MENTION_SUGGESTION_LIMIT,
    });
    expect(result.current.data).toEqual([
      {
        kind: "person",
        slug: "jan-kowalski",
        name: "Jan Kowalski",
        avatarUrl: "https://cdn/jan.png",
        subtitle: "Analityk",
      },
      {
        // `organization` z bazy schodzi do krótkiego `org` w interfejsie,
        // a logo staje się awatarem wiersza - inaczej firma nie ma znaku.
        kind: "org",
        slug: "acme",
        name: "ACME Polska",
        avatarUrl: "https://cdn/acme.png",
        subtitle: "Energetyka",
      },
    ]);
  });

  it.each([
    ["osoby", personRow({ slug: "" })],
    ["organizacji", orgRow({ slug: "" })],
  ])("wpis bez sluga odpada - także dla %s", async (_opis, row) => {
    // Bez sluga nie ma czego wstawić do treści (`@` + pustka), a wiersz i tak
    // zająłby miejsce na sześcioelementowej liście.
    rpcMock.mockResolvedValue({ data: [row, personRow()], error: null });
    const { result } = renderHook(() => useMentionSuggestions("a", "pl"), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data?.length).toBe(1));

    expect(result.current.data?.[0].slug).toBe("jan-kowalski");
  });

  it("wiersz o nieznanym rodzaju odpada, choć ma slug", async () => {
    // Odporność na rozszerzenie RPC: nowa gałąź UNION-u nie może wyciec do
    // listy, zanim interfejs będzie wiedział, jak ją narysować.
    rpcMock.mockResolvedValue({
      data: [personRow({ kind: "event", slug: "szczyt-2026" }), personRow()],
      error: null,
    });
    const { result } = renderHook(() => useMentionSuggestions("a", "pl"), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data?.length).toBe(1));

    expect(result.current.data?.[0].kind).toBe("person");
  });

  it("dla lang=en bierze etykietę i podpis w wersji angielskiej", async () => {
    rpcMock.mockResolvedValue({ data: [personRow(), orgRow()], error: null });
    const { result } = renderHook(() => useMentionSuggestions("a", "en"), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data?.length).toBe(2));

    expect(result.current.data?.[0].subtitle).toBe("Analyst");
    expect(result.current.data?.[1].name).toBe("ACME Poland");
    expect(result.current.data?.[1].subtitle).toBe("Energy");
  });

  it("pomija `_q` przy pustym query (lista startowa po samym @)", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    const { result } = renderHook(() => useMentionSuggestions("", "pl"), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isFetching).toBe(false));

    expect(rpcMock).toHaveBeenCalledWith("search_people_orgs", {
      _q: undefined,
      _limit: MENTION_SUGGESTION_LIMIT,
    });
  });

  it("błąd RPC degraduje do pustej listy (przed migracją / przy awarii sieci)", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "missing function" } });
    const { result } = renderHook(() => useMentionSuggestions("x", "pl"), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data).toEqual([]));
  });
});
