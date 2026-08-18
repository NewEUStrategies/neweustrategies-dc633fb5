// Hooki wyprowadzone z `ChatWindow` podczas refaktoru. Każdy zamyka regułę,
// która wcześniej mieszkała w organizmie na 0% pokrycia i której złamanie widzi
// wyłącznie użytkownik:
//
//   useTypingRegistry - licznik wygaszenia per osoba i brak przecieku piszących
//                       między wątkami przy przełączeniu rozmowy BEZ remountu,
//   useThreadJump     - budżet stron, brak podwójnego fetchu, uczciwa porażka,
//   useAutoMarkRead   - reaktywna widoczność karty i koalescencja po id.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { CHAT_IDS } from "@/test/chat/fixtures";

const h = vi.hoisted(() => ({
  channel: {
    listeners: [] as Array<(event: { userId: string; typing?: boolean }) => void>,
    sent: [] as Array<{ typing?: boolean }>,
    acquired: 0,
    released: 0,
    conversationIds: [] as string[],
  },
}));

// `useConversationChannel` jest testowany osobno (useMessages.test.tsx) - tutaj
// interesuje nas WYŁĄCZNIE rejestr nad nim, więc kanał jest atrapą.
vi.mock("../useMessages", () => ({
  useConversationChannel: (
    conversationId: string,
    enabled: boolean,
    onTyping: (event: { userId: string; typing?: boolean }) => void,
  ) => {
    if (enabled) {
      h.channel.acquired += 1;
      h.channel.conversationIds.push(conversationId);
      h.channel.listeners.push(onTyping);
    }
    return {
      sendTyping: (typing?: boolean) => h.channel.sent.push({ typing }),
    };
  },
}));

import { TYPING_VISIBLE_MS, useTypingRegistry } from "../useTypingRegistry";
import { useThreadJump } from "../useThreadJump";
import { shouldMarkRead, useAutoMarkRead, useDocumentVisible } from "../useAutoMarkRead";
import { JUMP_PAGE_BUDGET } from "../thread";

/** Wywołaj ostatnio zarejestrowany handler pingów. */
function emitTyping(event: { userId: string; typing?: boolean }): void {
  const listener = h.channel.listeners.at(-1);
  listener?.(event);
}

beforeEach(() => {
  h.channel.listeners.length = 0;
  h.channel.sent.length = 0;
  h.channel.conversationIds.length = 0;
  h.channel.acquired = 0;
  h.channel.released = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useTypingRegistry", () => {
  it("dodaje piszącego na ping i gasi go po okresie widoczności", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useTypingRegistry(CHAT_IDS.conversation, true, true));

    act(() => emitTyping({ userId: CHAT_IDS.peer }));
    expect([...result.current.typingUserIds]).toEqual([CHAT_IDS.peer]);

    act(() => vi.advanceTimersByTime(TYPING_VISIBLE_MS + 1));
    expect(result.current.typingUserIds.size).toBe(0);
  });

  it("kolejny ping PRZEDŁUŻA widoczność, nie dubluje wpisu", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useTypingRegistry(CHAT_IDS.conversation, true, true));

    act(() => emitTyping({ userId: CHAT_IDS.peer }));
    act(() => vi.advanceTimersByTime(TYPING_VISIBLE_MS - 500));
    act(() => emitTyping({ userId: CHAT_IDS.peer }));
    act(() => vi.advanceTimersByTime(TYPING_VISIBLE_MS - 500));

    expect([...result.current.typingUserIds]).toEqual([CHAT_IDS.peer]);
  });

  it("jawne `typing:false` gasi TYLKO tę osobę (semantyka kręgu)", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useTypingRegistry(CHAT_IDS.conversation, true, true));

    act(() => emitTyping({ userId: CHAT_IDS.peer }));
    act(() => emitTyping({ userId: CHAT_IDS.peerTwo }));
    act(() => emitTyping({ userId: CHAT_IDS.peer, typing: false }));

    expect([...result.current.typingUserIds]).toEqual([CHAT_IDS.peerTwo]);
  });

  it("liczniki są NIEZALEŻNE - wygaszenie jednej osoby nie rusza drugiej", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useTypingRegistry(CHAT_IDS.conversation, true, true));

    act(() => emitTyping({ userId: CHAT_IDS.peer }));
    act(() => vi.advanceTimersByTime(2000));
    act(() => emitTyping({ userId: CHAT_IDS.peerTwo }));
    // Po kolejnych 2,5 s pierwszy wygasł, drugi ma jeszcze 1,5 s.
    act(() => vi.advanceTimersByTime(2500));

    expect([...result.current.typingUserIds]).toEqual([CHAT_IDS.peerTwo]);
  });

  it("przełączenie rozmowy BEZ remountu zdejmuje piszących poprzedniego wątku", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => useTypingRegistry(id, true, true),
      { initialProps: { id: CHAT_IDS.conversation as string } },
    );

    act(() => emitTyping({ userId: CHAT_IDS.peer }));
    expect(result.current.typingUserIds.size).toBe(1);

    act(() => rerender({ id: CHAT_IDS.otherConversation }));
    expect(result.current.typingUserIds.size).toBe(0);
    expect(h.channel.conversationIds).toContain(CHAT_IDS.otherConversation);
  });

  it("`sendTyping` nadaje, gdy preferencja włączona", () => {
    const { result } = renderHook(() => useTypingRegistry(CHAT_IDS.conversation, true, true));
    act(() => result.current.sendTyping());
    act(() => result.current.sendTyping(false));
    expect(h.channel.sent).toEqual([{ typing: undefined }, { typing: false }]);
  });

  it("wyłączona preferencja NIE nadaje pingów, ale odbiór działa dalej", () => {
    const { result } = renderHook(() => useTypingRegistry(CHAT_IDS.conversation, true, false));

    act(() => result.current.sendTyping());
    expect(h.channel.sent).toEqual([]);

    act(() => emitTyping({ userId: CHAT_IDS.peer }));
    expect([...result.current.typingUserIds]).toEqual([CHAT_IDS.peer]);
  });

  it("wyłączony rejestr nie zajmuje kanału", () => {
    renderHook(() => useTypingRegistry(CHAT_IDS.conversation, false, true));
    expect(h.channel.acquired).toBe(0);
  });

  it("odmontowanie czyści liczniki (brak zapisu do stanu po unmount)", () => {
    vi.useFakeTimers();
    const { unmount } = renderHook(() => useTypingRegistry(CHAT_IDS.conversation, true, true));
    act(() => emitTyping({ userId: CHAT_IDS.peer }));
    unmount();
    // Gdyby licznik przeżył, ten skok wywołałby setState na odmontowanym hooku.
    expect(() => act(() => vi.advanceTimersByTime(TYPING_VISIBLE_MS + 1))).not.toThrow();
  });
});

describe("useThreadJump", () => {
  const baseParams = {
    request: null,
    isLoaded: () => false,
    hasNextPage: true,
    isFetchingNextPage: false,
    fetchNextPage: () => {},
    onExhausted: () => {},
  };

  it("bez żądania nic nie robi", () => {
    const fetchNextPage = vi.fn();
    const { result } = renderHook(() => useThreadJump({ ...baseParams, fetchNextPage }));
    expect(result.current.jumpTarget).toBeNull();
    expect(fetchNextPage).not.toHaveBeenCalled();
  });

  it("zewnętrzne żądanie ustawia cel i dociąga stronę, gdy cel jest poza oknem", () => {
    const fetchNextPage = vi.fn();
    const { result } = renderHook(() =>
      useThreadJump({
        ...baseParams,
        request: { id: CHAT_IDS.message, nonce: 1 },
        fetchNextPage,
      }),
    );
    expect(result.current.jumpTarget).toBe(CHAT_IDS.message);
    expect(fetchNextPage).toHaveBeenCalledTimes(1);
  });

  it("cel JUŻ w oknie nie dociąga niczego", () => {
    const fetchNextPage = vi.fn();
    const { result } = renderHook(() =>
      useThreadJump({
        ...baseParams,
        request: { id: CHAT_IDS.message, nonce: 1 },
        isLoaded: () => true,
        fetchNextPage,
      }),
    );
    expect(result.current.jumpTarget).toBe(CHAT_IDS.message);
    expect(fetchNextPage).not.toHaveBeenCalled();
  });

  it("strona w locie wstrzymuje kolejne zamówienie", () => {
    const fetchNextPage = vi.fn();
    renderHook(() =>
      useThreadJump({
        ...baseParams,
        request: { id: CHAT_IDS.message, nonce: 1 },
        isFetchingNextPage: true,
        fetchNextPage,
      }),
    );
    expect(fetchNextPage).not.toHaveBeenCalled();
  });

  it("koniec historii kończy skok komunikatem i zeruje cel", () => {
    const onExhausted = vi.fn();
    const { result } = renderHook(() =>
      useThreadJump({
        ...baseParams,
        request: { id: CHAT_IDS.message, nonce: 1 },
        hasNextPage: false,
        onExhausted,
      }),
    );
    expect(onExhausted).toHaveBeenCalledTimes(1);
    expect(result.current.jumpTarget).toBeNull();
  });

  it("budżet stron ogranicza automatyczne dociąganie i kończy się porażką", () => {
    let fetches = 0;
    const onExhausted = vi.fn();
    const { rerender } = renderHook(
      ({ tick }: { tick: number }) =>
        useThreadJump({
          ...baseParams,
          request: { id: CHAT_IDS.message, nonce: 1 },
          // `tick` wymusza kolejny przebieg efektu, tak jak realna zmiana
          // `messages` po dociągnięciu strony.
          isLoaded: () => tick < 0,
          fetchNextPage: () => {
            fetches += 1;
          },
          onExhausted,
        }),
      { initialProps: { tick: 0 } },
    );

    for (let i = 1; i <= JUMP_PAGE_BUDGET + 2; i++) rerender({ tick: i });

    expect(fetches).toBe(JUMP_PAGE_BUDGET);
    expect(onExhausted).toHaveBeenCalled();
  });

  it("`startJump` przezbraja skok z pełnym budżetem (klik w trafienie paska)", () => {
    const fetchNextPage = vi.fn();
    const { result } = renderHook(() => useThreadJump({ ...baseParams, fetchNextPage }));

    act(() => result.current.startJump("hit-1"));
    expect(result.current.jumpTarget).toBe("hit-1");
    expect(fetchNextPage).toHaveBeenCalled();
  });

  it("`onJumpHandled` zwalnia cel po przewinięciu listy", () => {
    const { result } = renderHook(() =>
      useThreadJump({ ...baseParams, isLoaded: () => true, request: { id: "m1", nonce: 1 } }),
    );
    expect(result.current.jumpTarget).toBe("m1");
    act(() => result.current.onJumpHandled());
    expect(result.current.jumpTarget).toBeNull();
  });

  it("ten sam `id` z nowym `nonce` ponawia skok", () => {
    const { result, rerender } = renderHook(
      ({ nonce }: { nonce: number }) =>
        useThreadJump({ ...baseParams, isLoaded: () => true, request: { id: "m1", nonce } }),
      { initialProps: { nonce: 1 } },
    );
    act(() => result.current.onJumpHandled());
    expect(result.current.jumpTarget).toBeNull();

    act(() => rerender({ nonce: 2 }));
    expect(result.current.jumpTarget).toBe("m1");
  });
});

describe("shouldMarkRead", () => {
  const base = {
    myUserId: CHAT_IDS.me,
    lastMessage: { id: "m1", sender_id: CHAT_IDS.peer },
    unreadCount: 2,
    visible: true,
    enabled: true,
    alreadyMarkedId: null,
  };

  it("oznacza cudzą wiadomość przy widocznej karcie i niezerowym liczniku", () => {
    expect(shouldMarkRead(base)).toBe(true);
  });

  it("nie oznacza własnej wiadomości", () => {
    expect(shouldMarkRead({ ...base, lastMessage: { id: "m1", sender_id: CHAT_IDS.me } })).toBe(
      false,
    );
  });

  it("nie oznacza przy ukrytej karcie ani przy wyłączonej preferencji", () => {
    expect(shouldMarkRead({ ...base, visible: false })).toBe(false);
    expect(shouldMarkRead({ ...base, enabled: false })).toBe(false);
  });

  it("nie oznacza pustego wątku, zerowego licznika i braku sesji", () => {
    expect(shouldMarkRead({ ...base, lastMessage: undefined })).toBe(false);
    expect(shouldMarkRead({ ...base, unreadCount: 0 })).toBe(false);
    expect(shouldMarkRead({ ...base, myUserId: undefined })).toBe(false);
  });

  it("koalescuje: ta sama najnowsza wiadomość nie jest oznaczana dwa razy", () => {
    expect(shouldMarkRead({ ...base, alreadyMarkedId: "m1" })).toBe(false);
    expect(shouldMarkRead({ ...base, alreadyMarkedId: "m0" })).toBe(true);
  });
});

describe("useAutoMarkRead", () => {
  const params = {
    conversationId: CHAT_IDS.conversation,
    myUserId: CHAT_IDS.me,
    lastMessage: { id: "m1", sender_id: CHAT_IDS.peer },
    unreadCount: 3,
    enabled: true,
  };

  it("woła RPC RAZ dla tej samej najnowszej wiadomości", () => {
    const markRead = vi.fn();
    const { rerender } = renderHook(() => useAutoMarkRead({ ...params, markRead }));
    rerender();
    rerender();
    expect(markRead).toHaveBeenCalledTimes(1);
    expect(markRead).toHaveBeenCalledWith(CHAT_IDS.conversation);
  });

  it("nowa wiadomość rozmówcy oznacza ponownie", () => {
    const markRead = vi.fn();
    const { rerender } = renderHook(
      ({ id }: { id: string }) =>
        useAutoMarkRead({ ...params, lastMessage: { id, sender_id: CHAT_IDS.peer }, markRead }),
      { initialProps: { id: "m1" } },
    );
    rerender({ id: "m2" });
    expect(markRead).toHaveBeenCalledTimes(2);
  });

  it("wyłączona preferencja nie oznacza niczego", () => {
    const markRead = vi.fn();
    renderHook(() => useAutoMarkRead({ ...params, enabled: false, markRead }));
    expect(markRead).not.toHaveBeenCalled();
  });

  it("zerowy licznik nie generuje round-tripu", () => {
    const markRead = vi.fn();
    renderHook(() => useAutoMarkRead({ ...params, unreadCount: 0, markRead }));
    expect(markRead).not.toHaveBeenCalled();
  });

  it("ukryta karta wstrzymuje oznaczenie, a powrót do niej je wykonuje", () => {
    const markRead = vi.fn();
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    renderHook(() => useAutoMarkRead({ ...params, markRead }));
    expect(markRead).not.toHaveBeenCalled();

    // Widoczność jest REAKTYWNA: powrót do karty musi wywołać oznaczenie sam,
    // bez żadnej innej zmiany propsów.
    visibility.mockReturnValue("visible");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(markRead).toHaveBeenCalledTimes(1);
    visibility.mockRestore();
  });

  it("zmiana rozmowy zeruje koalescencję - ten sam id wiadomości w innym wątku", () => {
    const markRead = vi.fn();
    const { rerender } = renderHook(
      ({ id }: { id: string }) => useAutoMarkRead({ ...params, conversationId: id, markRead }),
      { initialProps: { id: CHAT_IDS.conversation as string } },
    );
    rerender({ id: CHAT_IDS.otherConversation });
    expect(markRead).toHaveBeenCalledTimes(2);
    expect(markRead).toHaveBeenLastCalledWith(CHAT_IDS.otherConversation);
  });

  it("REGRESJA: zmiana licznika nieprzeczytanych NIE woła RPC drugi raz", () => {
    // Licznik zmienia się przy każdym refetchu listy rozmów. Koalescencja
    // musi to przeżyć, inaczej jedna wiadomość generuje serię round-tripów
    // (i - przy realtime - serię fanoutów do rozmówcy).
    const markRead = vi.fn();
    const { rerender } = renderHook(
      ({ unreadCount }: { unreadCount: number }) =>
        useAutoMarkRead({ ...params, unreadCount, markRead }),
      { initialProps: { unreadCount: 3 } },
    );
    rerender({ unreadCount: 2 });
    rerender({ unreadCount: 1 });
    expect(markRead).toHaveBeenCalledTimes(1);
  });

  it("REGRESJA: powrót do widocznej karty nie dubluje oznaczenia tej samej wiadomości", () => {
    const markRead = vi.fn();
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    renderHook(() => useAutoMarkRead({ ...params, markRead }));
    expect(markRead).toHaveBeenCalledTimes(1);

    visibility.mockReturnValue("hidden");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    visibility.mockReturnValue("visible");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(markRead).toHaveBeenCalledTimes(1);
    visibility.mockRestore();
  });
});

describe("useDocumentVisible", () => {
  it("odzwierciedla stan karty i reaguje na zdarzenie zmiany", () => {
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const { result } = renderHook(() => useDocumentVisible());
    expect(result.current).toBe(true);

    visibility.mockReturnValue("hidden");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(result.current).toBe(false);
    visibility.mockRestore();
  });
});
