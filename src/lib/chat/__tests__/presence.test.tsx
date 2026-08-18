// Obecność (zielona kropka). Moduł ma stan GLOBALNY z refcountem, więc jego
// błędy są najgorszego rodzaju: nie wywracają testu jednostkowego, tylko
// migają w produkcji przy każdej zmianie trasy. Pokrycie było 0%.
//
// Trzy inwarianty, których pilnujemy:
//   1. JEDEN kanał na tenant, współdzielony przez dzwonek, dock i /messages.
//   2. OKRES ŁASKI przy zerowym refcount - remount trasy/StrictMode zwalnia
//      i natychmiast bierze ponownie; bez opóźnienia kanał ginie, migawka
//      zeruje się („wszyscy offline"), a po remouncie wraca (drugie mignięcie).
//   3. TRACK ZALEŻNY OD PREFERENCJI - `show_online_status` off obserwuje, ale
//      nie ogłasza; przełączenie flagi MUSI przebudować kanał, żeby polityka
//      INSERT-a przeliczyła się po stronie serwera.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CHAT_IDS } from "@/test/chat/fixtures";

const h = vi.hoisted(() => ({
  auth: { uid: "user-me" as string | null, tenantId: "tenant-alfa" as string | null },
  showOnline: { value: true },
  presence: { state: {} as Record<string, Array<{ user_id: string }>> },
}));

const stubs = vi.hoisted(() => ({ realtime: null as unknown }));

vi.mock("@/integrations/supabase/client", async () => {
  const fixtures = await import("@/test/chat/fixtures");
  // Atrapa czyta `h.presence.state` przez getter, więc test może zmienić
  // roster między zdarzeniami sync/join/leave.
  const realtime = fixtures.realtimeStub(
    new Proxy(
      {},
      {
        get: (_target, key: string) => h.presence.state[key],
        ownKeys: () => Object.keys(h.presence.state),
        getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
      },
    ) as Record<string, Array<{ user_id: string }>>,
  );
  stubs.realtime = realtime;
  return {
    supabase: {
      channel: realtime.channel,
      removeChannel: realtime.removeChannel,
      from: () => ({}),
      rpc: async () => ({ data: null, error: null }),
    },
  };
});

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: h.auth.uid ? { id: h.auth.uid } : null,
    tenantId: h.auth.tenantId,
  }),
}));

vi.mock("@/lib/notifications/useNotifications", () => ({
  useNotificationPreferences: () => ({ data: { show_online_status: h.showOnline.value } }),
}));

import { useOnlineUsers } from "../presence";
import { realtimeStub } from "@/test/chat/fixtures";

type RealtimeStub = ReturnType<typeof realtimeStub>;
const rt = () => stubs.realtime as RealtimeStub;

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** Wywołaj handler zdarzenia presence o danej nazwie na wskazanym kanale. */
function emitPresence(event: "sync" | "join" | "leave"): void {
  const channel = rt().channelByPrefix("chat-presence:");
  for (const listener of channel?.listeners ?? []) {
    if (listener.type === "presence" && listener.filter.event === event) {
      (listener.handler as () => void)();
    }
  }
}

beforeEach(() => {
  h.auth.uid = CHAT_IDS.me;
  h.auth.tenantId = CHAT_IDS.tenant;
  h.showOnline.value = true;
  h.presence.state = {};
  rt().reset();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useOnlineUsers", () => {
  it("stawia PRYWATNY kanał per tenant i ogłasza własną obecność", () => {
    const { unmount } = renderHook(() => useOnlineUsers(), { wrapper });

    const channel = rt().channelByPrefix("chat-presence:");
    expect(channel?.name).toBe(`chat-presence:${CHAT_IDS.tenant}`);
    // private:true - RLS na realtime.messages ogranicza JOIN i TRACK do
    // własnego tenanta, więc roster nie jest obserwowalny z zewnątrz.
    expect(channel?.config).toMatchObject({
      config: { private: true, presence: { key: CHAT_IDS.me } },
    });
    expect(channel?.sent.some((payload) => payload.type === "presence")).toBe(true);

    act(() => unmount());
    act(() => vi.advanceTimersByTime(2500));
  });

  it("z wyłączoną preferencją OBSERWUJE, ale NIE ogłasza siebie", () => {
    h.showOnline.value = false;
    const { unmount } = renderHook(() => useOnlineUsers(), { wrapper });

    const channel = rt().channelByPrefix("chat-presence:");
    expect(channel).toBeDefined();
    expect(channel?.sent.some((payload) => payload.type === "presence")).toBe(false);

    act(() => unmount());
    act(() => vi.advanceTimersByTime(2500));
  });

  it("buduje migawkę online ze stanu presence przy zdarzeniu sync", () => {
    h.presence.state = {
      [CHAT_IDS.peer]: [{ user_id: CHAT_IDS.peer }],
      [CHAT_IDS.peerTwo]: [{ user_id: CHAT_IDS.peerTwo }],
    };
    const { result, unmount } = renderHook(() => useOnlineUsers(), { wrapper });

    act(() => emitPresence("sync"));
    expect([...result.current].sort()).toEqual([CHAT_IDS.peer, CHAT_IDS.peerTwo].sort());

    act(() => unmount());
    act(() => vi.advanceTimersByTime(2500));
  });

  it("ta sama lista NIE publikuje nowej migawki (brak zbędnych renderów)", () => {
    h.presence.state = { [CHAT_IDS.peer]: [{ user_id: CHAT_IDS.peer }] };
    const { result, unmount } = renderHook(() => useOnlineUsers(), { wrapper });

    act(() => emitPresence("sync"));
    const first = result.current;
    act(() => emitPresence("join"));
    // Presence sypie zdarzeniami przy każdym przełączeniu karty; tożsamość
    // zbioru musi przeżyć, inaczej przerenderuje się KAŻDA powierzchnia czatu.
    expect(result.current).toBe(first);

    act(() => unmount());
    act(() => vi.advanceTimersByTime(2500));
  });

  it("odejście osoby zmienia migawkę", () => {
    h.presence.state = {
      [CHAT_IDS.peer]: [{ user_id: CHAT_IDS.peer }],
      [CHAT_IDS.peerTwo]: [{ user_id: CHAT_IDS.peerTwo }],
    };
    const { result, unmount } = renderHook(() => useOnlineUsers(), { wrapper });
    act(() => emitPresence("sync"));

    h.presence.state = { [CHAT_IDS.peer]: [{ user_id: CHAT_IDS.peer }] };
    act(() => emitPresence("leave"));
    expect([...result.current]).toEqual([CHAT_IDS.peer]);

    act(() => unmount());
    act(() => vi.advanceTimersByTime(2500));
  });

  it("pomija wpisy presence bez `user_id`", () => {
    h.presence.state = { ghost: [{} as { user_id: string }] };
    const { result, unmount } = renderHook(() => useOnlineUsers(), { wrapper });
    act(() => emitPresence("sync"));
    expect(result.current.size).toBe(0);

    act(() => unmount());
    act(() => vi.advanceTimersByTime(2500));
  });

  it("dwie powierzchnie dzielą JEDEN kanał", () => {
    const first = renderHook(() => useOnlineUsers(), { wrapper });
    const second = renderHook(() => useOnlineUsers(), { wrapper });

    expect(rt().channels.filter((c) => c.name.startsWith("chat-presence:"))).toHaveLength(1);

    act(() => first.unmount());
    act(() => second.unmount());
    act(() => vi.advanceTimersByTime(2500));
  });

  it("zwolnienie ostatniego odbiorcy NIE zwija kanału natychmiast (okres łaski)", () => {
    const { unmount } = renderHook(() => useOnlineUsers(), { wrapper });
    const channel = rt().channelByPrefix("chat-presence:");

    act(() => unmount());
    expect(channel?.removed).toBe(false);

    act(() => vi.advanceTimersByTime(2500));
    expect(channel?.removed).toBe(true);
  });

  it("remount w okresie łaski REUŻYWA kanału - zero mignięć offline", () => {
    const first = renderHook(() => useOnlineUsers(), { wrapper });
    const channel = rt().channelByPrefix("chat-presence:");

    act(() => first.unmount());
    const second = renderHook(() => useOnlineUsers(), { wrapper });
    act(() => vi.advanceTimersByTime(2500));

    expect(channel?.removed).toBe(false);
    expect(rt().channels.filter((c) => c.name.startsWith("chat-presence:"))).toHaveLength(1);

    act(() => second.unmount());
    act(() => vi.advanceTimersByTime(2500));
  });

  it("przełączenie preferencji PRZEBUDOWUJE kanał (polityka JOIN liczy się od nowa)", () => {
    const { rerender, unmount } = renderHook(() => useOnlineUsers(), { wrapper });
    const before = rt().channelByPrefix("chat-presence:");

    h.showOnline.value = false;
    act(() => rerender());

    const live = rt().channels.filter((c) => c.name.startsWith("chat-presence:") && !c.removed);
    expect(before?.removed).toBe(true);
    expect(live).toHaveLength(1);
    expect(live[0]).not.toBe(before);

    act(() => unmount());
    act(() => vi.advanceTimersByTime(2500));
  });

  it("bez sesji albo bez tenanta nie stawia kanału i zwraca pusty zbiór", () => {
    h.auth.uid = null;
    const anon = renderHook(() => useOnlineUsers(), { wrapper });
    expect(anon.result.current.size).toBe(0);
    expect(rt().channels).toHaveLength(0);
    anon.unmount();

    h.auth.uid = CHAT_IDS.me;
    h.auth.tenantId = null;
    const noTenant = renderHook(() => useOnlineUsers(), { wrapper });
    expect(rt().channels).toHaveLength(0);
    noTenant.unmount();
  });
});
