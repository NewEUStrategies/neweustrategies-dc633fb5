// Cienkie warstwy danych czatu, które stały na ZERZE pokrycia, a każda
// odpowiada za osobną gwarancję produktową:
//
//   stars.ts            - gwiazdka jest PRYWATNA (nadawca nigdy się nie
//                         dowie), a `conversation_id`/`tenant_id` stempluje
//                         trigger, nie klient,
//   useBlocks.ts        - blokada wymaga stempla tenanta (RLS), a cache flipuje
//                         natychmiast, żeby kompozytor zniknął bez round-tripu,
//   useGroups.ts        - wszystkie mutacje kręgu to SECURITY DEFINER RPC;
//                         klient przekazuje intencję i odświeża listę,
//   useMessageSearch.ts - próg znaków, przycinanie frazy i kontrakt argumentów
//                         `search_messages` (skrzynka vs jedna rozmowa).
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  BASE_ISO,
  CHAT_IDS,
  fail,
  messageRow,
  messageSearchHit,
  ok,
  supabaseFromStub,
  type SupabaseResult,
} from "@/test/chat/fixtures";

const h = vi.hoisted(() => ({
  auth: { uid: "user-me" as string | null, tenantId: "tenant-alfa" as string | null },
  rpc: vi.fn(),
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

import { useStarredIds, useStarredMessages, useToggleStar } from "../stars";
import { useBlockUser, useMyBlocks, useUnblockUser } from "../useBlocks";
import { useAddGroupMembers, useCreateGroup, useLeaveGroup, useRenameGroup } from "../useGroups";
import { MESSAGE_SEARCH_MIN_CHARS, useMessageSearch } from "../useMessageSearch";
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

function rpcOk(data: unknown): Promise<SupabaseResult> {
  return Promise.resolve({ data, error: null });
}

function rpcFail(message: string): Promise<SupabaseResult> {
  const error = new Error(message);
  error.name = "PostgrestError";
  return Promise.resolve({ data: null, error });
}

beforeEach(() => {
  h.auth.uid = CHAT_IDS.me;
  h.auth.tenantId = CHAT_IDS.tenant;
  h.rpc.mockReset();
  db().reset();
});

describe("useStarredIds", () => {
  it("zwraca zbiór id gwiazdkowanych wiadomości rozmowy", async () => {
    db().setResponse("message_stars", ok([{ message_id: "m1" }, { message_id: "m2" }]));
    const client = makeClient();
    const { result } = renderHook(() => useStarredIds(CHAT_IDS.conversation, true), {
      wrapper: wrapperFor(client),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect([...(result.current.data ?? [])]).toEqual(["m1", "m2"]);
    const chain = db().lastChain("message_stars");
    expect(chain?.argsOf("select")).toEqual(["message_id"]);
    expect(chain?.argsOf("eq")).toEqual(["conversation_id", CHAT_IDS.conversation]);
    expect(chain?.argsOf("limit")).toEqual([1000]);
  });

  it("nie odpytuje bazy przy `enabled` false", async () => {
    db().setResponse("message_stars", ok([]));
    renderHook(() => useStarredIds(CHAT_IDS.conversation, false), {
      wrapper: wrapperFor(makeClient()),
    });
    await Promise.resolve();
    expect(db().chainsFor("message_stars")).toHaveLength(0);
  });
});

describe("useStarredMessages", () => {
  it("odsiewa wpisy bez wiadomości i tombstone'y (RLS zabrał treść)", async () => {
    db().setResponse(
      "message_stars",
      ok([
        { message_id: "m1", created_at: BASE_ISO, message: messageRow({ id: "m1" }) },
        // Wiadomość wygasła/wyczyszczona - RLS zwraca NULL w embedzie.
        { message_id: "m2", created_at: BASE_ISO, message: null },
        {
          message_id: "m3",
          created_at: BASE_ISO,
          message: messageRow({ id: "m3", deleted_at: BASE_ISO }),
        },
      ]),
    );
    const client = makeClient();
    const { result } = renderHook(() => useStarredMessages(CHAT_IDS.conversation, true), {
      wrapper: wrapperFor(client),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.map((entry) => entry.message_id)).toEqual(["m1"]);
    expect(db().lastChain("message_stars")?.argsOf("limit")).toEqual([200]);
  });
});

describe("useToggleStar", () => {
  const starsKey = () => chatKeys.stars(CHAT_IDS.me, CHAT_IDS.conversation);

  it("dodanie gwiazdki NIE wysyła conversation_id ani tenant_id - stempluje trigger", async () => {
    db().setResponse("message_stars", ok(null));
    const client = makeClient();
    const { result } = renderHook(() => useToggleStar(CHAT_IDS.conversation), {
      wrapper: wrapperFor(client),
    });

    await act(async () => {
      await result.current.mutateAsync({ messageId: "m1", starred: false });
    });

    // Klient podaje tylko to, co JEST jego: kto i którą wiadomość. Resztę
    // wypełnia BEFORE INSERT z referencowanej wiadomości.
    expect(db().lastChain("message_stars")?.argsOf("insert")?.[0]).toEqual({
      user_id: CHAT_IDS.me,
      message_id: "m1",
    });
  });

  it("zdjęcie gwiazdki filtruje po WŁASNYM user_id (nie ruszy cudzej)", async () => {
    db().setResponse("message_stars", ok(null));
    const client = makeClient();
    const { result } = renderHook(() => useToggleStar(CHAT_IDS.conversation), {
      wrapper: wrapperFor(client),
    });

    await act(async () => {
      await result.current.mutateAsync({ messageId: "m1", starred: true });
    });

    const chain = db().lastChain("message_stars");
    expect(chain?.has("delete")).toBe(true);
    expect(chain?.calls.filter((c) => c.method === "eq").map((c) => c.args)).toEqual([
      ["user_id", CHAT_IDS.me],
      ["message_id", "m1"],
    ]);
  });

  it("optymistycznie flipuje zbiór w obie strony", async () => {
    db().setResponse("message_stars", ok(null));
    const client = makeClient();
    client.setQueryData<ReadonlySet<string>>(starsKey(), new Set(["m0"]));
    const { result } = renderHook(() => useToggleStar(CHAT_IDS.conversation), {
      wrapper: wrapperFor(client),
    });

    await act(async () => {
      await result.current.mutateAsync({ messageId: "m1", starred: false });
    });
    expect([...(client.getQueryData<ReadonlySet<string>>(starsKey()) ?? [])]).toEqual(["m0", "m1"]);

    await act(async () => {
      await result.current.mutateAsync({ messageId: "m0", starred: true });
    });
    expect([...(client.getQueryData<ReadonlySet<string>>(starsKey()) ?? [])]).toEqual(["m1"]);
  });

  it("po błędzie przywraca poprzedni zbiór", async () => {
    db().setResponse("message_stars", fail("denied"));
    const client = makeClient();
    client.setQueryData<ReadonlySet<string>>(starsKey(), new Set(["m0"]));
    const { result } = renderHook(() => useToggleStar(CHAT_IDS.conversation), {
      wrapper: wrapperFor(client),
    });

    await act(async () => {
      result.current.mutate({ messageId: "m1", starred: false });
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect([...(client.getQueryData<ReadonlySet<string>>(starsKey()) ?? [])]).toEqual(["m0"]);
  });

  it("odmawia bez sesji", async () => {
    h.auth.uid = null;
    db().setResponse("message_stars", ok(null));
    const client = makeClient();
    const { result } = renderHook(() => useToggleStar(CHAT_IDS.conversation), {
      wrapper: wrapperFor(client),
    });

    await expect(
      act(async () => {
        await result.current.mutateAsync({ messageId: "m1", starred: false });
      }),
    ).rejects.toThrow("chat: auth required");
  });
});

describe("useMyBlocks", () => {
  it("zwraca zbiór zablokowanych id (RLS oddaje tylko własne wiersze)", async () => {
    db().setResponse("user_blocks", ok([{ blocked_id: CHAT_IDS.peer }]));
    const client = makeClient();
    const { result } = renderHook(() => useMyBlocks(), { wrapper: wrapperFor(client) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.has(CHAT_IDS.peer)).toBe(true);
    expect(db().lastChain("user_blocks")?.argsOf("select")).toEqual(["blocked_id"]);
  });

  it("nie odpytuje bazy bez sesji", async () => {
    h.auth.uid = null;
    db().setResponse("user_blocks", ok([]));
    renderHook(() => useMyBlocks(), { wrapper: wrapperFor(makeClient()) });
    await Promise.resolve();
    expect(db().chainsFor("user_blocks")).toHaveLength(0);
  });
});

describe("useBlockUser / useUnblockUser", () => {
  const blocksKey = () => ["chat", "blocks", CHAT_IDS.me];

  it("blokada stempluje tenant_id i oba końce relacji", async () => {
    db().setResponse("user_blocks", ok(null));
    const client = makeClient();
    const { result } = renderHook(() => useBlockUser(), { wrapper: wrapperFor(client) });

    await act(async () => {
      await result.current.mutateAsync(CHAT_IDS.peer);
    });

    expect(db().lastChain("user_blocks")?.argsOf("insert")?.[0]).toEqual({
      blocker_id: CHAT_IDS.me,
      blocked_id: CHAT_IDS.peer,
      tenant_id: CHAT_IDS.tenant,
    });
    expect(client.getQueryData<ReadonlySet<string>>(blocksKey())?.has(CHAT_IDS.peer)).toBe(true);
  });

  it("blokada odmawia bez rozstrzygniętego tenanta", async () => {
    h.auth.tenantId = null;
    db().setResponse("user_blocks", ok(null));
    const client = makeClient();
    const { result } = renderHook(() => useBlockUser(), { wrapper: wrapperFor(client) });

    await expect(
      act(async () => {
        await result.current.mutateAsync(CHAT_IDS.peer);
      }),
    ).rejects.toThrow("chat: tenant not resolved");
    expect(db().chainsFor("user_blocks")).toHaveLength(0);
  });

  it("odblokowanie filtruje po obu kolumnach i zdejmuje id z cache'u", async () => {
    db().setResponse("user_blocks", ok(null));
    const client = makeClient();
    client.setQueryData<ReadonlySet<string>>(blocksKey(), new Set([CHAT_IDS.peer]));
    const { result } = renderHook(() => useUnblockUser(), { wrapper: wrapperFor(client) });

    await act(async () => {
      await result.current.mutateAsync(CHAT_IDS.peer);
    });

    const chain = db().lastChain("user_blocks");
    expect(chain?.has("delete")).toBe(true);
    expect(chain?.calls.filter((c) => c.method === "eq").map((c) => c.args)).toEqual([
      ["blocker_id", CHAT_IDS.me],
      ["blocked_id", CHAT_IDS.peer],
    ]);
    expect(client.getQueryData<ReadonlySet<string>>(blocksKey())?.has(CHAT_IDS.peer)).toBe(false);
  });

  it("nieudana blokada NIE flipuje cache'u (kompozytor zostaje)", async () => {
    db().setResponse("user_blocks", fail("denied"));
    const client = makeClient();
    const { result } = renderHook(() => useBlockUser(), { wrapper: wrapperFor(client) });

    await act(async () => {
      result.current.mutate(CHAT_IDS.peer);
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(client.getQueryData(blocksKey())).toBeUndefined();
  });

  it("odblokowanie odmawia bez sesji", async () => {
    h.auth.uid = null;
    db().setResponse("user_blocks", ok(null));
    const client = makeClient();
    const { result } = renderHook(() => useUnblockUser(), { wrapper: wrapperFor(client) });

    await expect(
      act(async () => {
        await result.current.mutateAsync(CHAT_IDS.peer);
      }),
    ).rejects.toThrow("chat: auth required");
  });
});

describe("mutacje kręgu", () => {
  it("utworzenie kręgu zwraca id nowej rozmowy", async () => {
    h.rpc.mockImplementation(() => rpcOk(CHAT_IDS.group));
    const client = makeClient();
    const { result } = renderHook(() => useCreateGroup(), { wrapper: wrapperFor(client) });

    let created = "";
    await act(async () => {
      created = await result.current.mutateAsync({
        title: "Krąg energetyczny",
        memberIds: [CHAT_IDS.peer, CHAT_IDS.peerTwo],
      });
    });

    expect(h.rpc).toHaveBeenCalledWith("create_group_conversation", {
      p_title: "Krąg energetyczny",
      p_member_ids: [CHAT_IDS.peer, CHAT_IDS.peerTwo],
    });
    expect(created).toBe(CHAT_IDS.group);
  });

  it("dodanie członków zwraca liczbę faktycznie dodanych (serwer filtruje)", async () => {
    h.rpc.mockImplementation(() => rpcOk(1));
    const client = makeClient();
    const { result } = renderHook(() => useAddGroupMembers(), { wrapper: wrapperFor(client) });

    let added = -1;
    await act(async () => {
      added = await result.current.mutateAsync({
        conversationId: CHAT_IDS.group,
        memberIds: [CHAT_IDS.peer, CHAT_IDS.stranger],
      });
    });
    expect(added).toBe(1);
  });

  it("brak zwrotki z RPC dodawania czytamy jako zero, nie undefined", async () => {
    h.rpc.mockImplementation(() => rpcOk(null));
    const client = makeClient();
    const { result } = renderHook(() => useAddGroupMembers(), { wrapper: wrapperFor(client) });

    let added = -1;
    await act(async () => {
      added = await result.current.mutateAsync({
        conversationId: CHAT_IDS.group,
        memberIds: [CHAT_IDS.peer],
      });
    });
    expect(added).toBe(0);
  });

  it("wyjście z kręgu i zmiana nazwy przekazują intencję i odświeżają listę", async () => {
    h.rpc.mockImplementation(() => rpcOk(null));
    const client = makeClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");

    const leave = renderHook(() => useLeaveGroup(), { wrapper: wrapperFor(client) });
    await act(async () => {
      await leave.result.current.mutateAsync(CHAT_IDS.group);
    });
    expect(h.rpc).toHaveBeenCalledWith("leave_group_conversation", {
      p_conversation_id: CHAT_IDS.group,
    });

    const rename = renderHook(() => useRenameGroup(), { wrapper: wrapperFor(client) });
    await act(async () => {
      await rename.result.current.mutateAsync({
        conversationId: CHAT_IDS.group,
        title: "Nowa nazwa",
      });
    });
    expect(h.rpc).toHaveBeenCalledWith("rename_group_conversation", {
      p_conversation_id: CHAT_IDS.group,
      p_title: "Nowa nazwa",
    });

    expect(invalidate.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey))).toContain(
      JSON.stringify(chatKeys.conversations(CHAT_IDS.me)),
    );
  });

  it("odmowa serwera (limit 49 osób, nie-właściciel) propaguje się do callera", async () => {
    h.rpc.mockImplementation(() => rpcFail("chat: group full"));
    const client = makeClient();
    const { result } = renderHook(() => useAddGroupMembers(), { wrapper: wrapperFor(client) });

    await act(async () => {
      result.current.mutate({ conversationId: CHAT_IDS.group, memberIds: [CHAT_IDS.peer] });
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("chat: group full");
  });
});

describe("useMessageSearch", () => {
  it("nie strzela poniżej progu znaków", async () => {
    h.rpc.mockImplementation(() => rpcOk([]));
    const client = makeClient();
    renderHook(() => useMessageSearch("a", CHAT_IDS.conversation), { wrapper: wrapperFor(client) });
    await Promise.resolve();
    expect(h.rpc).not.toHaveBeenCalled();
    expect(MESSAGE_SEARCH_MIN_CHARS).toBe(2);
  });

  it("przycina frazę i pyta o JEDNĄ rozmowę (pasek w oknie czatu)", async () => {
    h.rpc.mockImplementation(() => rpcOk([messageSearchHit()]));
    const client = makeClient();
    const { result } = renderHook(() => useMessageSearch("  polityka  ", CHAT_IDS.conversation), {
      wrapper: wrapperFor(client),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(h.rpc).toHaveBeenCalledWith("search_messages", {
      _q: "polityka",
      _conversation_id: CHAT_IDS.conversation,
      _limit: 30,
    });
    // Snippet wraca w konwencji [[[ ]]] - renderowanie przez komponent, nigdy innerHTML.
    expect(result.current.data?.[0]?.snippet).toContain("[[[");
  });

  it("skrzynka (null) NIE wysyła filtra rozmowy - inaczej RPC szukałby w jednej", async () => {
    h.rpc.mockImplementation(() => rpcOk([]));
    const client = makeClient();
    const { result } = renderHook(() => useMessageSearch("polityka", null), {
      wrapper: wrapperFor(client),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(h.rpc).toHaveBeenCalledWith("search_messages", {
      _q: "polityka",
      _conversation_id: undefined,
      _limit: 30,
    });
  });

  it("wyłączenie z zewnątrz (zamknięty pasek) wstrzymuje zapytanie", async () => {
    h.rpc.mockImplementation(() => rpcOk([]));
    const client = makeClient();
    renderHook(() => useMessageSearch("polityka", CHAT_IDS.conversation, false), {
      wrapper: wrapperFor(client),
    });
    await Promise.resolve();
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("normalizuje brak danych do pustej listy i propaguje błąd", async () => {
    h.rpc.mockImplementation(() => rpcOk(null));
    const client = makeClient();
    const { result } = renderHook(() => useMessageSearch("polityka", null), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);

    h.rpc.mockImplementation(() => rpcFail("fts blew up"));
    const failing = renderHook(() => useMessageSearch("umowa", null), {
      wrapper: wrapperFor(makeClient()),
    });
    await waitFor(() => expect(failing.result.current.isError).toBe(true));
  });
});
