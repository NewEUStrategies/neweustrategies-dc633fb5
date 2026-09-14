// Obserwowanie (`user_follows`) i feed obserwowanych - WARSTWA DANYCH.
//
// STAN WYJŚCIOWY, zmierzony: `useFollows.ts` stało na 82,6% linii BEZ ANI
// JEDNEGO WŁASNEGO TESTU, a `useFollowedFeed.ts` na okrągłym zerze. Te 82,6%
// brały się z czterech cudzych plików (`FollowButton.test.tsx`,
// `LoginPopup.test.tsx`, `profileListRoutes.test.tsx`, `readingListRoute.test.tsx`),
// które wołają hook przy okazji SWOJEGO tematu.
//
// To jest pokrycie BEZ KONTRAKTU i różnica jest praktyczna, nie formalna: skoro
// nikt nie zapisał, co ten hook ma robić, zmiana jego zachowania nie ma jak
// zapalić czerwieni U SIEBIE. Zapali ją gdzie indziej, w teście cudzego
// komponentu, z komunikatem mówiącym o czymś zupełnie innym - a wtedy
// najtańszą naprawą wygląda dopasowanie TAMTEGO testu. Zadanie brzmi więc
// „zapisz kontrakt, który już działa", nie „podnieś liczbę".
//
// Reguły, których złamanie widzi użytkownik (albo INNY użytkownik):
//
//   1. USUNIĘCIE JEST ZAWĘŻONE POTRÓJNIE - `user_id` ORAZ `target_type` ORAZ
//      `target_id`. Grant DELETE na `user_follows` ma `authenticated`, więc to
//      te trzy `.eq()` powstrzymują skasowanie cudzej obserwacji; zgubienie
//      `target_type` kasuje wpis o tym samym id z INNEJ zakładki (autor i tag
//      mogą mieć równe identyfikatory - to osobne przestrzenie nazw).
//   2. DUPLIKAT NIE JEST BŁĘDEM. Dwie karty albo dwa kliknięcia trafiają
//      w unikat `(user_id, target_type, target_id)`; użytkownik ma zobaczyć
//      obserwowany byt, nie komunikat awarii. Stąd `ignoreDuplicates`, a nie
//      łapanie błędu po TREŚCI komunikatu (ta jest zlokalizowana i zmienna).
//   3. JEDNA TABELA, WIELE WIDOKÓW. Chipy follow, zainteresowania, liczniki
//      profilu, rekomendacje i feed obserwowanych czytają ten sam wiersz, więc
//      po zapisie muszą zostać unieważnione WSZYSTKIE PIĘĆ zakresów. Pominięty
//      zakres to widok, który po kliknięciu „obserwuj" dalej pokazuje stan
//      sprzed kliknięcia.
//   4. BEZ SESJI HOOK NIE PUKA DO BAZY (`enabled: !!user`), a mutacja odmawia
//      zamiast wysyłać zapis bez właściciela.
//   5. FEED STRONICUJE PO `total_count`, nie po „czy przyszła pełna strona":
//      ostatnia strona równa rozmiarowi okna nie może generować pustego
//      dociągnięcia w kółko.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const h = vi.hoisted(() => ({ user: null as { id: string } | null }));
const stubs = vi.hoisted(() => ({ from: null as unknown, rpc: null as unknown }));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabaseChain");
  const { supabaseRpcStub } = await import("@/test/supabase/rpc");
  const from = supabaseFromStub();
  const rpc = supabaseRpcStub();
  stubs.from = from;
  stubs.rpc = rpc;
  return { supabase: { from: from.from, rpc: rpc.rpc } };
});

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: h.user }) }));

import { useFollows, useToggleFollow, type Follow } from "@/hooks/useFollows";
import { useFollowedFeed } from "@/hooks/useFollowedFeed";
import { ok, type SupabaseFromStub } from "@/test/supabaseChain";
import type { SupabaseRpcStub } from "@/test/supabase/rpc";

const from = () => stubs.from as SupabaseFromStub;
const rpc = () => stubs.rpc as SupabaseRpcStub;

const USER = "user-follows-1";
const AUTHOR = "author-7";

function harness() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidated: unknown[] = [];
  const original = queryClient.invalidateQueries.bind(queryClient);
  vi.spyOn(queryClient, "invalidateQueries").mockImplementation((filters) => {
    invalidated.push((filters as { queryKey?: unknown })?.queryKey);
    return original(filters);
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper, invalidated };
}

function followRow(overrides: Partial<Follow> = {}): Follow {
  return {
    id: "fol-1",
    target_type: "author",
    target_id: AUTHOR,
    created_at: "2026-09-01T10:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  from().reset();
  rpc().reset();
  h.user = { id: USER };
});

describe("useFollows - odczyt listy obserwowanych", () => {
  it("czyta obserwacje zalogowanego konta, najnowsze na górze", async () => {
    from().setResponse(
      "user_follows",
      ok([followRow(), followRow({ id: "fol-2", target_type: "tag", target_id: "tag-3" })]),
    );
    const { wrapper } = harness();

    const { result } = renderHook(() => useFollows(), { wrapper });

    await waitFor(() => expect(result.current.data).toHaveLength(2));
    expect(from().lastChain("user_follows")?.argsOf("order")).toEqual([
      "created_at",
      { ascending: false },
    ]);
  });

  it("bez sesji nie puka do bazy", async () => {
    h.user = null;
    const { wrapper } = harness();

    const { result } = renderHook(() => useFollows(), { wrapper });

    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(from().lastChain("user_follows")).toBeUndefined();
  });

  it("brak wierszy oddaje pustą listę, nie `null`", async () => {
    from().setResponse("user_follows", ok(null));
    const { wrapper } = harness();

    const { result } = renderHook(() => useFollows(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it("błąd bazy nie kończy się cichą pustą listą", async () => {
    from().setResponse("user_follows", {
      data: null,
      error: Object.assign(new Error("rls denied"), { name: "PostgrestError" }),
    });
    const { wrapper } = harness();

    const { result } = renderHook(() => useFollows(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it("cache jest izolowany per konto - klucz niesie id użytkownika", async () => {
    from().setResponse("user_follows", ok([followRow()]));
    const { wrapper, queryClient } = harness();

    const { result } = renderHook(() => useFollows(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(queryClient.getQueryData(["follows", USER])).toHaveLength(1);
    expect(queryClient.getQueryData(["follows", "someone-else"])).toBeUndefined();
  });
});

describe("useToggleFollow - zapis", () => {
  it("włączenie obserwacji to upsert z konfliktem po trójce i BEZ błędu na duplikacie", async () => {
    from().setResponse("user_follows", ok(null));
    const { wrapper } = harness();

    const { result } = renderHook(() => useToggleFollow(), { wrapper });
    await result.current.mutateAsync({ targetType: "author", targetId: AUTHOR, on: true });

    const chain = from().lastChain("user_follows");
    expect(chain?.argsOf("upsert")).toEqual([
      { user_id: USER, target_type: "author", target_id: AUTHOR },
      { onConflict: "user_id,target_type,target_id", ignoreDuplicates: true },
    ]);
  });

  it("wyłączenie zawęża usunięcie POTRÓJNIE - właściciel, typ bytu i jego id", async () => {
    from().setResponse("user_follows", ok(null));
    const { wrapper } = harness();

    const { result } = renderHook(() => useToggleFollow(), { wrapper });
    await result.current.mutateAsync({ targetType: "tag", targetId: "tag-3", on: false });

    const chain = from().lastChain("user_follows");
    expect(chain?.calls.filter((c) => c.method === "eq").map((c) => c.args)).toEqual([
      ["user_id", USER],
      ["target_type", "tag"],
      ["target_id", "tag-3"],
    ]);
  });

  it("bez sesji mutacja ODMAWIA zamiast wysyłać zapis bez właściciela", async () => {
    h.user = null;
    const { wrapper } = harness();

    const { result } = renderHook(() => useToggleFollow(), { wrapper });
    await expect(
      result.current.mutateAsync({ targetType: "author", targetId: AUTHOR, on: true }),
    ).rejects.toThrow("Not authenticated");
    expect(from().lastChain("user_follows")).toBeUndefined();
  });

  it("odmowa bazy nie kończy się cichym sukcesem", async () => {
    from().setResponse("user_follows", {
      data: null,
      error: Object.assign(new Error("rls denied"), { name: "PostgrestError" }),
    });
    const { wrapper } = harness();

    const { result } = renderHook(() => useToggleFollow(), { wrapper });
    await expect(
      result.current.mutateAsync({ targetType: "author", targetId: AUTHOR, on: true }),
    ).rejects.toThrow("rls denied");
  });

  it("udany zapis unieważnia WSZYSTKIE PIĘĆ widoków tej samej tabeli", async () => {
    from().setResponse("user_follows", ok(null));
    const { wrapper, invalidated } = harness();

    const { result } = renderHook(() => useToggleFollow(), { wrapper });
    await result.current.mutateAsync({ targetType: "author", targetId: AUTHOR, on: true });

    await waitFor(() => expect(invalidated.length).toBeGreaterThanOrEqual(5));
    expect(invalidated).toEqual(
      expect.arrayContaining([
        ["follows", USER],
        ["my-interests"],
        ["profile-counts"],
        ["recommended-posts"],
        ["followed-feed"],
      ]),
    );
  });
});

describe("useFollowedFeed - feed obserwowanych", () => {
  const page = (offset: number, size: number, total: number) =>
    Array.from({ length: size }, (_, i) => ({
      id: `post-${offset + i}`,
      total_count: total,
    }));

  it("pyta RPC o okno strony i zaczyna od offsetu zero", async () => {
    rpc().setData("get_followed_feed", page(0, 3, 3));
    const { wrapper } = harness();

    const { result } = renderHook(() => useFollowedFeed(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const call = rpc().lastCall("get_followed_feed");
    expect(call?.arg("p_limit")).toBe(12);
    expect(call?.arg("p_offset")).toBe(0);
  });

  it("bez sesji nie woła RPC", async () => {
    h.user = null;
    const { wrapper } = harness();

    const { result } = renderHook(() => useFollowedFeed(), { wrapper });

    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(rpc().callsFor("get_followed_feed")).toHaveLength(0);
  });

  it("dociąga drugą stronę od offsetu równego liczbie wczytanych wierszy", async () => {
    rpc().setResponse("get_followed_feed", (call) => {
      const offset = Number(call.arg("p_offset") ?? 0);
      return ok(offset === 0 ? page(0, 4, 6) : page(4, 2, 6));
    });
    const { wrapper } = harness();

    const { result } = renderHook(() => useFollowedFeed(4), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.hasNextPage).toBe(true);

    await result.current.fetchNextPage();

    await waitFor(() => expect(result.current.data?.pages).toHaveLength(2));
    expect(rpc().lastCall("get_followed_feed")?.arg("p_offset")).toBe(4);
    await waitFor(() => expect(result.current.hasNextPage).toBe(false));
  });

  it("pełna strona, która domyka `total_count`, NIE generuje pustego dociągnięcia", async () => {
    // Gdyby warunek brzmiał „przyszła pełna strona", ostatnia strona równa
    // rozmiarowi okna prosiłaby o kolejną w nieskończoność.
    rpc().setData("get_followed_feed", page(0, 4, 4));
    const { wrapper } = harness();

    const { result } = renderHook(() => useFollowedFeed(4), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.hasNextPage).toBe(false);
  });

  it("pusta zwrotka RPC oddaje pustą stronę zamiast `null`", async () => {
    rpc().setData("get_followed_feed", null);
    const { wrapper } = harness();

    const { result } = renderHook(() => useFollowedFeed(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.pages).toEqual([[]]);
    expect(result.current.hasNextPage).toBe(false);
  });

  it("błąd RPC nie udaje pustego feedu", async () => {
    rpc().setError("get_followed_feed", "feed unavailable");
    const { wrapper } = harness();

    const { result } = renderHook(() => useFollowedFeed(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
