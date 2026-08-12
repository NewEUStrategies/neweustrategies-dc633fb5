// PĘTLA ZWROTNA sugestii kontaktów: ukrycie osoby, licznik ukrytych,
// przywrócenie wszystkich.
//
// Ten moduł miał 0% pokrycia i sam ściągał cały katalog `src/lib/network`
// poniżej progu (statements 82,77% wobec 85%). Był przy tym jedyną warstwą,
// której poprawność widać wyłącznie w efektach ubocznych: same wywołania RPC
// są trywialne, ale unieważnianie cache decyduje o tym, czy karta znika, a
// licznik „Przywróć ukryte (N)" nadal twierdzi, że ukrytych nie ma.
//
// Testy pilnują trzech rzeczy, których nie widać w sygnaturze:
//   * kontraktu z bazą (nazwy RPC i nazwa parametru `p_user_id`) - rozjazd
//     słownika akcji już raz kosztował moduł rekomendacji ciche „sukcesy";
//   * unieważniania CAŁEGO zakresu `network`, nie tylko listy sugestii - lista
//     i licznik muszą zgadzać się w tej samej klatce;
//   * izolacji kont w cache: klucz licznika zawiera user id, więc zmiana konta
//     nie serwuje cudzej liczby ukrytych.
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

type RpcResult = { data: unknown; error: unknown };

const h = vi.hoisted(() => ({
  user: { current: "user-a" as string | null },
  rpc: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (fn: string, args?: Record<string, unknown>): Promise<RpcResult> => h.rpc(fn, args),
  },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: h.user.current ? { id: h.user.current } : null }),
}));

import {
  useDismissSuggestion,
  useDismissedSuggestionsCount,
  useRestoreSuggestions,
} from "../useSuggestionFeedback";

function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function wrapperFor(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function ok(data: unknown): Promise<RpcResult> {
  return Promise.resolve({ data, error: null });
}

beforeEach(() => {
  h.user.current = "user-a";
  h.rpc.mockReset();
});

describe("licznik ukrytych sugestii", () => {
  it("czyta liczbę przez my_dismissed_suggestions_count", async () => {
    h.rpc.mockImplementation(() => ok(3));
    const { result } = renderHook(() => useDismissedSuggestionsCount(), {
      wrapper: wrapperFor(makeClient()),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(h.rpc).toHaveBeenCalledWith("my_dismissed_suggestions_count", undefined);
    expect(result.current.data).toBe(3);
  });

  it("traktuje odpowiedź nienumeryczną jako zero", async () => {
    // RPC zwracające NULL (brak wiersza) nie może dać „Przywróć ukryte (null)".
    h.rpc.mockImplementation(() => ok(null));
    const { result } = renderHook(() => useDismissedSuggestionsCount(), {
      wrapper: wrapperFor(makeClient()),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe(0);
  });

  it("nie odpytuje bazy bez zalogowanego użytkownika", async () => {
    h.user.current = null;
    renderHook(() => useDismissedSuggestionsCount(), { wrapper: wrapperFor(makeClient()) });
    await Promise.resolve();
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("podnosi błąd bazy zamiast zgłaszać zero ukrytych", async () => {
    h.rpc.mockImplementation(() => Promise.resolve({ data: null, error: { message: "denied" } }));
    const { result } = renderHook(() => useDismissedSuggestionsCount(), {
      wrapper: wrapperFor(makeClient()),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it("trzyma user id w kluczu cache - zmiana konta nie dziedziczy liczby", async () => {
    const client = makeClient();
    h.rpc.mockImplementation(() => ok(3));
    const first = renderHook(() => useDismissedSuggestionsCount(), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));

    h.user.current = "user-b";
    h.rpc.mockImplementation(() => ok(7));
    const second = renderHook(() => useDismissedSuggestionsCount(), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() => expect(second.result.current.data).toBe(7));

    expect(client.getQueryData(["network", "suggestions", "dismissed-count", "user-a"])).toBe(3);
    expect(client.getQueryData(["network", "suggestions", "dismissed-count", "user-b"])).toBe(7);
  });
});

describe("ukrycie jednej sugestii", () => {
  it("woła dismiss_connection_suggestion z p_user_id", async () => {
    h.rpc.mockImplementation(() => ok(null));
    const { result } = renderHook(() => useDismissSuggestion(), {
      wrapper: wrapperFor(makeClient()),
    });
    await act(async () => {
      await result.current.mutateAsync("peer-1");
    });
    expect(h.rpc).toHaveBeenCalledWith("dismiss_connection_suggestion", { p_user_id: "peer-1" });
  });

  it("unieważnia CAŁY zakres sieci oraz licznik ukrytych", async () => {
    // Gdyby unieważniana była tylko lista sugestii, karta zniknęłaby, a licznik
    // „Przywróć ukryte (N)" pokazywałby starą wartość do następnego wejścia.
    const client = makeClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    h.rpc.mockImplementation(() => ok(null));
    const { result } = renderHook(() => useDismissSuggestion(), { wrapper: wrapperFor(client) });
    await act(async () => {
      await result.current.mutateAsync("peer-1");
    });
    const keys = invalidate.mock.calls.map((call) => call[0]?.queryKey);
    expect(keys).toContainEqual(["network"]);
    expect(keys).toContainEqual(["network", "suggestions", "dismissed-count", "user-a"]);
  });

  it("propaguje błąd bazy - odmowa nie może wyglądać jak sukces", async () => {
    h.rpc.mockImplementation(() => Promise.resolve({ data: null, error: { message: "denied" } }));
    const { result } = renderHook(() => useDismissSuggestion(), {
      wrapper: wrapperFor(makeClient()),
    });
    await expect(result.current.mutateAsync("peer-1")).rejects.toMatchObject({
      message: "denied",
    });
  });
});

describe("przywrócenie ukrytych sugestii", () => {
  it("woła restore_connection_suggestions i zwraca liczbę wierszy", async () => {
    h.rpc.mockImplementation(() => ok(5));
    const { result } = renderHook(() => useRestoreSuggestions(), {
      wrapper: wrapperFor(makeClient()),
    });
    let restored = -1;
    await act(async () => {
      restored = await result.current.mutateAsync();
    });
    expect(h.rpc).toHaveBeenCalledWith("restore_connection_suggestions", undefined);
    expect(restored).toBe(5);
  });

  it("traktuje odpowiedź nienumeryczną jako zero przywróconych", async () => {
    h.rpc.mockImplementation(() => ok(undefined));
    const { result } = renderHook(() => useRestoreSuggestions(), {
      wrapper: wrapperFor(makeClient()),
    });
    let restored = -1;
    await act(async () => {
      restored = await result.current.mutateAsync();
    });
    expect(restored).toBe(0);
  });

  it("unieważnia zakres sieci oraz licznik ukrytych", async () => {
    const client = makeClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    h.rpc.mockImplementation(() => ok(2));
    const { result } = renderHook(() => useRestoreSuggestions(), { wrapper: wrapperFor(client) });
    await act(async () => {
      await result.current.mutateAsync();
    });
    const keys = invalidate.mock.calls.map((call) => call[0]?.queryKey);
    expect(keys).toContainEqual(["network"]);
    expect(keys).toContainEqual(["network", "suggestions", "dismissed-count", "user-a"]);
  });

  it("propaguje błąd bazy", async () => {
    h.rpc.mockImplementation(() => Promise.resolve({ data: null, error: { message: "boom" } }));
    const { result } = renderHook(() => useRestoreSuggestions(), {
      wrapper: wrapperFor(makeClient()),
    });
    await expect(result.current.mutateAsync()).rejects.toMatchObject({ message: "boom" });
  });
});
