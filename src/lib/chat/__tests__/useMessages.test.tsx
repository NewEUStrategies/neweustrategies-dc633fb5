// Warstwa danych WIADOMOŚCI jednej rozmowy. Testujemy KONTRAKT Z BAZĄ, nie
// implementację react-query: kształt zapytań PostgREST, kursor złożony
// paginacji, STEMPEL `tenant_id` na każdym zapisie, optymistyczne wpisy do
// cache'u i ich odwracanie, oraz kanały realtime (w tym refcount na kanale
// broadcastu „typing", który jest jedyną gwarancją, że rozmówca w ogóle
// dostaje pingi).
//
// Do tej pory `useMessages.ts` (713 linii) miał 0% pokrycia - a decyduje
// o tym, czy wiadomość dojdzie, czy nie zniknie z listy i czy nie wycieknie
// między tenantami.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  BASE_ISO,
  CHAT_IDS,
  chatMessage,
  fail,
  isoOffset,
  messageRow,
  ok,
  reactionRow,
  realtimeStub,
  supabaseFromStub,
  type SupabaseResult,
} from "@/test/chat/fixtures";

const h = vi.hoisted(() => ({
  auth: { uid: "user-me" as string | null, tenantId: "tenant-alfa" as string | null },
  toastError: vi.fn(),
}));

// Atrapy modułowe muszą powstać w fabryce `vi.mock` (hoisting), więc trzymamy
// je w kontenerze `vi.hoisted` i sięgamy po nie w testach przez `stubs`.
const stubs = vi.hoisted(() => ({ from: null as unknown, realtime: null as unknown }));

vi.mock("@/integrations/supabase/client", async () => {
  const fixtures = await import("@/test/chat/fixtures");
  const from = fixtures.supabaseFromStub();
  const realtime = fixtures.realtimeStub();
  stubs.from = from;
  stubs.realtime = realtime;
  return {
    supabase: {
      from: from.from,
      channel: realtime.channel,
      removeChannel: realtime.removeChannel,
      rpc: vi.fn(async () => ({ data: null, error: null })),
    },
  };
});

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: h.auth.uid ? { id: h.auth.uid } : null,
    tenantId: h.auth.tenantId,
  }),
}));

vi.mock("sonner", () => ({ toast: { error: h.toastError, success: vi.fn() } }));

vi.mock("@/lib/i18n", () => ({ default: { t: (key: string) => key } }));

import {
  useConversationAttachments,
  useConversationChannel,
  useDeleteMessage,
  useDiscardFailedMessage,
  useEditMessage,
  useMessages,
  useReactions,
  useSendMessage,
  useToggleReaction,
} from "../useMessages";
import { chatKeys } from "../keys";
import type { MessagesData } from "../messageCache";

type FromStub = ReturnType<typeof supabaseFromStub>;
type RealtimeStub = ReturnType<typeof realtimeStub>;

const db = () => stubs.from as FromStub;
const rt = () => stubs.realtime as RealtimeStub;

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

/** Klucz historii wołającego - skrót do inspekcji cache'u w asercjach. */
const messagesKey = () => chatKeys.messages(CHAT_IDS.me, CHAT_IDS.conversation);

beforeEach(() => {
  h.auth.uid = CHAT_IDS.me;
  h.auth.tenantId = CHAT_IDS.tenant;
  h.toastError.mockReset();
  db().reset();
  rt().reset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useMessages - historia i paginacja", () => {
  it("czyta stronę najnowsze-pierwsze z podwójnym porządkowaniem i limitem", async () => {
    db().setResponse("messages", ok([messageRow({ id: "m1" })]));
    const client = makeClient();
    const { result } = renderHook(() => useMessages(CHAT_IDS.conversation, true), {
      wrapper: wrapperFor(client),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const chain = db().lastChain("messages");
    expect(chain?.argsOf("eq")).toEqual(["conversation_id", CHAT_IDS.conversation]);
    // Dwa `order` to nie ozdoba: kursor jest złożony `(created_at, id)`, więc
    // baza MUSI porządkować po obu kolumnach w tym samym kierunku.
    const orders = chain?.calls.filter((c) => c.method === "order").map((c) => c.args);
    expect(orders).toEqual([
      ["created_at", { ascending: false }],
      ["id", { ascending: false }],
    ]);
    expect(chain?.argsOf("limit")).toEqual([40]);
    expect(result.current.data?.pages[0]?.rows.map((m) => m.id)).toEqual(["m1"]);
  });

  it("nie ustawia kursora dla strony krótszej niż limit (koniec historii)", async () => {
    db().setResponse("messages", ok([messageRow({ id: "m1" })]));
    const client = makeClient();
    const { result } = renderHook(() => useMessages(CHAT_IDS.conversation, true), {
      wrapper: wrapperFor(client),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.pages[0]?.nextCursor).toBeNull();
    expect(result.current.hasNextPage).toBe(false);
  });

  it("ustawia kursor złożony na PEŁNEJ stronie i przekazuje go w filtrze `or`", async () => {
    const full = Array.from({ length: 40 }, (_, i) =>
      messageRow({ id: `m${String(i).padStart(2, "0")}`, created_at: isoOffset(-i) }),
    );
    const last = full[39];
    db().setResponse("messages", ok(full));
    const client = makeClient();
    const { result } = renderHook(() => useMessages(CHAT_IDS.conversation, true), {
      wrapper: wrapperFor(client),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.pages[0]?.nextCursor).toEqual({
      createdAt: last?.created_at,
      id: last?.id,
    });
    expect(result.current.hasNextPage).toBe(true);

    db().setResponse("messages", ok([]));
    await act(async () => {
      await result.current.fetchNextPage();
    });
    // Kursor idzie jako „starszy znacznik LUB ten sam znacznik z mniejszym id" -
    // gołe `created_at.lt` przeskakiwałoby wiersze z granicy sekundy.
    expect(db().lastChain("messages")?.argsOf("or")).toEqual([
      `created_at.lt.${last?.created_at},and(created_at.eq.${last?.created_at},id.lt.${last?.id})`,
    ]);
  });

  it("nie odpytuje bazy bez sesji ani przy `enabled` false", async () => {
    h.auth.uid = null;
    db().setResponse("messages", ok([]));
    const client = makeClient();
    renderHook(() => useMessages(CHAT_IDS.conversation, true), { wrapper: wrapperFor(client) });
    await Promise.resolve();
    expect(db().chainsFor("messages")).toHaveLength(0);

    h.auth.uid = CHAT_IDS.me;
    renderHook(() => useMessages(CHAT_IDS.conversation, false), { wrapper: wrapperFor(client) });
    await Promise.resolve();
    expect(db().chainsFor("messages")).toHaveLength(0);
  });

  it("propaguje błąd zapytania zamiast udawać pustą historię", async () => {
    db().setResponse("messages", fail("permission denied"));
    const client = makeClient();
    const { result } = renderHook(() => useMessages(CHAT_IDS.conversation, true), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe("useSendMessage", () => {
  it("stempluje tenant_id i sender_id wołającego na wstawianym wierszu", async () => {
    db().setResponse("messages", ok(messageRow({ id: "server-1", sender_id: CHAT_IDS.me })));
    const client = makeClient();
    const { result } = renderHook(() => useSendMessage(), { wrapper: wrapperFor(client) });

    await act(async () => {
      await result.current.mutateAsync({
        conversationId: CHAT_IDS.conversation,
        kind: "text",
        body: "Cześć",
      });
    });

    const insert = db().lastChain("messages")?.argsOf("insert")?.[0] as Record<string, unknown>;
    expect(insert).toMatchObject({
      conversation_id: CHAT_IDS.conversation,
      tenant_id: CHAT_IDS.tenant,
      sender_id: CHAT_IDS.me,
      kind: "text",
      body: "Cześć",
      forwarded: false,
    });
  });

  it("normalizuje brak pól opcjonalnych do NULL-i, nie do undefined", async () => {
    db().setResponse("messages", ok(messageRow({ id: "server-1" })));
    const client = makeClient();
    const { result } = renderHook(() => useSendMessage(), { wrapper: wrapperFor(client) });

    await act(async () => {
      await result.current.mutateAsync({ conversationId: CHAT_IDS.conversation, kind: "text" });
    });

    const insert = db().lastChain("messages")?.argsOf("insert")?.[0] as Record<string, unknown>;
    expect(insert.body).toBeNull();
    expect(insert.attachment_path).toBeNull();
    expect(insert.attachment_duration).toBeNull();
    expect(insert.reply_to_id).toBeNull();
  });

  it("przenosi metadane załącznika (w tym czas trwania notatki głosowej)", async () => {
    db().setResponse("messages", ok(messageRow({ id: "server-1", kind: "audio" })));
    const client = makeClient();
    const { result } = renderHook(() => useSendMessage(), { wrapper: wrapperFor(client) });

    await act(async () => {
      await result.current.mutateAsync({
        conversationId: CHAT_IDS.conversation,
        kind: "audio",
        attachment: {
          path: "t/c/u/nota.webm",
          name: "nota.webm",
          mime: "audio/webm",
          size: 2048,
          duration: 12,
        },
      });
    });

    expect(db().lastChain("messages")?.argsOf("insert")?.[0]).toMatchObject({
      attachment_path: "t/c/u/nota.webm",
      attachment_mime: "audio/webm",
      attachment_size: 2048,
      attachment_duration: 12,
    });
  });

  it("odmawia wysyłki bez rozstrzygniętego tenanta - RLS i tak by odrzucił", async () => {
    h.auth.tenantId = null;
    db().setResponse("messages", ok(messageRow()));
    const client = makeClient();
    const { result } = renderHook(() => useSendMessage(), { wrapper: wrapperFor(client) });

    await expect(
      act(async () => {
        await result.current.mutateAsync({ conversationId: CHAT_IDS.conversation, kind: "text" });
      }),
    ).rejects.toThrow("chat: tenant not resolved");
    expect(db().chainsFor("messages")).toHaveLength(0);
  });

  it("odmawia wysyłki bez sesji", async () => {
    h.auth.uid = null;
    db().setResponse("messages", ok(messageRow()));
    const client = makeClient();
    const { result } = renderHook(() => useSendMessage(), { wrapper: wrapperFor(client) });

    await expect(
      act(async () => {
        await result.current.mutateAsync({ conversationId: CHAT_IDS.conversation, kind: "text" });
      }),
    ).rejects.toThrow("chat: auth required");
  });

  it("zakłada wiersz optymistyczny NAWET w pustym cache i podmienia go na serwerowy", async () => {
    // Regresja: nowa rozmowa nie ma jeszcze historii w cache, więc pierwsza
    // wysyłka ściga się z pierwszym fetchem. Bez zasiania wiersza w pustym
    // cache pierwsza wiadomość świeżego wątku ginęła.
    db().setResponse("messages", ok(messageRow({ id: "server-1", sender_id: CHAT_IDS.me })));
    const client = makeClient();
    const { result } = renderHook(() => useSendMessage(), { wrapper: wrapperFor(client) });

    await act(async () => {
      await result.current.mutateAsync({
        conversationId: CHAT_IDS.conversation,
        kind: "text",
        body: "pierwsza",
      });
    });

    const cached = client.getQueryData<MessagesData>(messagesKey());
    const rows = cached?.pages.flatMap((p) => p.rows) ?? [];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("server-1");
    expect(rows[0]?.pending).toBe(false);
  });

  it("przełącza wiersz optymistyczny w stan nieudany, gdy wstawka padnie", async () => {
    db().setResponse("messages", fail("network down"));
    const client = makeClient();
    const { result } = renderHook(() => useSendMessage(), { wrapper: wrapperFor(client) });

    await act(async () => {
      result.current.mutate({
        conversationId: CHAT_IDS.conversation,
        kind: "text",
        body: "nie dojdzie",
      });
    });
    await waitFor(() => expect(result.current.isError).toBe(true));

    const rows =
      client.getQueryData<MessagesData>(messagesKey())?.pages.flatMap((p) => p.rows) ?? [];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.failed).toBe(true);
    expect(rows[0]?.pending).toBe(false);
    expect(rows[0]?.id.startsWith("pending-")).toBe(true);
  });

  it("tłumaczy limit tempa serwera na osobny komunikat, a inne błędy zostawia cicho", async () => {
    db().setResponse("messages", fail("chat: rate limited"));
    const client = makeClient();
    const { result } = renderHook(() => useSendMessage(), { wrapper: wrapperFor(client) });

    await act(async () => {
      result.current.mutate({ conversationId: CHAT_IDS.conversation, kind: "text", body: "spam" });
    });
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("chat.rateLimited"));

    h.toastError.mockReset();
    db().setResponse("messages", fail("some other failure"));
    const second = renderHook(() => useSendMessage(), { wrapper: wrapperFor(makeClient()) });
    await act(async () => {
      second.result.current.mutate({
        conversationId: CHAT_IDS.conversation,
        kind: "text",
        body: "x",
      });
    });
    await waitFor(() => expect(second.result.current.isError).toBe(true));
    expect(h.toastError).not.toHaveBeenCalled();
  });
});

describe("useEditMessage / useDeleteMessage", () => {
  it("edycja aktualizuje wyłącznie treść i łata wiersz W MIEJSCU", async () => {
    const client = makeClient();
    client.setQueryData<MessagesData>(messagesKey(), {
      pages: [{ rows: [chatMessage({ id: "m1", body: "stara" })], nextCursor: null }],
      pageParams: [null],
    });
    db().setResponse(
      "messages",
      ok(messageRow({ id: "m1", body: "nowa", edited_at: isoOffset(1) })),
    );
    const { result } = renderHook(() => useEditMessage(CHAT_IDS.conversation), {
      wrapper: wrapperFor(client),
    });

    await act(async () => {
      await result.current.mutateAsync({ messageId: "m1", body: "nowa" });
    });

    const chain = db().lastChain("messages");
    expect(chain?.argsOf("update")?.[0]).toEqual({ body: "nowa" });
    expect(chain?.argsOf("eq")).toEqual(["id", "m1"]);
    const rows = client.getQueryData<MessagesData>(messagesKey())?.pages[0]?.rows ?? [];
    expect(rows[0]?.body).toBe("nowa");
    expect(rows[0]?.edited_at).toBe(isoOffset(1));
  });

  it("edycja NIE wstawia wiersza, którego nie ma w cache (brak teleportacji na górę wątku)", async () => {
    const client = makeClient();
    client.setQueryData<MessagesData>(messagesKey(), {
      pages: [{ rows: [chatMessage({ id: "m1" })], nextCursor: null }],
      pageParams: [null],
    });
    db().setResponse("messages", ok(messageRow({ id: "paginated-out", body: "edytowana" })));
    const { result } = renderHook(() => useEditMessage(CHAT_IDS.conversation), {
      wrapper: wrapperFor(client),
    });

    await act(async () => {
      await result.current.mutateAsync({ messageId: "paginated-out", body: "edytowana" });
    });

    const rows = client.getQueryData<MessagesData>(messagesKey())?.pages[0]?.rows ?? [];
    expect(rows.map((m) => m.id)).toEqual(["m1"]);
  });

  it("cofnięcie wysłania zeruje treść I KAŻDE pole załącznika (tombstone)", async () => {
    const client = makeClient();
    client.setQueryData<MessagesData>(messagesKey(), {
      pages: [
        {
          rows: [chatMessage({ id: "m1", kind: "image", attachment_path: "t/c/u/a.png" })],
          nextCursor: null,
        },
      ],
      pageParams: [null],
    });
    db().setResponse(
      "messages",
      ok(messageRow({ id: "m1", body: null, attachment_path: null, deleted_at: BASE_ISO })),
    );
    const { result } = renderHook(() => useDeleteMessage(CHAT_IDS.conversation), {
      wrapper: wrapperFor(client),
    });

    await act(async () => {
      await result.current.mutateAsync("m1");
    });

    const update = db().lastChain("messages")?.argsOf("update")?.[0] as Record<string, unknown>;
    expect(update).toMatchObject({
      body: null,
      attachment_path: null,
      attachment_name: null,
      attachment_mime: null,
      attachment_size: null,
      attachment_duration: null,
    });
    expect(typeof update.deleted_at).toBe("string");
    expect(client.getQueryData<MessagesData>(messagesKey())?.pages[0]?.rows[0]?.deleted_at).toBe(
      BASE_ISO,
    );
  });
});

describe("useDiscardFailedMessage", () => {
  it("usuwa wskazany wiersz z cache i zachowuje pozostałe", () => {
    const client = makeClient();
    client.setQueryData<MessagesData>(messagesKey(), {
      pages: [
        {
          rows: [chatMessage({ id: "failed", failed: true }), chatMessage({ id: "ok" })],
          nextCursor: null,
        },
      ],
      pageParams: [null],
    });
    const { result } = renderHook(() => useDiscardFailedMessage(CHAT_IDS.conversation), {
      wrapper: wrapperFor(client),
    });

    act(() => result.current("failed"));

    expect(
      client.getQueryData<MessagesData>(messagesKey())?.pages[0]?.rows.map((m) => m.id),
    ).toEqual(["ok"]);
  });

  it("zachowuje stabilną tożsamość funkcji (memo zmemoizowanych dymków)", () => {
    const client = makeClient();
    const { result, rerender } = renderHook(() => useDiscardFailedMessage(CHAT_IDS.conversation), {
      wrapper: wrapperFor(client),
    });
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  it("bez sesji nie rusza cache'u", () => {
    h.auth.uid = null;
    const client = makeClient();
    const { result } = renderHook(() => useDiscardFailedMessage(CHAT_IDS.conversation), {
      wrapper: wrapperFor(client),
    });
    act(() => result.current("anything"));
    expect(client.getQueryData(messagesKey())).toBeUndefined();
  });
});

describe("useReactions", () => {
  it("grupuje reakcje po id wiadomości w porządku rosnącym", async () => {
    db().setResponse(
      "message_reactions",
      ok([
        reactionRow({ id: "r1", message_id: "m1", emoji: "👍" }),
        reactionRow({ id: "r2", message_id: "m1", emoji: "❤️", user_id: CHAT_IDS.peerTwo }),
        reactionRow({ id: "r3", message_id: "m2", emoji: "😂" }),
      ]),
    );
    const client = makeClient();
    const { result } = renderHook(() => useReactions(CHAT_IDS.conversation, true), {
      wrapper: wrapperFor(client),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.get("m1")?.map((r) => r.id)).toEqual(["r1", "r2"]);
    expect(result.current.data?.get("m2")?.map((r) => r.id)).toEqual(["r3"]);
    const chain = db().lastChain("message_reactions");
    expect(chain?.argsOf("order")).toEqual(["created_at", { ascending: true }]);
    expect(chain?.argsOf("limit")).toEqual([2000]);
  });

  it("zwraca pustą mapę dla rozmowy bez reakcji", async () => {
    db().setResponse("message_reactions", ok([]));
    const client = makeClient();
    const { result } = renderHook(() => useReactions(CHAT_IDS.conversation, true), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.size).toBe(0);
  });
});

describe("useToggleReaction", () => {
  const reactionsKey = () => chatKeys.reactions(CHAT_IDS.me, CHAT_IDS.conversation);

  it("dodanie reakcji idzie INSERT-em ze stemplem tenanta i rozmowy", async () => {
    db().setResponse("message_reactions", ok(null));
    const client = makeClient();
    const { result } = renderHook(() => useToggleReaction(CHAT_IDS.conversation), {
      wrapper: wrapperFor(client),
    });

    await act(async () => {
      await result.current.mutateAsync({ messageId: "m1", emoji: "👍", current: null });
    });

    expect(db().chainsFor("message_reactions")[0]?.argsOf("insert")?.[0]).toEqual({
      message_id: "m1",
      conversation_id: CHAT_IDS.conversation,
      tenant_id: CHAT_IDS.tenant,
      user_id: CHAT_IDS.me,
      emoji: "👍",
    });
  });

  it("ta sama emotka drugi raz USUWA reakcję wołającego", async () => {
    db().setResponse("message_reactions", ok(null));
    const client = makeClient();
    const { result } = renderHook(() => useToggleReaction(CHAT_IDS.conversation), {
      wrapper: wrapperFor(client),
    });

    await act(async () => {
      await result.current.mutateAsync({ messageId: "m1", emoji: "👍", current: "👍" });
    });

    const chain = db().lastChain("message_reactions");
    expect(chain?.has("delete")).toBe(true);
    expect(chain?.calls.filter((c) => c.method === "eq").map((c) => c.args)).toEqual([
      ["message_id", "m1"],
      ["user_id", CHAT_IDS.me],
    ]);
  });

  it("konflikt unikalności (23505) przechodzi na UPDATE - podmiana emotki", async () => {
    let call = 0;
    db().setResponse("message_reactions", (): SupabaseResult => {
      call += 1;
      // Pierwsze wywołanie to INSERT, który uderza w unikalność (message,user).
      if (call === 1) return fail("duplicate", "23505");
      return { data: null, error: null };
    });
    const client = makeClient();
    const { result } = renderHook(() => useToggleReaction(CHAT_IDS.conversation), {
      wrapper: wrapperFor(client),
    });

    await act(async () => {
      await result.current.mutateAsync({ messageId: "m1", emoji: "🎉", current: "👍" });
    });

    const chains = db().chainsFor("message_reactions");
    expect(chains[0]?.has("insert")).toBe(true);
    expect(chains[1]?.argsOf("update")?.[0]).toEqual({ emoji: "🎉" });
  });

  it("błąd inny niż konflikt NIE przechodzi na UPDATE", async () => {
    db().setResponse("message_reactions", fail("permission denied", "42501"));
    const client = makeClient();
    const { result } = renderHook(() => useToggleReaction(CHAT_IDS.conversation), {
      wrapper: wrapperFor(client),
    });

    await act(async () => {
      result.current.mutate({ messageId: "m1", emoji: "🎉", current: null });
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(db().chainsFor("message_reactions")).toHaveLength(1);
  });

  it("optymistycznie podmienia WŁASNĄ reakcję, nie ruszając reakcji innych", async () => {
    const client = makeClient();
    client.setQueryData(
      reactionsKey(),
      new Map([
        [
          "m1",
          [
            reactionRow({ id: "mine", user_id: CHAT_IDS.me, emoji: "👍" }),
            reactionRow({ id: "theirs", user_id: CHAT_IDS.peer, emoji: "❤️" }),
          ],
        ],
      ]),
    );
    db().setResponse("message_reactions", ok(null));
    const { result } = renderHook(() => useToggleReaction(CHAT_IDS.conversation), {
      wrapper: wrapperFor(client),
    });

    await act(async () => {
      await result.current.mutateAsync({ messageId: "m1", emoji: "🎉", current: "👍" });
    });

    const list =
      client.getQueryData<ReadonlyMap<string, Array<{ user_id: string; emoji: string }>>>(
        reactionsKey(),
      );
    const rows = list?.get("m1") ?? [];
    expect(rows.find((r) => r.user_id === CHAT_IDS.peer)?.emoji).toBe("❤️");
    expect(rows.find((r) => r.user_id === CHAT_IDS.me)?.emoji).toBe("🎉");
  });

  it("po błędzie przywraca WYŁĄCZNIE własny poprzedni wiersz (nie całą mapę)", async () => {
    const client = makeClient();
    client.setQueryData(
      reactionsKey(),
      new Map([["m1", [reactionRow({ id: "mine", user_id: CHAT_IDS.me, emoji: "👍" })]]]),
    );
    db().setResponse("message_reactions", fail("boom"));
    const { result } = renderHook(() => useToggleReaction(CHAT_IDS.conversation), {
      wrapper: wrapperFor(client),
    });

    await act(async () => {
      result.current.mutate({ messageId: "m1", emoji: "🎉", current: "👍" });
    });
    await waitFor(() => expect(result.current.isError).toBe(true));

    const rows =
      client
        .getQueryData<ReadonlyMap<string, Array<{ id: string; emoji: string }>>>(reactionsKey())
        ?.get("m1") ?? [];
    expect(rows.map((r) => r.emoji)).toEqual(["👍"]);
    expect(rows[0]?.id).toBe("mine");
  });

  it("usunięcie ostatniej reakcji wiadomości wypina jej klucz z mapy", async () => {
    const client = makeClient();
    client.setQueryData(
      reactionsKey(),
      new Map([["m1", [reactionRow({ id: "mine", user_id: CHAT_IDS.me, emoji: "👍" })]]]),
    );
    db().setResponse("message_reactions", ok(null));
    const { result } = renderHook(() => useToggleReaction(CHAT_IDS.conversation), {
      wrapper: wrapperFor(client),
    });

    await act(async () => {
      await result.current.mutateAsync({ messageId: "m1", emoji: "👍", current: "👍" });
    });

    expect(client.getQueryData<ReadonlyMap<string, unknown>>(reactionsKey())?.has("m1")).toBe(
      false,
    );
  });

  it("odmawia bez rozstrzygniętego tenanta", async () => {
    h.auth.tenantId = null;
    db().setResponse("message_reactions", ok(null));
    const client = makeClient();
    const { result } = renderHook(() => useToggleReaction(CHAT_IDS.conversation), {
      wrapper: wrapperFor(client),
    });

    await expect(
      act(async () => {
        await result.current.mutateAsync({ messageId: "m1", emoji: "👍" });
      }),
    ).rejects.toThrow("chat: tenant not resolved");
  });
});

describe("useConversationChannel - strumień postgres_changes", () => {
  const noop = () => {};

  it("wpina wiersz z INSERT-a wprost do cache'u, bez refetchu", async () => {
    const client = makeClient();
    client.setQueryData<MessagesData>(messagesKey(), {
      pages: [{ rows: [chatMessage({ id: "m1", created_at: isoOffset(1) })], nextCursor: null }],
      pageParams: [null],
    });
    renderHook(() => useConversationChannel(CHAT_IDS.conversation, true, noop), {
      wrapper: wrapperFor(client),
    });

    const channel = rt().channelByPrefix("chat-conv-db:");
    expect(channel).toBeDefined();
    act(() => {
      channel?.emitPostgres("messages", {
        eventType: "INSERT",
        new: messageRow({ id: "m2", created_at: isoOffset(2) }),
      });
    });

    expect(
      client.getQueryData<MessagesData>(messagesKey())?.pages[0]?.rows.map((m) => m.id),
    ).toContain("m2");
    expect(db().chainsFor("messages")).toHaveLength(0);
  });

  it("UPDATE łata istniejący wiersz, ale nie wstawia paginowanego-poza-okno", () => {
    const client = makeClient();
    client.setQueryData<MessagesData>(messagesKey(), {
      pages: [{ rows: [chatMessage({ id: "m1", body: "stara" })], nextCursor: null }],
      pageParams: [null],
    });
    renderHook(() => useConversationChannel(CHAT_IDS.conversation, true, noop), {
      wrapper: wrapperFor(client),
    });
    const channel = rt().channelByPrefix("chat-conv-db:");

    act(() => {
      channel?.emitPostgres("messages", {
        eventType: "UPDATE",
        new: messageRow({ id: "m1", body: "nowa" }),
      });
      channel?.emitPostgres("messages", {
        eventType: "UPDATE",
        new: messageRow({ id: "obcy", body: "spoza okna" }),
      });
    });

    const rows = client.getQueryData<MessagesData>(messagesKey())?.pages[0]?.rows ?? [];
    expect(rows.map((m) => m.id)).toEqual(["m1"]);
    expect(rows[0]?.body).toBe("nowa");
  });

  it("ignoruje zdarzenia bez id (ładunek okrojony przez RLS)", () => {
    const client = makeClient();
    client.setQueryData<MessagesData>(messagesKey(), {
      pages: [{ rows: [chatMessage({ id: "m1" })], nextCursor: null }],
      pageParams: [null],
    });
    renderHook(() => useConversationChannel(CHAT_IDS.conversation, true, noop), {
      wrapper: wrapperFor(client),
    });
    const channel = rt().channelByPrefix("chat-conv-db:");

    act(() => {
      channel?.emitPostgres("messages", { eventType: "INSERT", new: {} });
    });

    expect(client.getQueryData<MessagesData>(messagesKey())?.pages[0]?.rows).toHaveLength(1);
  });

  it("reakcja z realtime ląduje w mapie, a DELETE po samym id ją zdejmuje", () => {
    const client = makeClient();
    const key = chatKeys.reactions(CHAT_IDS.me, CHAT_IDS.conversation);
    client.setQueryData(key, new Map());
    renderHook(() => useConversationChannel(CHAT_IDS.conversation, true, noop), {
      wrapper: wrapperFor(client),
    });
    const channel = rt().channelByPrefix("chat-conv-db:");

    act(() => {
      channel?.emitPostgres("message_reactions", {
        eventType: "INSERT",
        new: reactionRow({ id: "r1", message_id: "m1" }),
      });
    });
    expect(client.getQueryData<ReadonlyMap<string, unknown[]>>(key)?.get("m1")).toHaveLength(1);

    // Z włączonym RLS Supabase okraja ładunek DELETE do klucza głównego, więc
    // usunięcie trzeba zlokalizować skanem mapy po `id`.
    act(() => {
      channel?.emitPostgres("message_reactions", { eventType: "DELETE", old: { id: "r1" } });
    });
    expect(client.getQueryData<ReadonlyMap<string, unknown[]>>(key)?.has("m1")).toBe(false);
  });

  it("zamyka kanał przy odmontowaniu", () => {
    const client = makeClient();
    const { unmount } = renderHook(
      () => useConversationChannel(CHAT_IDS.conversation, true, noop),
      { wrapper: wrapperFor(client) },
    );
    const channel = rt().channelByPrefix("chat-conv-db:");
    expect(channel?.removed).toBe(false);
    unmount();
    expect(channel?.removed).toBe(true);
  });

  it("nie subskrybuje niczego bez sesji ani przy `enabled` false", () => {
    h.auth.uid = null;
    const client = makeClient();
    renderHook(() => useConversationChannel(CHAT_IDS.conversation, true, noop), {
      wrapper: wrapperFor(client),
    });
    expect(rt().channels).toHaveLength(0);

    h.auth.uid = CHAT_IDS.me;
    renderHook(() => useConversationChannel(CHAT_IDS.conversation, false, noop), {
      wrapper: wrapperFor(client),
    });
    expect(rt().channels).toHaveLength(0);
  });
});

describe("useConversationChannel - broadcast pisania", () => {
  it("stoi na STABILNYM temacie rozmowy - inaczej rozmówca nigdy nie dostanie pingu", () => {
    const client = makeClient();
    renderHook(() => useConversationChannel(CHAT_IDS.conversation, true, () => {}), {
      wrapper: wrapperFor(client),
    });
    const typing = rt().channelByPrefix(`chat-conv:${CHAT_IDS.conversation}`);
    expect(typing?.name).toBe(`chat-conv:${CHAT_IDS.conversation}`);
    // private:true = Realtime Authorization wpuszcza tylko członków rozmowy
    // w ich tenancie; self:false = nie echujemy własnych pingów.
    expect(typing?.config).toMatchObject({
      config: { private: true, broadcast: { self: false } },
    });
  });

  it("współdzieli JEDEN kanał między powierzchniami i zwija go dopiero po ostatnim odbiorcy", () => {
    const client = makeClient();
    const first = renderHook(() => useConversationChannel(CHAT_IDS.conversation, true, () => {}), {
      wrapper: wrapperFor(client),
    });
    const second = renderHook(() => useConversationChannel(CHAT_IDS.conversation, true, () => {}), {
      wrapper: wrapperFor(client),
    });

    const typingChannels = rt().channels.filter((c) => c.name.startsWith("chat-conv:"));
    expect(typingChannels).toHaveLength(1);

    first.unmount();
    expect(typingChannels[0]?.removed).toBe(false);
    second.unmount();
    expect(typingChannels[0]?.removed).toBe(true);
  });

  it("doręcza ping rozmówcy KAŻDEMU nasłuchującemu i pomija własne echo", () => {
    const client = makeClient();
    const mine = vi.fn();
    const other = vi.fn();
    renderHook(() => useConversationChannel(CHAT_IDS.conversation, true, mine), {
      wrapper: wrapperFor(client),
    });
    renderHook(() => useConversationChannel(CHAT_IDS.conversation, true, other), {
      wrapper: wrapperFor(client),
    });
    const typing = rt().channelByPrefix(`chat-conv:${CHAT_IDS.conversation}`);

    act(() => typing?.emitBroadcast("typing", { userId: CHAT_IDS.peer, typing: true }));
    expect(mine).toHaveBeenCalledWith({ userId: CHAT_IDS.peer, typing: true });
    expect(other).toHaveBeenCalledWith({ userId: CHAT_IDS.peer, typing: true });

    mine.mockReset();
    act(() => typing?.emitBroadcast("typing", { userId: CHAT_IDS.me, typing: true }));
    expect(mine).not.toHaveBeenCalled();
  });

  it("odrzuca ładunek bez `userId` (nie da się zgasić wskaźnika anonimowi)", () => {
    const client = makeClient();
    const listener = vi.fn();
    renderHook(() => useConversationChannel(CHAT_IDS.conversation, true, listener), {
      wrapper: wrapperFor(client),
    });
    const typing = rt().channelByPrefix(`chat-conv:${CHAT_IDS.conversation}`);
    act(() => typing?.emitBroadcast("typing", { typing: true }));
    expect(listener).not.toHaveBeenCalled();
  });

  it("`sendTyping` nadaje ping z domyślnym `typing: true`, a `false` jawnym zatrzymaniem", () => {
    const client = makeClient();
    const { result } = renderHook(
      () => useConversationChannel(CHAT_IDS.conversation, true, () => {}),
      { wrapper: wrapperFor(client) },
    );
    const typing = rt().channelByPrefix(`chat-conv:${CHAT_IDS.conversation}`);

    act(() => result.current.sendTyping());
    act(() => result.current.sendTyping(false));

    expect(typing?.sent).toEqual([
      {
        type: "broadcast",
        event: "typing",
        payload: { userId: CHAT_IDS.me, typing: true },
      },
      {
        type: "broadcast",
        event: "typing",
        payload: { userId: CHAT_IDS.me, typing: false },
      },
    ]);
  });

  it("`sendTyping` zachowuje stabilną tożsamość (kompozytor jest zmemoizowany)", () => {
    const client = makeClient();
    const { result, rerender } = renderHook(
      () => useConversationChannel(CHAT_IDS.conversation, true, () => {}),
      { wrapper: wrapperFor(client) },
    );
    const first = result.current.sendTyping;
    rerender();
    expect(result.current.sendTyping).toBe(first);
  });
});

describe("useConversationAttachments", () => {
  it("pyta o wyłącznie żywe załączniki obrazów i plików, najnowsze pierwsze", async () => {
    db().setResponse(
      "messages",
      ok([{ id: "a1", created_at: BASE_ISO, kind: "image", sender_id: CHAT_IDS.peer }]),
    );
    const client = makeClient();
    const { result } = renderHook(() => useConversationAttachments(CHAT_IDS.conversation, true), {
      wrapper: wrapperFor(client),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const chain = db().lastChain("messages");
    expect(chain?.argsOf("not")).toEqual(["attachment_path", "is", null]);
    expect(chain?.argsOf("is")).toEqual(["deleted_at", null]);
    expect(chain?.argsOf("in")).toEqual(["kind", ["image", "file"]]);
    expect(chain?.argsOf("order")).toEqual(["created_at", { ascending: false }]);
    expect(chain?.argsOf("limit")).toEqual([500]);
  });

  it("propaguje błąd zapytania", async () => {
    db().setResponse("messages", fail("denied"));
    const client = makeClient();
    const { result } = renderHook(() => useConversationAttachments(CHAT_IDS.conversation, true), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
