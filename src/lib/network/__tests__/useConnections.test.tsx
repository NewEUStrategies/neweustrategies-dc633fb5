// Warstwa danych sieci kontaktów (RPC-only). Testujemy KONTRAKT z bazą, nie
// implementację react-query: nazwy i argumenty RPC, normalizację zwrotek,
// stronicowanie, zakres unieważnień po mutacji oraz to, na jakie sygnały
// realtime moduł REAGUJE (user_connections świadomie nie jest w publikacji,
// więc nasłuch idzie po sygnałach pośrednich - łatwo to zepsuć niezauważenie).
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

type RpcResult = { data: unknown; error: unknown };
type RealtimeHandler = (payload: { new?: unknown; old?: unknown }) => void;

const h = vi.hoisted(() => ({
  user: { current: "user-a" as string | null },
  rpc: vi.fn(),
  unsubscribe: vi.fn(),
  channels: [] as Array<{ table: string; filter?: string; handler: RealtimeHandler }>,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (fn: string, args?: Record<string, unknown>): Promise<RpcResult> => h.rpc(fn, args),
  },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: h.user.current ? { id: h.user.current } : null }),
}));

vi.mock("@/lib/realtime/tableChannelHub", () => ({
  subscribeToTable: (
    opts: { table: string; filter?: string },
    handler: RealtimeHandler,
  ): (() => void) => {
    h.channels.push({ ...opts, handler });
    return h.unsubscribe;
  },
}));

import {
  NO_CONNECTION,
  useCancelConnectionRequest,
  useConnectionRequests,
  useConnectionStatuses,
  useConnectionSuggestions,
  useCreateEventGroup,
  useMyConnections,
  useNetworkCounts,
  useNetworkRealtime,
  usePolicyItemFollowers,
  useRemoveConnection,
  useReportUser,
  useRespondToConnectionRequest,
  useSendConnectionRequest,
} from "../useConnections";
import { networkKeys } from "../keys";
import { pendingCounterKeys } from "@/lib/counters/keys";

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
  h.unsubscribe.mockReset();
  h.channels.length = 0;
});

describe("useConnectionStatuses", () => {
  it("mapuje wiersze RPC na stan relacji per użytkownik", async () => {
    h.rpc.mockImplementation(() =>
      ok([
        {
          user_id: "peer-1",
          status: "connected",
          connection_id: "c-1",
          mutual_count: 3,
          can_invite: false,
          degree: 1,
          bridge_id: null,
          bridge_name: null,
          bridge_avatar: null,
          bridge_slug: null,
        },
        {
          user_id: "peer-2",
          status: "none",
          connection_id: null,
          mutual_count: 0,
          can_invite: true,
          degree: 0,
          bridge_id: null,
          bridge_name: null,
          bridge_avatar: null,
          bridge_slug: null,
        },
      ]),
    );
    const client = makeClient();
    const { result } = renderHook(() => useConnectionStatuses(["peer-1", "peer-2"]), {
      wrapper: wrapperFor(client),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(h.rpc).toHaveBeenCalledWith("connection_statuses", {
      p_user_ids: ["peer-1", "peer-2"],
    });
    expect(result.current.data?.get("peer-1")).toEqual({
      status: "connected",
      connectionId: "c-1",
      mutualCount: 3,
      canInvite: false,
      degree: 1,
      bridge: null,
    });
    expect(result.current.data?.get("peer-2")?.status).toBe("none");
  });

  // Stopień oddalenia (luka #6 audytu): drugi stopień był liczony w bazie od
  // v2 i NIGDZIE nie wychodził. Kontrakt mapowania jest tu tak samo ważny jak
  // sam status - bez niego karta nie wie ani „jak daleko", ani „którędy".
  it("przenosi stopień oddalenia i most z RPC do stanu relacji", async () => {
    h.rpc.mockImplementation(() =>
      ok([
        {
          user_id: "peer-2nd",
          status: "none",
          connection_id: null,
          mutual_count: 2,
          can_invite: true,
          degree: 2,
          bridge_id: "bridge-1",
          bridge_name: "Anna Nowak",
          bridge_avatar: "https://cdn.test/anna.jpg",
          bridge_slug: "anna-nowak",
        },
        {
          // 3. stopień z mostem UKRYTYM (bez opt-inu discoverable): dystans
          // znamy, drogi nie wolno nam nazwać.
          user_id: "peer-3rd",
          status: "none",
          connection_id: null,
          mutual_count: 0,
          can_invite: true,
          degree: 3,
          bridge_id: null,
          bridge_name: null,
          bridge_avatar: null,
          bridge_slug: null,
        },
        {
          // Starsza wersja funkcji w bazie / wartość spoza zakresu degraduje
          // się do 0 zamiast wpuszczać „NaN°" do UI.
          user_id: "peer-legacy",
          status: "none",
          connection_id: null,
          mutual_count: 0,
          can_invite: true,
          degree: 9,
          bridge_id: "bridge-1",
          bridge_name: "Anna Nowak",
          bridge_avatar: null,
          bridge_slug: null,
        },
      ]),
    );
    const client = makeClient();
    const { result } = renderHook(
      () => useConnectionStatuses(["peer-2nd", "peer-3rd", "peer-legacy"]),
      { wrapper: wrapperFor(client) },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.get("peer-2nd")).toMatchObject({
      degree: 2,
      bridge: {
        id: "bridge-1",
        name: "Anna Nowak",
        avatarUrl: "https://cdn.test/anna.jpg",
        slug: "anna-nowak",
      },
    });
    expect(result.current.data?.get("peer-3rd")).toMatchObject({ degree: 3, bridge: null });
    expect(result.current.data?.get("peer-legacy")).toMatchObject({ degree: 0, bridge: null });
  });

  it("odrzuca status spoza słownika zamiast wpuszczać go do UI", async () => {
    h.rpc.mockImplementation(() =>
      ok([
        { user_id: "peer-x", status: "banana", connection_id: null, mutual_count: 0 },
        {
          user_id: "peer-ok",
          status: "pending_out",
          connection_id: "c-2",
          mutual_count: 1,
          can_invite: false,
        },
      ]),
    );
    const client = makeClient();
    const { result } = renderHook(() => useConnectionStatuses(["peer-x", "peer-ok"]), {
      wrapper: wrapperFor(client),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.has("peer-x")).toBe(false);
    expect(result.current.data?.get("peer-ok")?.status).toBe("pending_out");
  });

  it("nie odpytuje bazy przy pustej liście ani bez zalogowania", async () => {
    const client = makeClient();
    renderHook(() => useConnectionStatuses([]), { wrapper: wrapperFor(client) });
    h.user.current = null;
    renderHook(() => useConnectionStatuses(["peer-1"]), { wrapper: wrapperFor(client) });
    await Promise.resolve();
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("propaguje błąd RPC zamiast udawać pustą sieć", async () => {
    h.rpc.mockImplementation(() =>
      Promise.resolve({ data: null, error: { message: "permission denied" } }),
    );
    const client = makeClient();
    const { result } = renderHook(() => useConnectionStatuses(["peer-1"]), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it("NO_CONNECTION jest neutralnym stanem startowym karty", () => {
    expect(NO_CONNECTION).toEqual({
      status: "none",
      connectionId: null,
      mutualCount: 0,
      canInvite: true,
      // „Poza zasięgiem" to brak twierdzenia, a nie twierdzenie o dystansie -
      // UI ma wtedy nie rysować żadnej odznaki.
      degree: 0,
      bridge: null,
    });
  });
});

describe("useMyConnections", () => {
  it("dociąga kolejną stronę dopiero, gdy jest co dociągać", async () => {
    h.rpc.mockImplementation((_fn: string, args: Record<string, unknown>) => {
      const offset = args.p_offset as number;
      // total_count = 3 przy stronie 2 => jest jeszcze jeden wiersz.
      if (offset === 0) {
        return ok([
          { user_id: "p1", total_count: 3 },
          { user_id: "p2", total_count: 3 },
        ]);
      }
      return ok([{ user_id: "p3", total_count: 3 }]);
    });
    const client = makeClient();
    const { result } = renderHook(() => useMyConnections("  ala  ", 2), {
      wrapper: wrapperFor(client),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // Zapytanie jest przycinane przed wysłaniem (spójne z kluczem cache).
    expect(h.rpc).toHaveBeenCalledWith("my_connections", {
      p_query: "ala",
      p_limit: 2,
      p_offset: 0,
    });
    expect(result.current.hasNextPage).toBe(true);

    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(2));
    // Strona krótsza niż limit = koniec listy.
    expect(result.current.hasNextPage).toBe(false);
  });

  it("nie dociąga dalej, gdy strona jest krótsza od limitu", async () => {
    h.rpc.mockImplementation(() => ok([{ user_id: "p1", total_count: 99 }]));
    const client = makeClient();
    const { result } = renderHook(() => useMyConnections("", 24), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.hasNextPage).toBe(false);
  });
});

describe("skrzynki, liczniki i sugestie", () => {
  it("useConnectionRequests przekazuje kierunek i limit", async () => {
    h.rpc.mockImplementation(() => ok([{ user_id: "p1" }]));
    const client = makeClient();
    const { result } = renderHook(() => useConnectionRequests("out"), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(h.rpc).toHaveBeenCalledWith("my_connection_requests", {
      p_direction: "out",
      p_limit: 50,
    });
  });

  it("useNetworkCounts zwraca zera, gdy RPC nie ma jeszcze wiersza", async () => {
    h.rpc.mockImplementation(() => ok([]));
    const client = makeClient();
    const { result } = renderHook(() => useNetworkCounts(), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ connections: 0, pending_in: 0, pending_out: 0 });
  });

  it("useConnectionSuggestions oddaje pustą listę zamiast null", async () => {
    h.rpc.mockImplementation(() => ok(null));
    const client = makeClient();
    const { result } = renderHook(() => useConnectionSuggestions(5), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
    expect(h.rpc).toHaveBeenCalledWith("connection_suggestions", { p_limit: 5 });
  });

  it("usePolicyItemFollowers milczy bez dossier", async () => {
    const client = makeClient();
    renderHook(() => usePolicyItemFollowers(null), { wrapper: wrapperFor(client) });
    await Promise.resolve();
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("usePolicyItemFollowers przekazuje dossier i limit", async () => {
    h.rpc.mockImplementation(() => ok([{ user_id: "p1" }]));
    const client = makeClient();
    const { result } = renderHook(() => usePolicyItemFollowers("item-1", 3), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(h.rpc).toHaveBeenCalledWith("policy_item_followers", {
      p_item_id: "item-1",
      p_limit: 3,
    });
  });
});

describe("mutacje sieci", () => {
  it("zaproszenie przycina notkę, a pustą pomija", async () => {
    h.rpc.mockImplementation(() => ok("conn-1"));
    const client = makeClient();
    const { result } = renderHook(() => useSendConnectionRequest(), {
      wrapper: wrapperFor(client),
    });

    await act(async () => {
      await result.current.mutateAsync({ userId: "peer-1", message: "  cześć  " });
    });
    expect(h.rpc).toHaveBeenLastCalledWith("connection_request", {
      p_user_id: "peer-1",
      p_message: "cześć",
    });

    await act(async () => {
      await result.current.mutateAsync({ userId: "peer-2", message: "   " });
    });
    expect(h.rpc).toHaveBeenLastCalledWith("connection_request", {
      p_user_id: "peer-2",
      p_message: undefined,
    });
  });

  it("każda mutacja unieważnia CAŁY zakres sieci i licznik badge'a", async () => {
    h.rpc.mockImplementation(() => ok(null));
    const client = makeClient();
    const spy = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(
      () => ({
        respond: useRespondToConnectionRequest(),
        cancel: useCancelConnectionRequest(),
        remove: useRemoveConnection(),
      }),
      { wrapper: wrapperFor(client) },
    );

    await act(async () => {
      await result.current.respond.mutateAsync({ connectionId: "c-1", accept: true });
    });
    expect(h.rpc).toHaveBeenLastCalledWith("connection_respond", {
      p_connection_id: "c-1",
      p_accept: true,
    });

    await act(async () => {
      await result.current.cancel.mutateAsync("c-2");
    });
    expect(h.rpc).toHaveBeenLastCalledWith("connection_cancel", { p_connection_id: "c-2" });

    await act(async () => {
      await result.current.remove.mutateAsync("peer-9");
    });
    expect(h.rpc).toHaveBeenLastCalledWith("connection_remove", { p_user_id: "peer-9" });

    const invalidated = spy.mock.calls.map(([arg]) => JSON.stringify(arg?.queryKey));
    expect(invalidated).toContain(JSON.stringify(networkKeys.all));
    expect(invalidated).toContain(JSON.stringify(pendingCounterKeys.user("user-a")));
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(6);
  });

  it("zgłoszenie użytkownika przycina szczegóły i nie wysyła pustych", async () => {
    h.rpc.mockImplementation(() => ok("report-1"));
    const client = makeClient();
    const { result } = renderHook(() => useReportUser(), { wrapper: wrapperFor(client) });

    await act(async () => {
      await result.current.mutateAsync({ userId: "peer-1", reason: "spam", details: "  bo  " });
    });
    expect(h.rpc).toHaveBeenLastCalledWith("report_user", {
      p_user_id: "peer-1",
      p_reason: "spam",
      p_details: "bo",
    });

    await act(async () => {
      await result.current.mutateAsync({ userId: "peer-1", reason: "spam" });
    });
    expect(h.rpc).toHaveBeenLastCalledWith("report_user", {
      p_user_id: "peer-1",
      p_reason: "spam",
      p_details: undefined,
    });
  });

  it("krąg wydarzenia odświeża listę rozmów", async () => {
    h.rpc.mockImplementation(() => ok("conv-1"));
    const client = makeClient();
    const spy = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useCreateEventGroup(), { wrapper: wrapperFor(client) });

    await act(async () => {
      const id = await result.current.mutateAsync("event-1");
      expect(id).toBe("conv-1");
    });
    expect(h.rpc).toHaveBeenLastCalledWith("create_event_group", { p_event_id: "event-1" });
    expect(spy.mock.calls.map(([arg]) => JSON.stringify(arg?.queryKey))).toContain(
      JSON.stringify(["chat"]),
    );
  });

  it("błąd RPC nie kończy się cichym sukcesem mutacji", async () => {
    h.rpc.mockImplementation(() =>
      Promise.resolve({ data: null, error: { message: "chat: blocked" } }),
    );
    const client = makeClient();
    const { result } = renderHook(() => useSendConnectionRequest(), {
      wrapper: wrapperFor(client),
    });
    await expect(
      act(async () => {
        await result.current.mutateAsync({ userId: "peer-1" });
      }),
    ).rejects.toBeTruthy();
  });
});

describe("useNetworkRealtime", () => {
  it("nasłuchuje sygnałów POŚREDNICH, bo user_connections nie jest publikowany", () => {
    const client = makeClient();
    renderHook(() => useNetworkRealtime(), { wrapper: wrapperFor(client) });
    expect(h.channels.map((c) => c.table).sort()).toEqual([
      "notifications",
      "user_pending_counters",
    ]);
    // Filtr po koncie: kanał nie może przynosić cudzych zdarzeń.
    for (const channel of h.channels) {
      expect(channel.filter).toBe("user_id=eq.user-a");
    }
  });

  it("reaguje TYLKO na powiadomienie o relacji i licznik zaproszeń", () => {
    const client = makeClient();
    const spy = vi.spyOn(client, "invalidateQueries");
    renderHook(() => useNetworkRealtime(), { wrapper: wrapperFor(client) });

    const notifications = h.channels.find((c) => c.table === "notifications");
    const counters = h.channels.find((c) => c.table === "user_pending_counters");

    notifications?.handler({ new: { kind: "message" } });
    counters?.handler({ new: { counter_key: "chat_unread" } });
    expect(spy).not.toHaveBeenCalled();

    notifications?.handler({ new: { kind: "connection" } });
    expect(spy).toHaveBeenCalled();

    spy.mockClear();
    // DELETE przychodzi bez `new` - liczy się wiersz `old`.
    counters?.handler({ old: { counter_key: "connections_pending" } });
    expect(spy).toHaveBeenCalled();
  });

  it("nie subskrybuje nic bez zalogowania i sprząta po odmontowaniu", () => {
    h.user.current = null;
    const client = makeClient();
    const anon = renderHook(() => useNetworkRealtime(), { wrapper: wrapperFor(client) });
    expect(h.channels).toHaveLength(0);
    anon.unmount();

    h.user.current = "user-a";
    const signedIn = renderHook(() => useNetworkRealtime(), { wrapper: wrapperFor(client) });
    expect(h.channels).toHaveLength(2);
    signedIn.unmount();
    expect(h.unsubscribe).toHaveBeenCalledTimes(2);
  });
});
