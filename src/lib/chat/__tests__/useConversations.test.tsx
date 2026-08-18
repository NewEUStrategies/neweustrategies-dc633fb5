// Warstwa danych LISTY ROZMÓW. Cztery rzeczy, które audyt wskazał jako
// zrobione wzorowo - i które właśnie dlatego muszą mieć test, bo regresja
// w nich jest niewidoczna gołym okiem:
//
//   1. TOŻSAMOŚĆ WĄTKU Z `direct_key`, nie z wiersza uczestnika. RLS ukrywa
//      wiersz rozmówcy, który wyłączył potwierdzenia odczytu - gdyby tożsamość
//      wisiała na `peers[0]`, taka rozmowa straciłaby nazwę i avatar.
//   2. LICZNIK NIEPRZECZYTANYCH WYPROWADZONY z tego samego zapytania
//      (`select`), a nie drugim round-tripem z własnym cyklem unieważnień.
//   3. JEDEN kanał realtime na użytkownika, przez hub z refcountem.
//   4. Kolejność WhatsAppa: przypięte najpierw (najnowsza przypinka na górze),
//      potem po ostatniej aktywności.
//
// Do tej pory plik miał 12% pokrycia.
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  BASE_ISO,
  CHAT_IDS,
  chatContactHit,
  conversationRow,
  conversationView,
  groupConversationRow,
  isoOffset,
  participantRow,
  peerProfile,
  supabaseFromStub,
  type SupabaseResult,
} from "@/test/chat/fixtures";
import type { ConversationView, ParticipantRow } from "../types";

type TableHandler = (payload: unknown) => void;

const h = vi.hoisted(() => ({
  auth: { uid: "user-me" as string | null, tenantId: "tenant-alfa" as string | null },
  rpc: vi.fn(),
  unsubscribe: vi.fn(),
  subscriptions: [] as Array<{ table: string; filter?: string; handler: TableHandler }>,
  invalidateMuteCache: vi.fn(),
  openExpertRequestDialog: vi.fn(),
}));

const stubs = vi.hoisted(() => ({ from: null as unknown }));

vi.mock("@/integrations/supabase/client", async () => {
  const fixtures = await import("@/test/chat/fixtures");
  const from = fixtures.supabaseFromStub();
  stubs.from = from;
  return {
    supabase: {
      from: from.from,
      rpc: (fn: string, args?: Record<string, unknown>): Promise<SupabaseResult> => h.rpc(fn, args),
    },
  };
});

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: h.auth.uid ? { id: h.auth.uid } : null,
    tenantId: h.auth.tenantId,
  }),
}));

vi.mock("@/lib/realtime/tableChannelHub", () => ({
  subscribeToTable: (
    opts: { table: string; filter?: string },
    handler: TableHandler,
  ): (() => void) => {
    h.subscriptions.push({ ...opts, handler });
    return h.unsubscribe;
  },
}));

vi.mock("../useIncomingChatToasts", () => ({
  invalidateMuteCache: h.invalidateMuteCache,
}));

vi.mock("../expertRequestDialogBus", () => ({
  openExpertRequestDialog: h.openExpertRequestDialog,
}));

import {
  applyArchiveFlipToViews,
  applyReopenToViews,
  isMuted,
  mutedUntilMs,
  splitArchived,
  useChatListRealtime,
  useChatUnreadTotal,
  useClearConversationHistory,
  useConversations,
  useMarkConversationRead,
  usePeerProfiles,
  usePeopleSearch,
  useSetConversationAppearance,
  useSetConversationArchived,
  useSetConversationMuted,
  useSetConversationPinned,
  useSetGroupDescription,
  useSetMessageTtl,
  useStartConversation,
} from "../useConversations";
import { chatKeys } from "../keys";

type FromStub = ReturnType<typeof supabaseFromStub>;
const db = () => stubs.from as FromStub;

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

function ok(data: unknown): Promise<SupabaseResult> {
  return Promise.resolve({ data, error: null });
}

function rpcFail(message: string): Promise<SupabaseResult> {
  const error = new Error(message);
  error.name = "PostgrestError";
  return Promise.resolve({ data: null, error });
}

/** Wiersz z zagnieżdżoną rozmową - dokładnie to, co zwraca embed PostgREST. */
function joinedRow(
  participant: Partial<ParticipantRow>,
  conversation = conversationRow(),
): Record<string, unknown> {
  return {
    ...participantRow({ conversation_id: conversation.id, ...participant }),
    conversation,
  };
}

const conversationsKey = () => chatKeys.conversations(CHAT_IDS.me);

beforeEach(() => {
  h.auth.uid = CHAT_IDS.me;
  h.auth.tenantId = CHAT_IDS.tenant;
  h.rpc.mockReset();
  h.unsubscribe.mockReset();
  h.invalidateMuteCache.mockReset();
  h.openExpertRequestDialog.mockReset();
  h.subscriptions.length = 0;
  db().reset();
});

describe("useConversations - grupowanie i tożsamość wątku", () => {
  it("grupuje wiersze uczestników po rozmowie i rozdziela mnie od rozmówców", async () => {
    const conversation = conversationRow();
    db().setResponse("conversation_participants", {
      data: [
        joinedRow({ user_id: CHAT_IDS.me, unread_count: 3 }, conversation),
        joinedRow({ user_id: CHAT_IDS.peer }, conversation),
      ],
      error: null,
    });
    const client = makeClient();
    const { result } = renderHook(() => useConversations(), { wrapper: wrapperFor(client) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0]?.me.unread_count).toBe(3);
    expect(result.current.data?.[0]?.peers.map((p) => p.user_id)).toEqual([CHAT_IDS.peer]);
    const chain = db().lastChain("conversation_participants");
    expect(chain?.argsOf("select")).toEqual(["*, conversation:conversations(*)"]);
    expect(chain?.argsOf("order")).toEqual(["updated_at", { ascending: false }]);
    expect(chain?.argsOf("limit")).toEqual([600]);
  });

  it("odtwarza rozmówcę z `direct_key`, gdy RLS ukrył jego wiersz uczestnika", async () => {
    // Rozmówca wyłączył potwierdzenia odczytu, więc polityka wzajemna schowała
    // jego wiersz. Tożsamość MUSI przeżyć - inaczej wątek traci nazwę i avatar.
    const conversation = conversationRow();
    db().setResponse("conversation_participants", {
      data: [joinedRow({ user_id: CHAT_IDS.me }, conversation)],
      error: null,
    });
    const client = makeClient();
    const { result } = renderHook(() => useConversations(), { wrapper: wrapperFor(client) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const peers = result.current.data?.[0]?.peers ?? [];
    expect(peers.map((p) => p.user_id)).toEqual([CHAT_IDS.peer]);
    // Placeholder ma NULL-owy stan odczytu - dymek zatrzymuje się na
    // „doręczone", nigdy nie kłamie „wyświetlone".
    expect(peers[0]?.last_read_at).toBeNull();
    expect(peers[0]?.last_delivered_at).toBeNull();
    expect(peers[0]?.unread_count).toBe(0);
    expect(peers[0]?.tenant_id).toBe(CHAT_IDS.tenant);
  });

  it("nie duplikuje rozmówcy, którego wiersz JEST widoczny", async () => {
    const conversation = conversationRow();
    db().setResponse("conversation_participants", {
      data: [
        joinedRow({ user_id: CHAT_IDS.me }, conversation),
        joinedRow({ user_id: CHAT_IDS.peer, last_read_at: BASE_ISO }, conversation),
      ],
      error: null,
    });
    const client = makeClient();
    const { result } = renderHook(() => useConversations(), { wrapper: wrapperFor(client) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0]?.peers).toHaveLength(1);
    expect(result.current.data?.[0]?.peers[0]?.last_read_at).toBe(BASE_ISO);
  });

  it("krąg bez `direct_key` nie dostaje syntetycznych rozmówców", async () => {
    const group = groupConversationRow();
    db().setResponse("conversation_participants", {
      data: [
        joinedRow({ user_id: CHAT_IDS.me }, group),
        joinedRow({ user_id: CHAT_IDS.peer }, group),
      ],
      error: null,
    });
    const client = makeClient();
    const { result } = renderHook(() => useConversations(), { wrapper: wrapperFor(client) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0]?.peers.map((p) => p.user_id)).toEqual([CHAT_IDS.peer]);
  });

  it("pomija rozmowę bez WŁASNEGO wiersza uczestnika i wiersz bez rozmowy", async () => {
    const foreign = conversationRow({ id: "conv-foreign" });
    db().setResponse("conversation_participants", {
      data: [
        // Rozmowa, w której nie ma mnie - nie ma czego pokazać w liście.
        joinedRow({ user_id: CHAT_IDS.peer }, foreign),
        // Wiersz z NULL-ową rozmową (embed niewidoczny przez RLS).
        { ...participantRow({ user_id: CHAT_IDS.me }), conversation: null },
      ],
      error: null,
    });
    const client = makeClient();
    const { result } = renderHook(() => useConversations(), { wrapper: wrapperFor(client) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it("porządkuje: przypięte najpierw (najnowsza przypinka), potem po aktywności", async () => {
    const older = conversationRow({ id: "conv-older", last_message_at: isoOffset(-30) });
    const newer = conversationRow({ id: "conv-newer", last_message_at: isoOffset(-1) });
    const pinnedOld = conversationRow({ id: "conv-pin-old", last_message_at: isoOffset(-90) });
    const pinnedNew = conversationRow({ id: "conv-pin-new", last_message_at: isoOffset(-120) });
    db().setResponse("conversation_participants", {
      data: [
        joinedRow({ user_id: CHAT_IDS.me }, older),
        joinedRow({ user_id: CHAT_IDS.me }, newer),
        joinedRow({ user_id: CHAT_IDS.me, pinned_at: isoOffset(-10) }, pinnedOld),
        joinedRow({ user_id: CHAT_IDS.me, pinned_at: isoOffset(-2) }, pinnedNew),
      ],
      error: null,
    });
    const client = makeClient();
    const { result } = renderHook(() => useConversations(), { wrapper: wrapperFor(client) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.map((v) => v.conversation.id)).toEqual([
      "conv-pin-new",
      "conv-pin-old",
      "conv-newer",
      "conv-older",
    ]);
  });

  it("bez `last_message_at` porządkuje po dacie utworzenia", async () => {
    const fresh = conversationRow({
      id: "conv-fresh",
      last_message_at: null,
      created_at: isoOffset(-1),
    });
    const stale = conversationRow({
      id: "conv-stale",
      last_message_at: null,
      created_at: isoOffset(-60),
    });
    db().setResponse("conversation_participants", {
      data: [
        joinedRow({ user_id: CHAT_IDS.me }, stale),
        joinedRow({ user_id: CHAT_IDS.me }, fresh),
      ],
      error: null,
    });
    const client = makeClient();
    const { result } = renderHook(() => useConversations(), { wrapper: wrapperFor(client) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.map((v) => v.conversation.id)).toEqual([
      "conv-fresh",
      "conv-stale",
    ]);
  });

  it("nie odpytuje bazy bez sesji", async () => {
    h.auth.uid = null;
    db().setResponse("conversation_participants", { data: [], error: null });
    renderHook(() => useConversations(), { wrapper: wrapperFor(makeClient()) });
    await Promise.resolve();
    expect(db().chainsFor("conversation_participants")).toHaveLength(0);
  });
});

describe("useChatUnreadTotal", () => {
  it("sumuje nieprzeczytane Z TEGO SAMEGO zapytania - bez drugiego round-tripu", async () => {
    const first = conversationRow({ id: "c1" });
    const second = conversationRow({ id: "c2" });
    db().setResponse("conversation_participants", {
      data: [
        joinedRow({ user_id: CHAT_IDS.me, unread_count: 2 }, first),
        joinedRow({ user_id: CHAT_IDS.me, unread_count: 5 }, second),
      ],
      error: null,
    });
    const client = makeClient();
    const list = renderHook(() => useConversations(), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(list.result.current.isSuccess).toBe(true));
    const callsAfterList = db().chainsFor("conversation_participants").length;

    const { result } = renderHook(() => useChatUnreadTotal(), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current).toBe(7));
    // Licznik jest `select`-em nad tym samym kluczem: żadnego dodatkowego
    // zapytania, żadnego osobnego cyklu unieważnień.
    expect(db().chainsFor("conversation_participants")).toHaveLength(callsAfterList);
  });

  it("zwraca zero przed wczytaniem listy (bez migania NaN)", () => {
    db().setResponse("conversation_participants", { data: [], error: null });
    const { result } = renderHook(() => useChatUnreadTotal(), {
      wrapper: wrapperFor(makeClient()),
    });
    expect(result.current).toBe(0);
  });
});

describe("splitArchived", () => {
  it("rozdziela aktywne od zarchiwizowanych z zachowaniem kolejności", () => {
    const active = conversationView({ conversation: { id: "a" } });
    const archived = conversationView({
      conversation: { id: "b" },
      me: { archived_at: BASE_ISO },
    });
    expect(splitArchived([active, archived, active])).toEqual({
      active: [active, active],
      archived: [archived],
    });
  });

  it("radzi sobie z pustą listą", () => {
    expect(splitArchived([])).toEqual({ active: [], archived: [] });
  });
});

describe("mutedUntilMs / isMuted", () => {
  it("rozpoznaje literał `infinity` z PostgREST jako wyciszenie na zawsze", () => {
    expect(mutedUntilMs("infinity")).toBe(Number.POSITIVE_INFINITY);
    expect(isMuted(conversationView({ me: { muted_until: "infinity" } }))).toBe(true);
  });

  it("null i nieparsowalny znacznik znaczą brak wyciszenia", () => {
    expect(mutedUntilMs(null)).toBeNull();
    expect(mutedUntilMs("nie-data")).toBeNull();
    expect(isMuted(conversationView({ me: { muted_until: null } }))).toBe(false);
    expect(isMuted(conversationView({ me: { muted_until: "nie-data" } }))).toBe(false);
  });

  it("okno wyciszenia wygasa dokładnie na swoim znaczniku", () => {
    const until = isoOffset(10);
    const view = conversationView({ me: { muted_until: until } });
    const untilMs = new Date(until).getTime();
    expect(isMuted(view, untilMs - 1)).toBe(true);
    expect(isMuted(view, untilMs)).toBe(false);
    expect(isMuted(view, untilMs + 1)).toBe(false);
  });
});

describe("applyReopenToViews / applyArchiveFlipToViews", () => {
  const archived: ConversationView = conversationView({
    me: { archived_at: BASE_ISO },
    conversation: { last_message_at: null },
  });

  it("reopen zdejmuje archiwum i stempluje aktywność, gdy jej brak", () => {
    const next = applyReopenToViews([archived], CHAT_IDS.conversation, isoOffset(5));
    expect(next?.[0]?.me.archived_at).toBeNull();
    expect(next?.[0]?.conversation.last_message_at).toBe(isoOffset(5));
  });

  it("reopen NIE nadpisuje istniejącej daty ostatniej wiadomości", () => {
    const withActivity = conversationView({
      me: { archived_at: BASE_ISO },
      conversation: { last_message_at: isoOffset(-3) },
    });
    const next = applyReopenToViews([withActivity], CHAT_IDS.conversation, isoOffset(5));
    expect(next?.[0]?.conversation.last_message_at).toBe(isoOffset(-3));
  });

  it("reopen nie rusza wątku, który NIE jest zarchiwizowany, ani innych wątków", () => {
    const active = conversationView();
    expect(applyReopenToViews([active], CHAT_IDS.conversation)?.[0]).toBe(active);
    expect(applyReopenToViews([archived], CHAT_IDS.otherConversation)?.[0]).toBe(archived);
    expect(applyReopenToViews(undefined, CHAT_IDS.conversation)).toBeUndefined();
  });

  it("flip archiwum ustawia i zdejmuje znacznik", () => {
    const active = conversationView();
    expect(
      applyArchiveFlipToViews([active], CHAT_IDS.conversation, true, BASE_ISO)?.[0]?.me.archived_at,
    ).toBe(BASE_ISO);
    expect(
      applyArchiveFlipToViews([archived], CHAT_IDS.conversation, false)?.[0]?.me.archived_at,
    ).toBeNull();
    expect(applyArchiveFlipToViews(undefined, CHAT_IDS.conversation, true)).toBeUndefined();
  });
});

describe("usePeerProfiles", () => {
  it("woła `get_chat_peers` z posortowanymi, odduplikowanymi id", async () => {
    h.rpc.mockImplementation(() => ok([peerProfile()]));
    const client = makeClient();
    const { result } = renderHook(
      () => usePeerProfiles([CHAT_IDS.peerTwo, CHAT_IDS.peer, CHAT_IDS.peer]),
      { wrapper: wrapperFor(client) },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(h.rpc).toHaveBeenCalledWith("get_chat_peers", {
      p_user_ids: [CHAT_IDS.peer, CHAT_IDS.peerTwo],
    });
    expect(result.current.data?.get(CHAT_IDS.peer)?.display_name).toBe("Anna Nowak");
  });

  it("zasiewa klucze jednoosobowe, żeby okno czatu otwierało się ciepłe", async () => {
    h.rpc.mockImplementation(() =>
      ok([peerProfile(), peerProfile({ id: CHAT_IDS.peerTwo, display_name: "Marek" })]),
    );
    const client = makeClient();
    const { result } = renderHook(() => usePeerProfiles([CHAT_IDS.peer, CHAT_IDS.peerTwo]), {
      wrapper: wrapperFor(client),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const seeded = client.getQueryData<ReadonlyMap<string, { display_name: string }>>(
      chatKeys.peers(CHAT_IDS.me, [CHAT_IDS.peerTwo]),
    );
    expect(seeded?.get(CHAT_IDS.peerTwo)?.display_name).toBe("Marek");
  });

  it("NIE zasiewa nic dla zapytania o jedno id (klucz jest już ten sam)", async () => {
    h.rpc.mockImplementation(() => ok([peerProfile()]));
    const client = makeClient();
    const { result } = renderHook(() => usePeerProfiles([CHAT_IDS.peer]), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.size).toBe(1);
  });

  it("nie strzela do RPC dla pustej listy id", async () => {
    const client = makeClient();
    renderHook(() => usePeerProfiles([]), { wrapper: wrapperFor(client) });
    await Promise.resolve();
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("propaguje błąd RPC", async () => {
    h.rpc.mockImplementation(() => rpcFail("peers denied"));
    const client = makeClient();
    const { result } = renderHook(() => usePeerProfiles([CHAT_IDS.peer]), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe("usePeopleSearch", () => {
  it("woła `search_chat_contacts` (sieć kontaktów), nie katalog osób", async () => {
    h.rpc.mockImplementation(() => ok([chatContactHit()]));
    const client = makeClient();
    const { result } = renderHook(() => usePeopleSearch("  Anna  ", 10), {
      wrapper: wrapperFor(client),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // Fraza jest przycinana, a przeciążenie jednoznaczne: wcześniejsze
    // `search_people({p_query,p_limit})` było niejednoznaczne (42725), więc
    // wyszukiwarka była MARTWA.
    expect(h.rpc).toHaveBeenCalledWith("search_chat_contacts", { p_query: "Anna", p_limit: 10 });
    expect(result.current.data?.[0]?.id).toBe(CHAT_IDS.peer);
  });

  it("pusta fraza przegląda listę, nie wyłącza zapytania", async () => {
    h.rpc.mockImplementation(() => ok([]));
    const client = makeClient();
    const { result } = renderHook(() => usePeopleSearch(""), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(h.rpc).toHaveBeenCalledWith("search_chat_contacts", { p_query: "", p_limit: 20 });
  });

  it("normalizuje brak danych do pustej listy", async () => {
    h.rpc.mockImplementation(() => ok(null));
    const client = makeClient();
    const { result } = renderHook(() => usePeopleSearch("x"), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });
});

describe("useStartConversation", () => {
  it("woła RPC i optymistycznie wyciąga wątek z archiwum", async () => {
    h.rpc.mockImplementation(() => ok(CHAT_IDS.conversation));
    const client = makeClient();
    client.setQueryData<ConversationView[]>(conversationsKey(), [
      conversationView({ me: { archived_at: BASE_ISO } }),
    ]);
    const { result } = renderHook(() => useStartConversation(), { wrapper: wrapperFor(client) });

    await act(async () => {
      await result.current.mutateAsync(CHAT_IDS.peer);
    });

    expect(h.rpc).toHaveBeenCalledWith("get_or_create_direct_conversation", {
      p_peer_id: CHAT_IDS.peer,
    });
    expect(
      client.getQueryData<ConversationView[]>(conversationsKey())?.[0]?.me.archived_at,
    ).toBeNull();
  });

  it("przyjmuje też obiekt z nazwą rozmówcy (prefill dialogu eksperta)", async () => {
    h.rpc.mockImplementation(() => ok(CHAT_IDS.conversation));
    const client = makeClient();
    const { result } = renderHook(() => useStartConversation(), { wrapper: wrapperFor(client) });

    await act(async () => {
      await result.current.mutateAsync({ peerId: CHAT_IDS.peer, peerName: "Anna" });
    });
    expect(h.rpc).toHaveBeenCalledWith("get_or_create_direct_conversation", {
      p_peer_id: CHAT_IDS.peer,
    });
  });

  it("bramka eksperta otwiera DIALOG ZAPYTANIA, nie nagi błąd", async () => {
    h.rpc.mockImplementation(() => rpcFail("chat: expert requires request"));
    const client = makeClient();
    const { result } = renderHook(() => useStartConversation(), { wrapper: wrapperFor(client) });

    await act(async () => {
      result.current.mutate({
        peerId: CHAT_IDS.peer,
        peerName: "Anna Ekspertka",
        peerAvatar: "anna.png",
      });
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(h.openExpertRequestDialog).toHaveBeenCalledWith({
      recipientId: CHAT_IDS.peer,
      recipientName: "Anna Ekspertka",
      recipientAvatar: "anna.png",
    });
  });

  it("bramka eksperta z samym id nie wymyśla nazwy rozmówcy", async () => {
    h.rpc.mockImplementation(() => rpcFail("chat: expert requires request"));
    const client = makeClient();
    const { result } = renderHook(() => useStartConversation(), { wrapper: wrapperFor(client) });

    await act(async () => {
      result.current.mutate(CHAT_IDS.peer);
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(h.openExpertRequestDialog).toHaveBeenCalledWith({
      recipientId: CHAT_IDS.peer,
      recipientName: null,
      recipientAvatar: null,
    });
  });

  it("inne błędy NIE otwierają dialogu eksperta", async () => {
    h.rpc.mockImplementation(() => rpcFail("chat: blocked"));
    const client = makeClient();
    const { result } = renderHook(() => useStartConversation(), { wrapper: wrapperFor(client) });

    await act(async () => {
      result.current.mutate(CHAT_IDS.peer);
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(h.openExpertRequestDialog).not.toHaveBeenCalled();
  });
});

describe("useMarkConversationRead", () => {
  it("woła RPC z id rozmowy", async () => {
    h.rpc.mockImplementation(() => ok(null));
    const client = makeClient();
    const { result } = renderHook(() => useMarkConversationRead(), { wrapper: wrapperFor(client) });

    await act(async () => {
      await result.current.mutateAsync(CHAT_IDS.conversation);
    });
    expect(h.rpc).toHaveBeenCalledWith("mark_conversation_read", {
      p_conversation_id: CHAT_IDS.conversation,
    });
  });

  it("propaguje odmowę serwera", async () => {
    h.rpc.mockImplementation(() => rpcFail("not a member"));
    const client = makeClient();
    const { result } = renderHook(() => useMarkConversationRead(), { wrapper: wrapperFor(client) });
    await act(async () => {
      result.current.mutate(CHAT_IDS.conversation);
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe("ustawienia rozmowy - kontrakt RPC", () => {
  it("przypięcie przekazuje flagę bez tłumaczenia jej na sekundy", async () => {
    h.rpc.mockImplementation(() => ok(null));
    const client = makeClient();
    const { result } = renderHook(() => useSetConversationPinned(), {
      wrapper: wrapperFor(client),
    });

    await act(async () => {
      await result.current.mutateAsync({ conversationId: CHAT_IDS.conversation, pinned: true });
    });
    expect(h.rpc).toHaveBeenCalledWith("chat_set_pinned", {
      p_conversation_id: CHAT_IDS.conversation,
      p_pinned: true,
    });
  });

  it("wyciszenie unieważnia cache toastów NATYCHMIAST, nie po 60 s TTL", async () => {
    h.rpc.mockImplementation(() => ok(null));
    const client = makeClient();
    const { result } = renderHook(() => useSetConversationMuted(), { wrapper: wrapperFor(client) });

    await act(async () => {
      await result.current.mutateAsync({ conversationId: CHAT_IDS.conversation, seconds: -1 });
    });
    expect(h.rpc).toHaveBeenCalledWith("chat_set_muted", {
      p_conversation_id: CHAT_IDS.conversation,
      p_seconds: -1,
    });
    expect(h.invalidateMuteCache).toHaveBeenCalledWith(CHAT_IDS.conversation);
  });

  it("nieudane wyciszenie NIE czyści cache toastów", async () => {
    h.rpc.mockImplementation(() => rpcFail("denied"));
    const client = makeClient();
    const { result } = renderHook(() => useSetConversationMuted(), { wrapper: wrapperFor(client) });

    await act(async () => {
      result.current.mutate({ conversationId: CHAT_IDS.conversation, seconds: 3600 });
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(h.invalidateMuteCache).not.toHaveBeenCalled();
  });

  it("czyszczenie historii unieważnia TAKŻE cache wiadomości tej rozmowy", async () => {
    h.rpc.mockImplementation(() => ok(null));
    const client = makeClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useClearConversationHistory(), {
      wrapper: wrapperFor(client),
    });

    await act(async () => {
      await result.current.mutateAsync({ conversationId: CHAT_IDS.conversation });
    });

    expect(h.rpc).toHaveBeenCalledWith("chat_clear_history", {
      p_conversation_id: CHAT_IDS.conversation,
    });
    const keys = invalidate.mock.calls.map((call) => JSON.stringify(call[0]?.queryKey));
    expect(keys).toContain(JSON.stringify(conversationsKey()));
    expect(keys).toContain(JSON.stringify(chatKeys.messages(CHAT_IDS.me, CHAT_IDS.conversation)));
  });

  it("znikanie wiadomości przekazuje okno TTL i odświeża wątek", async () => {
    h.rpc.mockImplementation(() => ok(null));
    const client = makeClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useSetMessageTtl(), { wrapper: wrapperFor(client) });

    await act(async () => {
      await result.current.mutateAsync({
        conversationId: CHAT_IDS.conversation,
        ttlSeconds: 86400,
      });
    });

    expect(h.rpc).toHaveBeenCalledWith("chat_set_message_ttl", {
      p_conversation_id: CHAT_IDS.conversation,
      p_ttl_seconds: 86400,
    });
    expect(invalidate.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey))).toContain(
      JSON.stringify(chatKeys.messages(CHAT_IDS.me, CHAT_IDS.conversation)),
    );
  });

  it("opis kręgu idzie osobnym RPC (semantyka tytułu)", async () => {
    h.rpc.mockImplementation(() => ok(null));
    const client = makeClient();
    const { result } = renderHook(() => useSetGroupDescription(), { wrapper: wrapperFor(client) });

    await act(async () => {
      await result.current.mutateAsync({
        conversationId: CHAT_IDS.group,
        description: "Grupa robocza",
      });
    });
    expect(h.rpc).toHaveBeenCalledWith("chat_set_group_description", {
      p_conversation_id: CHAT_IDS.group,
      p_description: "Grupa robocza",
    });
  });
});

describe("useSetConversationArchived - optymistyczny flip", () => {
  it("przenosi wątek między listami PRZED odpowiedzią serwera", async () => {
    let resolveRpc: ((value: SupabaseResult) => void) | null = null;
    h.rpc.mockImplementation(
      () =>
        new Promise<SupabaseResult>((resolve) => {
          resolveRpc = resolve;
        }),
    );
    const client = makeClient();
    client.setQueryData<ConversationView[]>(conversationsKey(), [conversationView()]);
    const { result } = renderHook(() => useSetConversationArchived(), {
      wrapper: wrapperFor(client),
    });

    await act(async () => {
      result.current.mutate({ conversationId: CHAT_IDS.conversation, archived: true });
    });
    await waitFor(() =>
      expect(
        client.getQueryData<ConversationView[]>(conversationsKey())?.[0]?.me.archived_at,
      ).not.toBeNull(),
    );

    await act(async () => {
      resolveRpc?.({ data: null, error: null });
    });
  });

  it("po błędzie przywraca poprzednią migawkę listy", async () => {
    h.rpc.mockImplementation(() => rpcFail("denied"));
    const client = makeClient();
    const before = [conversationView()];
    client.setQueryData<ConversationView[]>(conversationsKey(), before);
    const { result } = renderHook(() => useSetConversationArchived(), {
      wrapper: wrapperFor(client),
    });

    await act(async () => {
      result.current.mutate({ conversationId: CHAT_IDS.conversation, archived: true });
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(
      client.getQueryData<ConversationView[]>(conversationsKey())?.[0]?.me.archived_at,
    ).toBeNull();
  });

  it("bez sesji nie dotyka cache'u ani nie wywraca się", async () => {
    h.auth.uid = null;
    h.rpc.mockImplementation(() => ok(null));
    const client = makeClient();
    const { result } = renderHook(() => useSetConversationArchived(), {
      wrapper: wrapperFor(client),
    });
    await act(async () => {
      await result.current.mutateAsync({ conversationId: CHAT_IDS.conversation, archived: true });
    });
    expect(client.getQueryData(chatKeys.conversations(undefined))).toBeUndefined();
  });
});

describe("useSetConversationAppearance", () => {
  it("pomijane pola jadą sentinelem `keep`, jawny null resetuje", async () => {
    h.rpc.mockImplementation(() => ok(null));
    const client = makeClient();
    const { result } = renderHook(() => useSetConversationAppearance(), {
      wrapper: wrapperFor(client),
    });

    await act(async () => {
      await result.current.mutateAsync({
        conversationId: CHAT_IDS.conversation,
        theme: "ocean",
        wallpaper: null,
      });
    });

    expect(h.rpc).toHaveBeenCalledWith("chat_set_appearance", {
      p_conversation_id: CHAT_IDS.conversation,
      p_theme: "ocean",
      p_wallpaper: null,
      p_quick_emoji: "keep",
    });
  });

  it("optymistycznie zmienia TYLKO podane pola wskazanej rozmowy", async () => {
    h.rpc.mockImplementation(() => ok(null));
    const client = makeClient();
    client.setQueryData<ConversationView[]>(conversationsKey(), [
      conversationView({ conversation: { theme: "old", wallpaper: "paper", quick_emoji: "👍" } }),
      conversationView({ conversation: { id: CHAT_IDS.otherConversation, theme: "other" } }),
    ]);
    const { result } = renderHook(() => useSetConversationAppearance(), {
      wrapper: wrapperFor(client),
    });

    await act(async () => {
      await result.current.mutateAsync({ conversationId: CHAT_IDS.conversation, theme: "ocean" });
    });

    const views = client.getQueryData<ConversationView[]>(conversationsKey()) ?? [];
    expect(views[0]?.conversation.theme).toBe("ocean");
    expect(views[0]?.conversation.wallpaper).toBe("paper");
    expect(views[0]?.conversation.quick_emoji).toBe("👍");
    expect(views[1]?.conversation.theme).toBe("other");
  });

  it("po błędzie przywraca poprzedni wygląd", async () => {
    h.rpc.mockImplementation(() => rpcFail("denied"));
    const client = makeClient();
    client.setQueryData<ConversationView[]>(conversationsKey(), [
      conversationView({ conversation: { theme: "old" } }),
    ]);
    const { result } = renderHook(() => useSetConversationAppearance(), {
      wrapper: wrapperFor(client),
    });

    await act(async () => {
      result.current.mutate({ conversationId: CHAT_IDS.conversation, theme: "ocean" });
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(
      client.getQueryData<ConversationView[]>(conversationsKey())?.[0]?.conversation.theme,
    ).toBe("old");
  });
});

describe("useChatListRealtime", () => {
  it("subskrybuje WŁASNE wiersze uczestnika i potwierdza doręczenia", async () => {
    vi.useFakeTimers();
    h.rpc.mockImplementation(() => ok(null));
    const client = makeClient();
    renderHook(() => useChatListRealtime(), { wrapper: wrapperFor(client) });

    expect(h.subscriptions).toHaveLength(1);
    expect(h.subscriptions[0]).toMatchObject({
      table: "conversation_participants",
      filter: `user_id=eq.${CHAT_IDS.me}`,
    });

    // Ack doręczeń jest debounce'owany modułowo - jedno RPC na serię zdarzeń.
    await act(async () => {
      vi.advanceTimersByTime(900);
    });
    expect(h.rpc).toHaveBeenCalledWith("mark_conversations_delivered", undefined);
    vi.useRealTimers();
  });

  it("zdarzenie realtime unieważnia listę rozmów", async () => {
    vi.useFakeTimers();
    h.rpc.mockImplementation(() => ok(null));
    const client = makeClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    renderHook(() => useChatListRealtime(), { wrapper: wrapperFor(client) });
    invalidate.mockClear();

    act(() => h.subscriptions[0]?.handler({ new: {} }));

    expect(invalidate.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey))).toContain(
      JSON.stringify(conversationsKey()),
    );
    await act(async () => {
      vi.advanceTimersByTime(900);
    });
    vi.useRealTimers();
  });

  it("zwalnia subskrypcję przy odmontowaniu", () => {
    const client = makeClient();
    const { unmount } = renderHook(() => useChatListRealtime(), { wrapper: wrapperFor(client) });
    unmount();
    expect(h.unsubscribe).toHaveBeenCalled();
  });

  it("bez sesji nie subskrybuje niczego", () => {
    h.auth.uid = null;
    const client = makeClient();
    renderHook(() => useChatListRealtime(), { wrapper: wrapperFor(client) });
    expect(h.subscriptions).toHaveLength(0);
  });
});
