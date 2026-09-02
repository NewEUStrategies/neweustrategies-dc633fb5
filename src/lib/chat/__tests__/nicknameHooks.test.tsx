// Pseudonimy per rozmowa - WARSTWA DANYCH (`useNicknames`, `useSetNickname`).
//
// Czyste grupowanie i reguła rozstrzygania nazw mają własny plik
// (`nicknames.test.ts`). Tutaj jest to, co zostawało na zerze: hook czytający
// i MUTACJA optymistyczna z wycofaniem. Stawka jest konkretna - pseudonim
// widzą WSZYSCY członkowie rozmowy (semantyka Messengera), więc nieudany zapis,
// który zostawia optymistyczną nazwę na ekranie, kłamie użytkownikowi o tym,
// co widzą inni.
//
// RODO: pseudonimy i nazwy profili są zmyślone.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CHAT_IDS, ok, supabaseFromStub, supabaseRpcStub } from "@/test/chat/fixtures";
import { chatKeys } from "../keys";
import type { NicknameIndex } from "../nicknames";

const h = vi.hoisted(() => ({
  uid: "user-me" as string | null,
  from: null as unknown,
  rpc: null as unknown,
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: h.uid ? { id: h.uid } : null, tenantId: "tenant-alfa" }),
}));

vi.mock("@/integrations/supabase/client", async () => {
  const fixtures = await import("@/test/chat/fixtures");
  const from = fixtures.supabaseFromStub();
  const rpc = fixtures.supabaseRpcStub();
  h.from = from;
  h.rpc = rpc;
  return { supabase: { from: from.from, rpc: rpc.rpc } };
});

import { useNicknames, useSetNickname } from "../nicknames";

type FromStub = ReturnType<typeof supabaseFromStub>;
type RpcStub = ReturnType<typeof supabaseRpcStub>;
const from = () => h.from as FromStub;
const rpc = () => h.rpc as RpcStub;

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

function indexIn(client: QueryClient): NicknameIndex | undefined {
  return client.getQueryData<NicknameIndex>(chatKeys.nicknames(CHAT_IDS.me));
}

beforeEach(() => {
  h.uid = CHAT_IDS.me;
  from().reset();
  rpc().reset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useNicknames", () => {
  it("anonim nie odpytuje tabeli pseudonimów", async () => {
    h.uid = null;
    const client = makeClient();
    const { result } = renderHook(() => useNicknames(), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(from().chainsFor("conversation_nicknames")).toHaveLength(0);
  });

  it("czyta JEDNYM zapytaniem z sufitem wierszy i grupuje po rozmowie", async () => {
    from().setResponse(
      "conversation_nicknames",
      ok([
        { conversation_id: CHAT_IDS.conversation, user_id: CHAT_IDS.peer, nickname: "Analityk" },
        { conversation_id: CHAT_IDS.group, user_id: CHAT_IDS.peer, nickname: "Prowadząca" },
      ]),
    );
    const client = makeClient();
    const { result } = renderHook(() => useNicknames(), { wrapper: wrapperFor(client) });
    // `placeholderData` sprawia, że `isSuccess` jest prawdziwe NATYCHMIAST
    // (z pustym indeksem zastępczym) - czekamy więc na realną zawartość.
    await waitFor(() =>
      expect(result.current.data?.get(CHAT_IDS.conversation)?.get(CHAT_IDS.peer)).toBe("Analityk"),
    );
    expect(result.current.data?.get(CHAT_IDS.group)?.get(CHAT_IDS.peer)).toBe("Prowadząca");

    const chain = from().lastChain("conversation_nicknames");
    // Sufit wierszy jest częścią kontraktu: bez niego jeden użytkownik z tysiącem
    // rozmów ściągałby przy każdym wejściu nieograniczoną tabelę.
    expect(chain?.argsOf("limit")).toEqual([2000]);
    expect(chain?.argsOf("select")?.[0]).toBe("conversation_id, user_id, nickname");
  });

  it("odmowa bazy wypada błędem, a nie pustym indeksem udającym brak pseudonimów", async () => {
    from().setResponse("conversation_nicknames", { data: null, error: new Error("denied") });
    const client = makeClient();
    const { result } = renderHook(() => useNicknames(), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it("pusta odpowiedź daje pusty indeks, nie `undefined`", async () => {
    from().setResponse("conversation_nicknames", ok(null));
    const client = makeClient();
    const { result } = renderHook(() => useNicknames(), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.size).toBe(0);
  });
});

describe("useSetNickname", () => {
  it("woła RPC z PRZYCIĘTYM pseudonimem i pełnym kompletem argumentów", async () => {
    rpc().setData("chat_set_nickname", null);
    const client = makeClient();
    const { result } = renderHook(() => useSetNickname(), { wrapper: wrapperFor(client) });

    await result.current.mutateAsync({
      conversationId: CHAT_IDS.conversation,
      userId: CHAT_IDS.peer,
      nickname: "  Analityk  ",
    });

    const call = rpc().lastCall("chat_set_nickname");
    expect(call?.arg("p_conversation_id")).toBe(CHAT_IDS.conversation);
    expect(call?.arg("p_user_id")).toBe(CHAT_IDS.peer);
    expect(call?.arg("p_nickname")).toBe("Analityk");
  });

  it("nazwa jest w indeksie ZANIM serwer odpowie (zapis optymistyczny)", async () => {
    const client = makeClient();
    client.setQueryData<NicknameIndex>(chatKeys.nicknames(CHAT_IDS.me), new Map());
    // Dowód KOLEJNOŚCI, nie stanu końcowego: atrapa zagląda do cache'u
    // W MOMENCIE wywołania RPC. Jeśli nazwa jest tam już wtedy, znaczy że
    // `onMutate` zadziałał przed rundą do bazy.
    let seenAtRpc: string | null = null;
    rpc().setResponse("chat_set_nickname", () => {
      seenAtRpc = indexIn(client)?.get(CHAT_IDS.conversation)?.get(CHAT_IDS.peer) ?? null;
      return { data: null, error: null };
    });
    const { result } = renderHook(() => useSetNickname(), { wrapper: wrapperFor(client) });

    await result.current.mutateAsync({
      conversationId: CHAT_IDS.conversation,
      userId: CHAT_IDS.peer,
      nickname: "Analityk",
    });

    expect(seenAtRpc).toBe("Analityk");
  });

  it("pusty pseudonim KASUJE wpis, a ostatni skasowany usuwa całą rozmowę z indeksu", async () => {
    rpc().setData("chat_set_nickname", null);
    const client = makeClient();
    client.setQueryData<NicknameIndex>(
      chatKeys.nicknames(CHAT_IDS.me),
      new Map([[CHAT_IDS.conversation, new Map([[CHAT_IDS.peer, "Analityk"]])]]),
    );
    const { result } = renderHook(() => useSetNickname(), { wrapper: wrapperFor(client) });

    await result.current.mutateAsync({
      conversationId: CHAT_IDS.conversation,
      userId: CHAT_IDS.peer,
      nickname: "   ",
    });

    expect(indexIn(client)?.has(CHAT_IDS.conversation)).toBe(false);
    expect(rpc().lastCall("chat_set_nickname")?.arg("p_nickname")).toBe("");
  });

  it("kasowanie JEDNEGO z dwóch pseudonimów zostawia rozmowę w indeksie", async () => {
    rpc().setData("chat_set_nickname", null);
    const client = makeClient();
    client.setQueryData<NicknameIndex>(
      chatKeys.nicknames(CHAT_IDS.me),
      new Map([
        [
          CHAT_IDS.conversation,
          new Map([
            [CHAT_IDS.peer, "Analityk"],
            [CHAT_IDS.peerTwo, "Prowadząca"],
          ]),
        ],
      ]),
    );
    const { result } = renderHook(() => useSetNickname(), { wrapper: wrapperFor(client) });

    await result.current.mutateAsync({
      conversationId: CHAT_IDS.conversation,
      userId: CHAT_IDS.peer,
      nickname: "",
    });

    expect(indexIn(client)?.get(CHAT_IDS.conversation)?.get(CHAT_IDS.peerTwo)).toBe("Prowadząca");
    expect(indexIn(client)?.get(CHAT_IDS.conversation)?.has(CHAT_IDS.peer)).toBe(false);
  });

  it("ODMOWA SERWERA WYCOFUJE optymistyczną nazwę - ekran nie może kłamać o tym, co widzą inni", async () => {
    rpc().setError("chat_set_nickname", "permission denied", "42501");
    const client = makeClient();
    const before: NicknameIndex = new Map([
      [CHAT_IDS.conversation, new Map([[CHAT_IDS.peer, "Analityk"]])],
    ]);
    client.setQueryData<NicknameIndex>(chatKeys.nicknames(CHAT_IDS.me), before);
    const { result } = renderHook(() => useSetNickname(), { wrapper: wrapperFor(client) });

    await expect(
      result.current.mutateAsync({
        conversationId: CHAT_IDS.conversation,
        userId: CHAT_IDS.peer,
        nickname: "Podmieniona nazwa",
      }),
    ).rejects.toBeTruthy();

    await waitFor(() =>
      expect(indexIn(client)?.get(CHAT_IDS.conversation)?.get(CHAT_IDS.peer)).toBe("Analityk"),
    );
  });

  it("mutacja BEZ sesji nie dotyka cache'u (nie ma czyjego indeksu ruszać)", async () => {
    h.uid = null;
    rpc().setData("chat_set_nickname", null);
    const client = makeClient();
    const { result } = renderHook(() => useSetNickname(), { wrapper: wrapperFor(client) });

    await result.current.mutateAsync({
      conversationId: CHAT_IDS.conversation,
      userId: CHAT_IDS.peer,
      nickname: "Analityk",
    });

    expect(client.getQueryData(chatKeys.nicknames(undefined))).toBeUndefined();
    expect(rpc().callsFor("chat_set_nickname")).toHaveLength(1);
  });

  it("po zakończeniu indeks jest UNIEWAŻNIANY - realtime i tak przyniesie prawdę", async () => {
    rpc().setData("chat_set_nickname", null);
    const client = makeClient();
    client.setQueryData<NicknameIndex>(chatKeys.nicknames(CHAT_IDS.me), new Map());
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useSetNickname(), { wrapper: wrapperFor(client) });

    await result.current.mutateAsync({
      conversationId: CHAT_IDS.conversation,
      userId: CHAT_IDS.peer,
      nickname: "Analityk",
    });

    await waitFor(() =>
      expect(
        invalidate.mock.calls.some(
          (call) =>
            JSON.stringify(call[0]?.queryKey) === JSON.stringify(chatKeys.nicknames(CHAT_IDS.me)),
        ),
      ).toBe(true),
    );
  });
});
