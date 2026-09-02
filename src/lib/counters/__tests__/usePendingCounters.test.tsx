// PO CO. Badge'e („dzwonek", czat, kluby, kolejki moderacji) przestały liczyć
// `COUNT(*)` i czytają zmaterializowane tabele utrzymywane triggerami. Ta
// zamiana przeniosła CAŁĄ poprawność na dwie rzeczy, których TypeScript nie
// widzi ani przez sekundę:
//   1. KLUCZ CACHE. `user_pending_counters` nie ma w zapytaniu żadnego
//      `.eq("user_id", …)` - odcina RLS. Jedyne, co dzieli dane KONT po stronie
//      klienta, to identyfikator w kluczu React Query. Wypadnięcie `uid`
//      z klucza nie psuje typów, nie psuje zapytania i nie psuje pierwszego
//      logowania - pokazuje cudze liczniki dopiero przy DRUGIM koncie w tej
//      samej karcie przeglądarki. Ten plik trzyma tę granicę.
//   2. FILTR KANAŁU REALTIME. `user_id=eq.<uuid>` jest jedynym powodem, dla
//      którego cudza wstawka nie budzi naszego badge'a. Literówka w filtrze nie
//      wywala niczego - po prostu zaczyna przychodzić wszystko.
// Dodatkowo pilnujemy rzeczy, które w produkcji są NIEWIDOCZNE do momentu
// awarii: że brak wiersza licznika to 0 (a nie `undefined` w JSX), że błąd
// PostgREST ląduje w stanie zapytania zamiast w cichym zerze, i że kanały
// realtime są odpinane przy odmontowaniu oraz PRZEPINANE przy zmianie konta.
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ok, fail, type SupabaseFromStub, type SupabaseResult } from "@/test/supabaseChain";

type RealtimeHandler = () => void;

const h = vi.hoisted(() => ({
  from: null as SupabaseFromStub | null,
  rpc: vi.fn<(fn: string, args?: unknown) => Promise<{ error: unknown }>>(),
  user: { current: "user-a" as string | null },
  /** Najemca per konto - konto poza mapą znaczy „najemca nierozwiązany". */
  tenantOf: { "user-a": "tenant-a", "user-z-innego-tenanta": "tenant-b" } as Record<
    string,
    string | undefined
  >,
  unsubscribe: vi.fn(),
  channels: [] as Array<{ table: string; filter?: string; handler: RealtimeHandler }>,
}));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabaseChain");
  const from = supabaseFromStub();
  h.from = from;
  return { supabase: { from: from.from, rpc: h.rpc } };
});

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: h.user.current ? { id: h.user.current } : null }),
}));

// Najemca jest ATRAPĄ, a nie prawdziwym `useCurrentTenantId`: tamten ciągnie
// klienta Supabase i własne zapytanie o profil, a przedmiotem dowodu jest to,
// że identyfikator przestrzeni roboczej WCHODZI DO KLUCZA i DO FILTRA.
// Odwzorowanie idzie z konta, bo w produkcji najemca wynika z profilu
// wołającego - zmiana konta w teście odgrywa więc przejście między
// przestrzeniami roboczymi na TYM SAMYM kliencie cache. Konto bez wpisu
// odgrywa „profil jeszcze nie wrócił" (`null`).
vi.mock("@/lib/tenant", () => ({
  useCurrentTenantId: () => (h.user.current ? (h.tenantOf[h.user.current] ?? null) : null),
}));

vi.mock("@/lib/realtime/tableChannelHub", () => ({
  subscribeToTable: (
    spec: { table: string; filter?: string },
    handler: RealtimeHandler,
  ): (() => void) => {
    h.channels.push({ ...spec, handler });
    return h.unsubscribe;
  },
}));

import {
  usePendingCounters,
  useUserCounter,
  useTenantPendingCounters,
  usePendingCountersRealtime,
  recomputeMyPendingCounters,
} from "../usePendingCounters";
import { pendingCounterKeys } from "../keys";

const USER_TABLE = "user_pending_counters";
const TENANT_TABLE = "tenant_pending_counters";

function stub(): SupabaseFromStub {
  if (!h.from) throw new Error("atrapa supabase nie została zainicjalizowana");
  return h.from;
}

function counters(rows: Record<string, number>): SupabaseResult<Array<Record<string, unknown>>> {
  return ok(Object.entries(rows).map(([counter_key, value]) => ({ counter_key, value })));
}

function makeClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function wrapperFor(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  stub().reset();
  h.rpc.mockReset();
  h.rpc.mockResolvedValue({ error: null });
  h.user.current = "user-a";
  h.unsubscribe.mockReset();
  h.channels.length = 0;
});

describe("usePendingCounters - liczniki własnego konta", () => {
  it("czyta zmaterializowaną tabelę dwiema kolumnami, nie `select(*)` ani `COUNT(*)`", async () => {
    stub().setResponse(USER_TABLE, counters({ notifications_unread: 3, chat_unread: 1 }));
    const { result } = renderHook(() => usePendingCounters(), {
      wrapper: wrapperFor(makeClient()),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // Cały sens migracji: JEDEN odczyt małej tabeli zamiast N zapytań liczących.
    expect(stub().chainsFor(USER_TABLE)).toHaveLength(1);
    expect(stub().lastChain(USER_TABLE)?.argsOf("select")).toEqual(["counter_key, value"]);
    expect(result.current.data).toEqual({ notifications_unread: 3, chat_unread: 1 });
  });

  it("NIE odpytuje bazy bez zalogowania - anonim nie ma czego liczyć", async () => {
    h.user.current = null;
    stub().setResponse(USER_TABLE, counters({ chat_unread: 9 }));
    const { result } = renderHook(() => usePendingCounters(), {
      wrapper: wrapperFor(makeClient()),
    });

    await act(async () => undefined);
    expect(stub().chainsFor(USER_TABLE)).toHaveLength(0);
    expect(result.current.fetchStatus).toBe("idle");
    expect(result.current.data).toBeUndefined();
  });

  it("pusta odpowiedź daje pusty słownik, a nie wyjątek na `null`", async () => {
    stub().setResponse(USER_TABLE, ok(null));
    const { result } = renderHook(() => usePendingCounters(), {
      wrapper: wrapperFor(makeClient()),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({});
  });

  it("błąd PostgREST ląduje w stanie zapytania, a nie w cichym zerze na badge'u", async () => {
    // Cicha pustka jest tu gorsza od czerwieni: badge pokazałby „0 nowych"
    // użytkownikowi, któremu baza właśnie odmówiła odczytu.
    stub().setResponse(USER_TABLE, fail("permission denied for table", "42501"));
    const { result } = renderHook(() => usePendingCounters(), {
      wrapper: wrapperFor(makeClient()),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
    expect((result.current.error as Error).message).toContain("permission denied");
  });

  it("liczniki konta A NIE mogą trafić do sesji konta B z tego samego cache", async () => {
    // Jedyna granica między kontami po stronie klienta. Zapytanie jest
    // identyczne dla obu - różni je WYŁĄCZNIE `uid` w kluczu.
    const client = makeClient();
    stub().setResponse(USER_TABLE, counters({ chat_unread: 42 }));
    const a = renderHook(() => usePendingCounters(), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(a.result.current.data?.chat_unread).toBe(42));
    a.unmount();

    h.user.current = "user-b";
    stub().setResponse(USER_TABLE, counters({ chat_unread: 0 }));
    const b = renderHook(() => usePendingCounters(), { wrapper: wrapperFor(client) });

    // Pierwsza klatka konta B musi być PUSTA, nie „42 z poprzedniego konta".
    expect(b.result.current.data).toBeUndefined();
    await waitFor(() => expect(b.result.current.isSuccess).toBe(true));
    expect(b.result.current.data?.chat_unread).toBe(0);
    // Dane konta A zostają pod SWOIM kluczem, nietknięte.
    expect(client.getQueryData(pendingCounterKeys.user("user-a"))).toEqual({ chat_unread: 42 });
  });

  it("okno świeżości oszczędza round-trip przy ponownym montażu badge'a", async () => {
    // `staleTime: 15_000` to powód, dla którego dzwonek, dock i strona nie
    // strzelają trzech zapytań przy tym samym renderze.
    const client = makeClient();
    stub().setResponse(USER_TABLE, counters({ club_unread: 2 }));

    const first = renderHook(() => usePendingCounters(), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    first.unmount();

    const second = renderHook(() => usePendingCounters(), { wrapper: wrapperFor(client) });
    await act(async () => undefined);
    expect(second.result.current.data?.club_unread).toBe(2);
    expect(stub().chainsFor(USER_TABLE)).toHaveLength(1);
  });
});

describe("useUserCounter - pojedynczy badge", () => {
  it("brak wiersza licznika to 0, nie `undefined` wyrenderowane w badge'u", async () => {
    stub().setResponse(USER_TABLE, counters({ notifications_unread: 5 }));
    const { result } = renderHook(() => useUserCounter("chat_unread"), {
      wrapper: wrapperFor(makeClient()),
    });

    // Zanim odpowiedź dojdzie, i po tym, jak dojdzie bez tego klucza.
    expect(result.current).toBe(0);
    await act(async () => undefined);
    expect(result.current).toBe(0);
  });

  it("zwraca wartość wskazanego klucza, w tym `club_unread`, który długo nie miał czytelnika", async () => {
    stub().setResponse(USER_TABLE, counters({ club_unread: 7, connections_pending: 1 }));
    const { result } = renderHook(() => useUserCounter("club_unread"), {
      wrapper: wrapperFor(makeClient()),
    });

    await waitFor(() => expect(result.current).toBe(7));
  });
});

describe("useTenantPendingCounters - kolejki staffu", () => {
  it("czyta tabelę tenanta dopiero, gdy wołający włączy przełącznik", async () => {
    stub().setResponse(TENANT_TABLE, counters({ comments_pending: 4 }));
    const off = renderHook(() => useTenantPendingCounters(false), {
      wrapper: wrapperFor(makeClient()),
    });
    await act(async () => undefined);
    expect(stub().chainsFor(TENANT_TABLE)).toHaveLength(0);
    expect(off.result.current.fetchStatus).toBe("idle");

    const on = renderHook(() => useTenantPendingCounters(true), {
      wrapper: wrapperFor(makeClient()),
    });
    await waitFor(() => expect(on.result.current.isSuccess).toBe(true));
    expect(on.result.current.data).toEqual({ comments_pending: 4 });
    expect(stub().lastChain(TENANT_TABLE)?.argsOf("select")).toEqual(["counter_key, value"]);
  });

  it("włączony przełącznik NIE wystarczy bez zalogowania", async () => {
    h.user.current = null;
    stub().setResponse(TENANT_TABLE, counters({ crm_leads_new: 3 }));
    const { result } = renderHook(() => useTenantPendingCounters(true), {
      wrapper: wrapperFor(makeClient()),
    });

    await act(async () => undefined);
    expect(stub().chainsFor(TENANT_TABLE)).toHaveLength(0);
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("odmowa odczytu kolejek jest widoczna, a nie zamieniona na pustą kolejkę", async () => {
    stub().setResponse(TENANT_TABLE, fail("nie jesteś staffem tego tenanta"));
    const { result } = renderHook(() => useTenantPendingCounters(true), {
      wrapper: wrapperFor(makeClient()),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });

  it("pusta tabela kolejek daje pusty słownik", async () => {
    stub().setResponse(TENANT_TABLE, ok([]));
    const { result } = renderHook(() => useTenantPendingCounters(true), {
      wrapper: wrapperFor(makeClient()),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({});
  });

  it("odpowiedź `null` (PostgREST bez wierszy) też daje słownik, nie wysypkę pętli", async () => {
    stub().setResponse(TENANT_TABLE, ok(null));
    const { result } = renderHook(() => useTenantPendingCounters(true), {
      wrapper: wrapperFor(makeClient()),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({});
  });

  it("klucz kolejek NIESIE przestrzeń roboczą - liczniki tenanta A nie trafiają do sesji tenanta B", async () => {
    // `pendingCounterKeys.tenantScoped()` niesie najemcę i konto, wbrew
    // dawnemu stałemu ["pending-counters", "tenant"] - zgodnie z regułą,
    // którą `keys.ts` zapisuje wprost przy kluczu użytkownika („zmiana konta
    // nie serwowała cudzych badge'ów z cache"). Bez tego członu JEDYNĄ
    // granicą był RLS w chwili POBRANIA, a cache oddawał wynik sprzed
    // zmiany tożsamości bez ani jednego round-tripu (staleTime 15 s).
    // Dopóki najemca wynikał z hosta, a QueryClient żył w obrębie jednej
    // karty, nie przeciekało; przeciekłoby w dniu, w którym pojawi się
    // przełącznik przestrzeni roboczej albo współdzielony host - i ten
    // przypadek odgrywa właśnie taki dzień.
    const client = makeClient();
    stub().setResponse(TENANT_TABLE, counters({ comments_pending: 11 }));
    const a = renderHook(() => useTenantPendingCounters(true), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(a.result.current.data?.comments_pending).toBe(11));
    a.unmount();

    h.user.current = "user-z-innego-tenanta";
    stub().setResponse(TENANT_TABLE, counters({ comments_pending: 0 }));
    const b = renderHook(() => useTenantPendingCounters(true), { wrapper: wrapperFor(client) });

    expect(b.result.current.data?.comments_pending).not.toBe(11);
    // Pierwsza klatka nowej tożsamości jest PUSTA, a licznik poprzedniej
    // przestrzeni zostaje pod swoim kluczem, nietknięty.
    expect(b.result.current.data).toBeUndefined();
    await waitFor(() => expect(b.result.current.data?.comments_pending).toBe(0));
    expect(client.getQueryData(pendingCounterKeys.tenantScoped("tenant-a", "user-a"))).toEqual({
      comments_pending: 11,
    });
  });

  it("zapytanie kolejek jest ZAWĘŻONE do najemcy, nie tylko przez RLS", async () => {
    // Druga połowa tej samej granicy: klucz pilnuje cache, a filtr - tego,
    // o co w ogóle pytamy bazę. Zapytanie bez `.eq("tenant_id", …)` oddaje
    // wszystko, co przepuści polityka w chwili pobrania, więc każde jej
    // poluzowanie (nowa rola sztabowa, widok serwisowy) natychmiast staje się
    // przeciekiem po stronie klienta.
    stub().setResponse(TENANT_TABLE, counters({ comments_pending: 4 }));
    const { result } = renderHook(() => useTenantPendingCounters(true), {
      wrapper: wrapperFor(makeClient()),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(stub().lastChain(TENANT_TABLE)?.argsOf("eq")).toEqual(["tenant_id", "tenant-a"]);
  });

  it("bez rozwiązanej przestrzeni roboczej zapytanie NIE startuje", async () => {
    // Pierwszy render po zalogowaniu nie zna jeszcze najemcy (`useCurrentTenantId`
    // ma własne zapytanie). Pytanie bez filtra byłoby wtedy zapytaniem o
    // kolejki WSZYSTKICH najemców - dlatego bramką jest `Boolean(tenantId)`.
    h.user.current = "user-bez-profilu";
    stub().setResponse(TENANT_TABLE, counters({ comments_pending: 7 }));
    const { result } = renderHook(() => useTenantPendingCounters(true), {
      wrapper: wrapperFor(makeClient()),
    });

    await act(async () => undefined);
    expect(stub().chainsFor(TENANT_TABLE)).toHaveLength(0);
    expect(result.current.fetchStatus).toBe("idle");
  });
});

describe("usePendingCountersRealtime - kanały", () => {
  it("zakłada JEDEN kanał zawężony do własnego `user_id`", () => {
    renderHook(() => usePendingCountersRealtime(), { wrapper: wrapperFor(makeClient()) });

    expect(h.channels).toHaveLength(1);
    expect(h.channels[0].table).toBe(USER_TABLE);
    // Bez tego filtru każda cudza wstawka budzi nasz badge.
    expect(h.channels[0].filter).toBe("user_id=eq.user-a");
  });

  it("sygnał z kanału unieważnia DOKŁADNIE klucz tego konta", () => {
    const client = makeClient();
    const spy = vi.spyOn(client, "invalidateQueries");
    renderHook(() => usePendingCountersRealtime(), { wrapper: wrapperFor(client) });

    h.channels[0].handler();

    expect(spy).toHaveBeenCalledWith({ queryKey: pendingCounterKeys.user("user-a") });
    expect(spy).not.toHaveBeenCalledWith({ queryKey: pendingCounterKeys.tenant() });
  });

  it("tryb staffu dokłada drugi kanał, unieważniający wyłącznie klucz kolejek", () => {
    const client = makeClient();
    const spy = vi.spyOn(client, "invalidateQueries");
    renderHook(() => usePendingCountersRealtime({ tenant: true }), {
      wrapper: wrapperFor(client),
    });

    expect(h.channels.map((c) => c.table)).toEqual([USER_TABLE, TENANT_TABLE]);
    // Kolejki są wspólne dla tenanta - filtr po koncie byłby tu błędem,
    // granicę stawia RLS. Test przypina ten świadomy wybór.
    expect(h.channels[1].filter).toBeUndefined();

    h.channels[1].handler();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({ queryKey: pendingCounterKeys.tenant() });
  });

  it("bez zalogowania nie zakłada nic, a odmontowanie odpina KAŻDY kanał", () => {
    h.user.current = null;
    const anon = renderHook(() => usePendingCountersRealtime({ tenant: true }), {
      wrapper: wrapperFor(makeClient()),
    });
    expect(h.channels).toHaveLength(0);
    anon.unmount();
    expect(h.unsubscribe).not.toHaveBeenCalled();

    h.user.current = "user-a";
    const signedIn = renderHook(() => usePendingCountersRealtime({ tenant: true }), {
      wrapper: wrapperFor(makeClient()),
    });
    expect(h.channels).toHaveLength(2);
    signedIn.unmount();
    expect(h.unsubscribe).toHaveBeenCalledTimes(2);
  });

  it("zmiana konta PRZEPINA kanał na nowy filtr, zamiast dokładać drugi", () => {
    // Po przelogowaniu w tej samej karcie stary kanał musi zniknąć - inaczej
    // badge'e nowego konta budzą się od zdarzeń poprzedniego.
    const client = makeClient();
    const { rerender } = renderHook(() => usePendingCountersRealtime(), {
      wrapper: wrapperFor(client),
    });
    expect(h.channels[0].filter).toBe("user_id=eq.user-a");

    h.user.current = "user-b";
    rerender();

    expect(h.unsubscribe).toHaveBeenCalledTimes(1);
    expect(h.channels).toHaveLength(2);
    expect(h.channels[1].filter).toBe("user_id=eq.user-b");
  });
});

describe("recomputeMyPendingCounters - zawór bezpieczeństwa", () => {
  it("woła RPC bez argumentów - zakres bierze się z `auth.uid()`, nie z wejścia klienta", async () => {
    await recomputeMyPendingCounters();

    expect(h.rpc).toHaveBeenCalledTimes(1);
    expect(h.rpc).toHaveBeenCalledWith("recompute_my_pending_counters");
    // Gdyby funkcja przyjmowała `p_user_id`, klient mógłby przeliczyć CUDZE
    // liczniki. Brak argumentu jest tu kontraktem bezpieczeństwa.
    expect(h.rpc.mock.calls[0]).toHaveLength(1);
  });

  it("błąd przeliczenia jest RZUCANY, a nie połykany w cichym „gotowe”", async () => {
    h.rpc.mockResolvedValue({ error: new Error("recompute failed") });
    await expect(recomputeMyPendingCounters()).rejects.toThrow("recompute failed");
  });
});
