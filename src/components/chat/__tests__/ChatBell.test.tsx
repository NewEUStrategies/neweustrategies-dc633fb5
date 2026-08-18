// Dzwonek czatu w nagłówku - wejście do całego modułu, do tej pory 0%.
//
// Cztery gwarancje, których nikt inny nie pilnuje:
//   1. Licznik nieprzeczytanych jest w ETYKIECIE DOSTĘPNEJ, nie tylko
//      w kolorowym kółku - inaczej nie istnieje dla czytnika ekranu.
//   2. Zarchiwizowane rozmowy NIE pojawiają się na droplistie (semantyka
//      WhatsAppa: archiwum żyje w /messages).
//   3. Preferencja `chat_bell_enabled` per tenant potrafi ukryć ikonę, ale
//      dopóki preferencje się ładują, dzwonek NIE MIGA.
//   4. Filtr listy pojawia się dopiero, gdy jest co filtrować, i szuka po
//      nazwie rozstrzygniętej (pseudonim > profil), nie po surowym wierszu.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/lib/i18n-chat";
import { chatPl } from "@/lib/i18n-chat";
import {
  CHAT_IDS,
  conversationRow,
  conversationView,
  peerProfile,
  peerProfileMap,
} from "@/test/chat/fixtures";
import type { ConversationView } from "@/lib/chat/types";

const h = vi.hoisted(() => ({
  uid: "user-me" as string | null,
  views: [] as ConversationView[],
  loading: false,
  unread: 0,
  prefs: undefined as Record<string, boolean> | undefined,
  peers: null as unknown,
  nicknames: null as unknown,
  online: new Set<string>() as ReadonlySet<string>,
  openChatWindow: vi.fn(),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: h.uid ? { id: h.uid } : null, tenantId: CHAT_IDS.tenant }),
}));

vi.mock("@/lib/chat/useConversations", () => ({
  useChatListRealtime: () => {},
  useChatUnreadTotal: () => h.unread,
  useConversations: () => ({ data: h.views, isLoading: h.loading }),
  usePeerProfiles: () => ({ data: h.peers }),
  isMuted: () => false,
}));

vi.mock("@/lib/chat/useIncomingChatToasts", () => ({ useIncomingChatToasts: () => {} }));
vi.mock("@/lib/chat/presence", () => ({ useOnlineUsers: () => h.online }));
vi.mock("@/lib/chat/nicknames", () => ({ useNicknames: () => ({ data: h.nicknames }) }));
vi.mock("@/lib/notifications/useNotifications", () => ({
  useNotificationPreferences: () => ({ data: h.prefs }),
}));
vi.mock("@/lib/chat/chatDockBus", () => ({ openChatWindow: h.openChatWindow }));

// Wyszukiwarka odbiorców ma własną warstwę danych (RPC sieci kontaktów) -
// tutaj interesuje nas tylko, że dzwonek ją MONTUJE w trybie „nowa".
vi.mock("../NewChatSearch", () => ({
  NewChatSearch: () => <div data-testid="new-chat-search" />,
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

import { ChatBell } from "../ChatBell";

function renderBell() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ChatBell />
    </QueryClientProvider>,
  );
}

/** Otwiera droplistę i zwraca jej zawartość. */
function openBell(): HTMLElement {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(chatPl.chat.messages) }));
  return screen.getByRole("dialog");
}

function views(count: number): ConversationView[] {
  return Array.from({ length: count }, (_, i) =>
    conversationView({ conversation: conversationRow({ id: `conv-${i}` }) }),
  );
}

beforeEach(() => {
  h.uid = CHAT_IDS.me;
  h.views = [conversationView()];
  h.loading = false;
  h.unread = 0;
  h.prefs = { chat_bell_enabled: true };
  h.peers = peerProfileMap();
  h.nicknames = new Map();
  h.online = new Set();
  h.openChatWindow.mockReset();
});

afterEach(() => cleanup());

describe("widoczność dzwonka", () => {
  it("gość nie widzi dzwonka wcale", () => {
    h.uid = null;
    const { container } = renderBell();
    expect(container.firstChild).toBeNull();
  });

  it("preferencja per tenant potrafi go ukryć", () => {
    h.prefs = { chat_bell_enabled: false };
    const { container } = renderBell();
    expect(container.firstChild).toBeNull();
  });

  it("NIE MIGA, dopóki preferencje się ładują (domyślnie widoczny)", () => {
    h.prefs = undefined;
    renderBell();
    expect(screen.getByRole("button", { name: chatPl.chat.messages })).toBeTruthy();
  });
});

describe("licznik nieprzeczytanych", () => {
  it("bez nieprzeczytanych etykieta jest samą nazwą sekcji", () => {
    renderBell();
    expect(screen.getByRole("button", { name: chatPl.chat.messages })).toBeTruthy();
  });

  it("z nieprzeczytanymi liczba trafia do ETYKIETY DOSTĘPNEJ przycisku", () => {
    h.unread = 5;
    renderBell();
    const trigger = screen.getByRole("button", { name: new RegExp(chatPl.chat.messages) });
    expect(trigger.getAttribute("aria-label")).toContain("5");
  });
});

describe("droplista", () => {
  it("pokazuje rozmowy i otwiera okno przez magistralę doku", () => {
    renderBell();
    openBell();
    fireEvent.click(screen.getByText("Anna Nowak"));
    expect(h.openChatWindow).toHaveBeenCalledWith({ conversationId: CHAT_IDS.conversation });
  });

  it("POMIJA rozmowy zarchiwizowane - archiwum żyje w /messages", () => {
    h.views = [
      conversationView({ me: { archived_at: "2026-08-01T00:00:00.000Z" } }),
      conversationView({
        conversation: conversationRow({ id: CHAT_IDS.otherConversation }),
        peers: [],
      }),
    ];
    renderBell();
    const panel = openBell();
    // Widoczna zostaje tylko rozmowa nieukryta; ta bez profilu ma placeholder.
    expect(panel.textContent).not.toContain("Anna Nowak");
  });

  it("stan pusty proponuje rozpoczęcie nowej rozmowy", () => {
    h.views = [];
    renderBell();
    const panel = openBell();
    expect(panel.textContent).toContain(chatPl.chat.noConversations);

    // Dwa przyciski o tej etykiecie: przełącznik w nagłówku panelu i CTA
    // w stanie pustym. Klikamy CTA (ostatni), bo o nim jest ten przypadek.
    const ctas = screen.getAllByRole("button", { name: chatPl.chat.newMessage });
    fireEvent.click(ctas[ctas.length - 1] as HTMLElement);
    expect(screen.getByTestId("new-chat-search")).toBeTruthy();
  });

  it("w trakcie wczytywania pokazuje szkielet, nie stan pusty", () => {
    h.views = [];
    h.loading = true;
    renderBell();
    const panel = openBell();
    expect(panel.textContent).not.toContain(chatPl.chat.noConversations);
    expect(panel.querySelectorAll(".skeleton-shimmer").length).toBeGreaterThan(0);
  });

  it("przełącznik nowej wiadomości montuje i zdejmuje wyszukiwarkę odbiorców", () => {
    renderBell();
    openBell();
    fireEvent.click(screen.getByRole("button", { name: chatPl.chat.newMessage }));
    expect(screen.getByTestId("new-chat-search")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: chatPl.chat.close }));
    expect(screen.queryByTestId("new-chat-search")).toBeNull();
  });

  it("zawsze prowadzi do pełnej skrzynki", () => {
    renderBell();
    const panel = openBell();
    const link = panel.querySelector('a[href="/messages"]');
    expect(link?.textContent).toContain(chatPl.chat.seeAll);
  });
});

describe("filtr listy", () => {
  it("pojawia się dopiero powyżej trzech rozmów", () => {
    h.views = views(3);
    renderBell();
    expect(screen.queryByLabelText(chatPl.chat.searchConversations)).toBeNull();
    cleanup();

    h.views = views(4);
    renderBell();
    openBell();
    expect(screen.getByLabelText(chatPl.chat.searchConversations)).toBeTruthy();
  });

  it("filtruje po nazwie ROZSTRZYGNIĘTEJ, a pseudonim wygrywa", () => {
    h.views = [
      conversationView({ conversation: conversationRow({ id: "conv-a" }) }),
      conversationView({ conversation: conversationRow({ id: "conv-b" }) }),
      conversationView({ conversation: conversationRow({ id: "conv-c" }) }),
      conversationView({ conversation: conversationRow({ id: "conv-d" }) }),
    ];
    h.peers = peerProfileMap([peerProfile({ display_name: "Anna Nowak" })]);
    h.nicknames = new Map([["conv-a", new Map([[CHAT_IDS.peer, "Ania z DG ENER"]])]]);
    renderBell();
    const panel = openBell();

    const input = screen.getByLabelText(chatPl.chat.searchConversations);
    fireEvent.change(input, { target: { value: "DG ENER" } });
    expect(panel.textContent).toContain("Ania z DG ENER");

    fireEvent.change(input, { target: { value: "nie-ma-takiej-osoby" } });
    expect(panel.textContent).toContain(chatPl.chat.noConversations);
  });
});
