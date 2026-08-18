// Dwie powierzchnie czatu, które stały na zerze, a obie mają realną logikę
// produktową (nie tylko układ):
//
//   MessageSearchBar - próg znaków, debounce, cztery stany wyniku (ładowanie /
//                      błąd / brak trafień / lista), Escape zamykający TYLKO
//                      pasek, oraz snippet renderowany komponentem, NIGDY
//                      przez innerHTML (trafienie wraca w konwencji [[[ ]]]).
//   ForwardDialog    - przekazanie WYŁĄCZNIE tekstu (ścieżka załącznika niesie
//                      id rozmowy ŹRÓDŁOWEJ, więc storage RLS nie wpuściłby
//                      odbiorcy), wykluczenie rozmowy źródłowej i archiwum
//                      z listy celów, obcięcie długiego ciała.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/lib/i18n-chat";
import { chatPl } from "@/lib/i18n-chat";
import {
  CHAT_IDS,
  chatMessage,
  conversationRow,
  conversationView,
  messageSearchHit,
  peerProfile,
  peerProfileMap,
} from "@/test/chat/fixtures";
import type { ConversationView } from "@/lib/chat/types";
import type { MessageSearchHit } from "@/lib/chat/useMessageSearch";

const h = vi.hoisted(() => ({
  hits: [] as MessageSearchHit[],
  searchLoading: false,
  searchError: false,
  searchCalls: [] as Array<{ q: string; conversationId: string | null }>,
  views: [] as ConversationView[],
  peers: null as unknown,
  sendCalls: [] as unknown[],
  sendOutcome: { kind: "success" } as { kind: "success" } | { kind: "error" },
  sendPending: false,
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/chat/useMessageSearch", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/chat/useMessageSearch")>();
  return {
    ...actual,
    useMessageSearch: (q: string, conversationId: string | null) => {
      const query = q.trim();
      const enabled = query.length >= actual.MESSAGE_SEARCH_MIN_CHARS;
      if (enabled) h.searchCalls.push({ q: query, conversationId });
      return {
        data: enabled ? h.hits : undefined,
        isLoading: enabled && h.searchLoading,
        isError: enabled && h.searchError,
        isSuccess: enabled && !h.searchLoading && !h.searchError,
      };
    },
  };
});

vi.mock("@/lib/chat/useConversations", () => ({
  useConversations: () => ({ data: h.views }),
  usePeerProfiles: () => ({ data: h.peers }),
  isMuted: () => false,
}));

vi.mock("@/lib/chat/useMessages", () => ({
  useSendMessage: () => ({
    isPending: h.sendPending,
    mutate: (vars: unknown, options?: { onSuccess?: () => void; onError?: (e: Error) => void }) => {
      h.sendCalls.push(vars);
      if (h.sendOutcome.kind === "success") options?.onSuccess?.();
      else options?.onError?.(new Error("denied"));
    },
  }),
}));

vi.mock("sonner", () => ({ toast: h.toast }));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

import { ForwardDialog } from "../ForwardDialog";
import { MessageSearchBar } from "../MessageSearchBar";

function withClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

/** Debounce paska to 200 ms - trzeba go przewinąć, żeby zapytanie ruszyło. */
async function typeAndSettle(value: string): Promise<void> {
  const input = screen.getByLabelText(chatPl.chat.search.inConversation);
  fireEvent.change(input, { target: { value } });
  await act(async () => {
    vi.advanceTimersByTime(250);
  });
}

beforeEach(() => {
  h.hits = [];
  h.searchLoading = false;
  h.searchError = false;
  h.searchCalls = [];
  h.views = [];
  h.peers = peerProfileMap();
  h.sendCalls = [];
  h.sendOutcome = { kind: "success" };
  h.sendPending = false;
  h.toast.success.mockReset();
  h.toast.error.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("MessageSearchBar", () => {
  function renderBar(overrides: Partial<React.ComponentProps<typeof MessageSearchBar>> = {}) {
    return withClient(
      <MessageSearchBar
        conversationId={CHAT_IDS.conversation}
        lang="pl"
        resolveAuthorName={(id) => (id === CHAT_IDS.me ? chatPl.chat.you : "Anna Nowak")}
        onJump={() => {}}
        onClose={() => {}}
        {...overrides}
      />,
    );
  }

  it("startuje z pustym polem i BEZ zapytania (próg znaków)", () => {
    vi.useFakeTimers();
    renderBar();
    expect(screen.getByLabelText(chatPl.chat.search.inConversation)).toBeTruthy();
    expect(h.searchCalls).toEqual([]);
  });

  it("jedna litera nie uruchamia wyszukiwania", async () => {
    vi.useFakeTimers();
    renderBar();
    await typeAndSettle("p");
    expect(h.searchCalls).toEqual([]);
  });

  it("od dwóch znaków pyta o TĘ rozmowę, po debounce", async () => {
    vi.useFakeTimers();
    h.hits = [messageSearchHit()];
    renderBar();
    await typeAndSettle("polityka");
    expect(h.searchCalls.at(-1)).toEqual({
      q: "polityka",
      conversationId: CHAT_IDS.conversation,
    });
  });

  it("pokazuje stan ładowania zamiast pustej listy", async () => {
    vi.useFakeTimers();
    h.searchLoading = true;
    renderBar();
    await typeAndSettle("polityka");
    expect(screen.getByText(chatPl.chat.search.searching)).toBeTruthy();
  });

  it("błąd wyszukiwania mówi wprost, że się nie udało", async () => {
    vi.useFakeTimers();
    h.searchError = true;
    renderBar();
    await typeAndSettle("polityka");
    expect(screen.getByText(chatPl.chat.search.error)).toBeTruthy();
  });

  it("brak trafień cytuje szukaną frazę", async () => {
    vi.useFakeTimers();
    h.hits = [];
    renderBar();
    await typeAndSettle("kwantowa");
    expect(screen.getByText(/kwantowa/)).toBeTruthy();
  });

  it("lista trafień pokazuje autora i podświetlony fragment JAKO TEKST", async () => {
    vi.useFakeTimers();
    h.hits = [messageSearchHit({ snippet: "[[[polityka]]] energetyczna", total_count: 1 })];
    renderBar();
    await typeAndSettle("polityka");

    expect(screen.getByText("Anna Nowak")).toBeTruthy();
    // Konwencja [[[ ]]] jest renderowana komponentem, więc znaczniki NIE
    // pojawiają się w treści - i żaden HTML z bazy nie trafia do DOM-u.
    expect(screen.queryByText(/\[\[\[/)).toBeNull();
    expect(screen.getByText("polityka")).toBeTruthy();
  });

  it("klik w trafienie zgłasza skok z całym wierszem", async () => {
    vi.useFakeTimers();
    const hit = messageSearchHit();
    h.hits = [hit];
    const onJump = vi.fn();
    renderBar({ onJump });
    await typeAndSettle("polityka");

    fireEvent.click(screen.getByText("Anna Nowak").closest("button") as HTMLElement);
    expect(onJump).toHaveBeenCalledWith(hit);
  });

  it("Escape zamyka TYLKO pasek - okno dokowane zostaje otwarte", () => {
    // Okno dokowane nasłuchuje Escape NA SWOIM korzeniu (zamknięcie okna).
    // Pasek musi zatrzymać propagację, inaczej jedno Escape robi dwie rzeczy:
    // zwija wyszukiwanie I zamyka całą rozmowę.
    vi.useFakeTimers();
    const onClose = vi.fn();
    const windowEscape = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <div onKeyDown={windowEscape}>
          <MessageSearchBar
            conversationId={CHAT_IDS.conversation}
            lang="pl"
            resolveAuthorName={() => "Anna Nowak"}
            onJump={() => {}}
            onClose={onClose}
          />
        </div>
      </QueryClientProvider>,
    );

    fireEvent.keyDown(screen.getByLabelText(chatPl.chat.search.inConversation), {
      key: "Escape",
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(windowEscape).not.toHaveBeenCalled();
  });

  it("przycisk zamknięcia zwija pasek", () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    renderBar({ onClose });
    fireEvent.click(screen.getByRole("button", { name: chatPl.chat.search.close }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("ForwardDialog", () => {
  const source = CHAT_IDS.conversation;

  function renderForward(overrides: Partial<React.ComponentProps<typeof ForwardDialog>> = {}) {
    return withClient(
      <ForwardDialog
        message={chatMessage({ id: "m1", kind: "text", body: "Treść do przekazania" })}
        excludeConversationId={source}
        onClose={() => {}}
        {...overrides}
      />,
    );
  }

  it("zamknięty (brak wiadomości) nie renderuje dialogu", () => {
    renderForward({ message: null });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("pokazuje przekazywaną treść w opisie dialogu", () => {
    h.views = [conversationView({ conversation: conversationRow({ id: "conv-target" }) })];
    renderForward();
    expect(screen.getByText("Treść do przekazania")).toBeTruthy();
  });

  it("WYKLUCZA rozmowę źródłową i archiwum z listy celów", () => {
    h.views = [
      conversationView({ conversation: conversationRow({ id: source }) }),
      conversationView({
        conversation: conversationRow({ id: "conv-archived" }),
        me: { archived_at: "2026-08-01T00:00:00.000Z" },
      }),
    ];
    renderForward();
    expect(screen.getByText(chatPl.chat.forward.noTargets)).toBeTruthy();
  });

  it("przekazuje tekst z flagą `forwarded` i potwierdza sukces", async () => {
    h.views = [conversationView({ conversation: conversationRow({ id: "conv-target" }) })];
    const onClose = vi.fn();
    const onForwarded = vi.fn();
    renderForward({ onClose, onForwarded });

    fireEvent.click(screen.getByText("Anna Nowak").closest("button") as HTMLElement);

    expect(h.sendCalls).toEqual([
      {
        conversationId: "conv-target",
        kind: "text",
        body: "Treść do przekazania",
        forwarded: true,
      },
    ]);
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith(chatPl.chat.forward.sent));
    expect(onForwarded).toHaveBeenCalledWith("conv-target");
    expect(onClose).toHaveBeenCalled();
  });

  it("obcina bardzo długie ciało do limitu wiadomości", () => {
    h.views = [conversationView({ conversation: conversationRow({ id: "conv-target" }) })];
    renderForward({
      message: chatMessage({ id: "m1", kind: "text", body: "x".repeat(9000) }),
    });

    fireEvent.click(screen.getByText("Anna Nowak").closest("button") as HTMLElement);
    const body = (h.sendCalls[0] as { body: string }).body;
    expect(body).toHaveLength(8000);
  });

  it("wiadomość bez treści (tombstone) nie da się przekazać", () => {
    h.views = [conversationView({ conversation: conversationRow({ id: "conv-target" }) })];
    renderForward({ message: chatMessage({ id: "m1", kind: "text", body: null }) });

    fireEvent.click(screen.getByText("Anna Nowak").closest("button") as HTMLElement);
    expect(h.sendCalls).toEqual([]);
  });

  it("odmowa serwera daje komunikat błędu i NIE zamyka dialogu", async () => {
    h.views = [conversationView({ conversation: conversationRow({ id: "conv-target" }) })];
    h.sendOutcome = { kind: "error" };
    const onClose = vi.fn();
    renderForward({ onClose });

    fireEvent.click(screen.getByText("Anna Nowak").closest("button") as HTMLElement);
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith(chatPl.chat.forward.error));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("wysyłka w locie blokuje przyciski celów (bez podwójnego przekazania)", () => {
    h.views = [conversationView({ conversation: conversationRow({ id: "conv-target" }) })];
    h.sendPending = true;
    renderForward();
    expect(screen.getByText("Anna Nowak").closest("button")).toBeDisabled();
  });

  it("filtruje cele po nazwie rozstrzygniętej", () => {
    h.views = [
      conversationView({ conversation: conversationRow({ id: "conv-a" }) }),
      conversationView({
        conversation: conversationRow({ id: "conv-b" }),
        peers: [
          {
            ...conversationView().peers[0]!,
            user_id: CHAT_IDS.peerTwo,
            conversation_id: "conv-b",
          },
        ],
      }),
    ];
    h.peers = peerProfileMap([
      peerProfile(),
      peerProfile({ id: CHAT_IDS.peerTwo, display_name: "Marek Kowalski" }),
    ]);
    renderForward();

    fireEvent.change(screen.getByLabelText(chatPl.chat.searchConversations), {
      target: { value: "marek" },
    });
    expect(screen.getByText("Marek Kowalski")).toBeTruthy();
    expect(screen.queryByText("Anna Nowak")).toBeNull();
  });

  it("krzyżyk zamyka dialog", () => {
    h.views = [conversationView({ conversation: conversationRow({ id: "conv-target" }) })];
    const onClose = vi.fn();
    renderForward({ onClose });
    fireEvent.click(screen.getByRole("button", { name: chatPl.chat.close }));
    expect(onClose).toHaveBeenCalled();
  });
});
