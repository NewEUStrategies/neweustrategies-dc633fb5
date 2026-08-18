// Pływający dok czatu - do tej pory 0%, a odpowiada za jedyną logikę
// okienkową w produkcie: ile okien wolno mieć otwartych naraz, co się dzieje
// przy przepełnieniu i jak rozmowy wracają z szyny zminimalizowanych.
//
// Cztery reguły, których nie widzi nic innego:
//   1. LIMIT OKIEN zależy od szerokości viewportu (3 / 2 / 1) - responsywność
//      jest tu funkcją, nie tylko klasą CSS.
//   2. PRZEPEŁNIENIE minimalizuje NAJSTARSZE okno, a nie odrzuca nowe: kliknięcie
//      w rozmowę zawsze musi ją otworzyć.
//   3. Dok NIE renderuje się na /messages (pełna skrzynka jest właścicielem
//      powierzchni) ani dla gościa, ani przed hydratacją.
//   4. Zminimalizowany czip da się przywrócić ORAZ zamknąć bez przywracania.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
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

type DockListener = (event: { conversationId: string }) => void;

const h = vi.hoisted(() => ({
  uid: "user-me" as string | null,
  pathname: "/",
  mounted: true,
  views: [] as ConversationView[],
  peers: null as unknown,
  online: new Set<string>() as ReadonlySet<string>,
  listeners: [] as DockListener[],
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: h.uid ? { id: h.uid } : null, tenantId: CHAT_IDS.tenant }),
}));

vi.mock("@/hooks/useHasMounted", () => ({ useHasMounted: () => h.mounted }));

vi.mock("@/lib/chat/useConversations", () => ({
  useChatListRealtime: () => {},
  useConversations: () => ({ data: h.views }),
  usePeerProfiles: () => ({ data: h.peers }),
}));

vi.mock("@/lib/chat/presence", () => ({ useOnlineUsers: () => h.online }));

vi.mock("@/lib/chat/chatDockBus", () => ({
  onOpenChatWindow: (listener: DockListener) => {
    h.listeners.push(listener);
    return () => {
      h.listeners = h.listeners.filter((l) => l !== listener);
    };
  },
  openChatWindow: (event: { conversationId: string }) => {
    for (const listener of h.listeners) listener(event);
  },
}));

// Okno rozmowy jest ładowane leniwie i ma własny test - tutaj wystarczy jego
// tożsamość i przekazane akcje.
vi.mock("../ChatWindow", () => ({
  ChatWindow: (props: {
    conversationId: string;
    onClose?: () => void;
    onMinimize?: () => void;
  }) => (
    <div data-testid="chat-window" data-conversation={props.conversationId}>
      <button type="button" onClick={props.onMinimize}>
        minimalizuj {props.conversationId}
      </button>
      <button type="button" onClick={props.onClose}>
        zamknij {props.conversationId}
      </button>
    </div>
  ),
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
  useRouterState: <T,>({ select }: { select: (state: unknown) => T }): T =>
    select({ location: { pathname: h.pathname } }),
}));

import { ChatDock } from "../ChatDock";
import { openChatWindow } from "@/lib/chat/chatDockBus";

function renderDock() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ChatDock />
    </QueryClientProvider>,
  );
}

/** Otwiera rozmowę tak, jak robi to produkt: przez magistralę. */
async function open(conversationId: string): Promise<void> {
  await act(async () => {
    openChatWindow({ conversationId });
  });
}

function openConversationIds(): string[] {
  return screen
    .queryAllByTestId("chat-window")
    .map((node) => node.getAttribute("data-conversation") ?? "");
}

function viewFor(id: string, peerId: string = CHAT_IDS.peer): ConversationView {
  return conversationView({
    conversation: conversationRow({ id }),
    peers: [
      {
        ...conversationView().peers[0]!,
        user_id: peerId,
        conversation_id: id,
      },
    ],
  });
}

/** Ustawia szerokość viewportu (limit okien jest jej funkcją). */
function setViewportWidth(width: number): void {
  Object.defineProperty(window, "innerWidth", { value: width, configurable: true });
}

beforeEach(() => {
  h.uid = CHAT_IDS.me;
  h.pathname = "/";
  h.mounted = true;
  h.views = [viewFor("conv-a"), viewFor("conv-b", CHAT_IDS.peerTwo), viewFor("conv-c")];
  h.peers = peerProfileMap([peerProfile(), peerProfile({ id: CHAT_IDS.peerTwo })]);
  h.online = new Set();
  h.listeners = [];
  setViewportWidth(1440);
});

afterEach(() => cleanup());

describe("kiedy doku NIE MA", () => {
  it("gość nie dostaje doku", () => {
    h.uid = null;
    const { container } = renderDock();
    expect(container.firstChild).toBeNull();
  });

  it("przed hydratacją dok nie renderuje się (SSR)", () => {
    h.mounted = false;
    const { container } = renderDock();
    expect(container.firstChild).toBeNull();
  });

  it("na /messages i podtrasach właścicielem powierzchni jest pełna skrzynka", () => {
    for (const path of ["/messages", "/messages/conv-a"]) {
      h.pathname = path;
      const { container, unmount } = renderDock();
      expect(container.firstChild).toBeNull();
      unmount();
    }
  });
});

describe("otwieranie okien", () => {
  it("magistrala otwiera okno rozmowy", async () => {
    renderDock();
    await open("conv-a");
    expect(openConversationIds()).toEqual(["conv-a"]);
  });

  it("ponowne otwarcie tej samej rozmowy nie duplikuje okna", async () => {
    renderDock();
    await open("conv-a");
    await open("conv-a");
    expect(openConversationIds()).toEqual(["conv-a"]);
  });

  it("na szerokim ekranie mieszczą się trzy okna", async () => {
    setViewportWidth(1440);
    renderDock();
    await open("conv-a");
    await open("conv-b");
    await open("conv-c");
    expect(openConversationIds()).toEqual(["conv-a", "conv-b", "conv-c"]);
  });

  it("PRZEPEŁNIENIE minimalizuje najstarsze okno, a nowe zawsze się otwiera", async () => {
    // Wąski ekran: jedno okno naraz. Druga rozmowa MUSI się otworzyć, a pierwsza
    // schodzi na szynę - odrzucenie kliknięcia byłoby najgorszym z zachowań.
    setViewportWidth(600);
    renderDock();
    await open("conv-a");
    await open("conv-b");

    expect(openConversationIds()).toEqual(["conv-b"]);
    expect(screen.getByRole("button", { name: new RegExp(chatPl.chat.open) })).toBeTruthy();
  });

  it("na średnim ekranie mieszczą się dwa okna", async () => {
    setViewportWidth(1000);
    renderDock();
    await open("conv-a");
    await open("conv-b");
    await open("conv-c");
    expect(openConversationIds()).toEqual(["conv-b", "conv-c"]);
  });
});

describe("szyna zminimalizowanych", () => {
  it("minimalizacja zdejmuje okno i stawia czip", async () => {
    renderDock();
    await open("conv-a");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "minimalizuj conv-a" }));
    });

    expect(openConversationIds()).toEqual([]);
    expect(screen.getByRole("button", { name: `${chatPl.chat.open}: Anna Nowak` })).toBeTruthy();
  });

  it("czip przywraca rozmowę do okna", async () => {
    renderDock();
    await open("conv-a");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "minimalizuj conv-a" }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: `${chatPl.chat.open}: Anna Nowak` }));
    });
    expect(openConversationIds()).toEqual(["conv-a"]);
  });

  it("czip da się ZAMKNĄĆ bez przywracania rozmowy", async () => {
    renderDock();
    await open("conv-a");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "minimalizuj conv-a" }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: chatPl.chat.close }));
    });
    expect(screen.queryByRole("button", { name: new RegExp(chatPl.chat.open) })).toBeNull();
    expect(openConversationIds()).toEqual([]);
  });

  it("otwarcie zminimalizowanej rozmowy z magistrali zdejmuje jej czip", async () => {
    renderDock();
    await open("conv-a");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "minimalizuj conv-a" }));
    });

    await open("conv-a");
    expect(openConversationIds()).toEqual(["conv-a"]);
    expect(screen.queryByRole("button", { name: new RegExp(chatPl.chat.open) })).toBeNull();
  });

  it("czip pokazuje licznik nieprzeczytanych i skraca go powyżej 99", async () => {
    h.views = [
      conversationView({
        conversation: conversationRow({ id: "conv-a" }),
        me: { unread_count: 128 },
      }),
    ];
    renderDock();
    await open("conv-a");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "minimalizuj conv-a" }));
    });
    expect(screen.getByText("99+")).toBeTruthy();
  });

  it("zamknięcie okna NIE stawia czipa (zamknięcie to nie minimalizacja)", async () => {
    renderDock();
    await open("conv-a");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "zamknij conv-a" }));
    });
    expect(openConversationIds()).toEqual([]);
    expect(screen.queryByRole("button", { name: new RegExp(chatPl.chat.open) })).toBeNull();
  });

  it("przywrócenie przy pełnym limicie minimalizuje najstarsze otwarte okno", async () => {
    setViewportWidth(600);
    renderDock();
    await open("conv-a");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "minimalizuj conv-a" }));
    });
    await open("conv-b");
    expect(openConversationIds()).toEqual(["conv-b"]);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: `${chatPl.chat.open}: Anna Nowak` }));
    });
    expect(openConversationIds()).toEqual(["conv-a"]);
    // conv-b zeszło na szynę, a nie zniknęło.
    expect(screen.getAllByRole("button", { name: new RegExp(chatPl.chat.open) })).toHaveLength(1);
  });
});
