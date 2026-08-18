// Wiersz listy rozmów - do tej pory 0% pokrycia, a to najczęściej oglądany
// element czatu (droplista dzwonka + lewy panel /messages) i jedyne miejsce,
// w którym spotyka się SZEŚĆ niezależnych źródeł prawdy:
//   podgląd ostatniej wiadomości, jej rodzaj, autor, wersja robocza w toku,
//   potwierdzenia ✓/✓✓ własnej wiadomości i licznik nieprzeczytanych.
//
// Każde z nich ma tu własny przypadek, bo pomyłka w którymkolwiek kłamie
// użytkownikowi o stanie rozmowy - a to jedyny widok, w którym stan rozmowy
// widać bez jej otwierania.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@/lib/i18n-chat";
import { chatPl } from "@/lib/i18n-chat";
import {
  CHAT_IDS,
  conversationView,
  groupConversationView,
  isoOffset,
  participantRow,
  peerProfile,
  peerProfileMap,
} from "@/test/chat/fixtures";
import { __resetDraftsForTests, setDraft } from "@/lib/chat/drafts";
import type { ConversationListItemProps } from "../ConversationListItem";
import { ConversationListItem } from "../ConversationListItem";

function itemProps(overrides: Partial<ConversationListItemProps> = {}): ConversationListItemProps {
  return {
    view: conversationView(),
    profiles: peerProfileMap(),
    onlineUsers: new Set(),
    myUserId: CHAT_IDS.me,
    lang: "pl",
    onOpen: () => {},
    ...overrides,
  };
}

function renderItem(overrides: Partial<ConversationListItemProps> = {}) {
  return render(<ConversationListItem {...itemProps(overrides)} />);
}

beforeEach(() => {
  __resetDraftsForTests();
});

afterEach(() => cleanup());

describe("tożsamość wiersza", () => {
  it("pokazuje nazwę rozmówcy z profilu", () => {
    renderItem();
    expect(screen.getByText("Anna Nowak")).toBeTruthy();
  });

  it("pseudonim wygrywa z nazwą profilu", () => {
    renderItem({ nicknames: new Map([[CHAT_IDS.peer, "Ania z DG ENER"]]) });
    expect(screen.getByText("Ania z DG ENER")).toBeTruthy();
  });

  it("krąg pokazuje tytuł, a nie nazwę pierwszego członka", () => {
    renderItem({ view: groupConversationView() });
    expect(screen.getByText("Krąg energetyczny")).toBeTruthy();
    expect(screen.queryByText("Anna Nowak")).toBeNull();
  });

  it("woła otwarcie rozmowy na kliknięciu całego wiersza", () => {
    const onOpen = vi.fn();
    renderItem({ onOpen });
    fireEvent.click(screen.getByRole("button"));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});

describe("podgląd ostatniej wiadomości", () => {
  it("tekst pokazuje wprost", () => {
    renderItem({
      view: conversationView({
        conversation: { last_message_kind: "text", last_message_preview: "Widzimy się w Brukseli" },
      }),
    });
    expect(screen.getByText("Widzimy się w Brukseli")).toBeTruthy();
  });

  it("załączniki i notatka głosowa mają etykiety rodzaju, nie surowy podgląd", () => {
    for (const [kind, label] of [
      ["image", chatPl.chat.photo],
      ["file", chatPl.chat.file],
      ["audio", chatPl.chat.voice.message],
      ["deleted", chatPl.chat.deletedMessage],
    ] as const) {
      const { unmount } = renderItem({
        view: conversationView({
          conversation: {
            last_message_kind: kind,
            last_message_preview: "nie-pokazuj-tego",
            last_message_sender: CHAT_IDS.peer,
          },
        }),
      });
      expect(screen.getByText(label)).toBeTruthy();
      expect(screen.queryByText("nie-pokazuj-tego")).toBeNull();
      unmount();
    }
  });

  it("własna wiadomość dostaje prefiks z etykietą wołającego", () => {
    renderItem({
      view: conversationView({
        conversation: {
          last_message_kind: "text",
          last_message_preview: "Do zobaczenia",
          last_message_sender: CHAT_IDS.me,
        },
      }),
    });
    expect(screen.getByText(`${chatPl.chat.you}: Do zobaczenia`)).toBeTruthy();
  });

  it("w kręgu podgląd prefiksuje nazwą nadawcy", () => {
    renderItem({
      view: groupConversationView({
        conversation: {
          last_message_kind: "text",
          last_message_preview: "Mam projekt stanowiska",
          last_message_sender: CHAT_IDS.peerTwo,
        },
      }),
      profiles: peerProfileMap([
        peerProfile(),
        peerProfile({ id: CHAT_IDS.peerTwo, display_name: "Marek Kowalski" }),
      ]),
    });
    expect(screen.getByText("Marek Kowalski: Mam projekt stanowiska")).toBeTruthy();
  });

  it("w kręgu pseudonim nadawcy bije jego nazwę profilu", () => {
    renderItem({
      view: groupConversationView({
        conversation: {
          last_message_kind: "text",
          last_message_preview: "Mam projekt",
          last_message_sender: CHAT_IDS.peerTwo,
        },
      }),
      profiles: peerProfileMap([
        peerProfile({ id: CHAT_IDS.peerTwo, display_name: "Marek Kowalski" }),
      ]),
      nicknames: new Map([[CHAT_IDS.peerTwo, "Marek z RE"]]),
    });
    expect(screen.getByText("Marek z RE: Mam projekt")).toBeTruthy();
  });

  it("pusta rozmowa mówi wprost, że to początek wymiany", () => {
    renderItem({
      view: conversationView({
        conversation: { last_message_kind: null, last_message_preview: null },
      }),
    });
    expect(screen.getByText(chatPl.chat.conversationEmpty)).toBeTruthy();
  });
});

describe("wersja robocza w toku", () => {
  it("BIJE podgląd ostatniej wiadomości (semantyka WhatsAppa)", () => {
    setDraft(CHAT_IDS.me, CHAT_IDS.conversation, "zaczęta odpowiedź");
    renderItem({
      view: conversationView({
        conversation: { last_message_kind: "text", last_message_preview: "stary podgląd" },
      }),
    });
    expect(screen.getByText(chatPl.chat.draftLabel)).toBeTruthy();
    expect(screen.getByText("zaczęta odpowiedź")).toBeTruthy();
    expect(screen.queryByText("stary podgląd")).toBeNull();
  });

  it("NIE pokazuje wersji roboczej w AKTYWNYM wątku - kompozytor już ją ma", () => {
    setDraft(CHAT_IDS.me, CHAT_IDS.conversation, "zaczęta odpowiedź");
    renderItem({ active: true });
    expect(screen.queryByText(chatPl.chat.draftLabel)).toBeNull();
  });

  it("wersja robocza z samych białych znaków nie liczy się jako wersja robocza", () => {
    setDraft(CHAT_IDS.me, CHAT_IDS.conversation, "   ");
    renderItem();
    expect(screen.queryByText(chatPl.chat.draftLabel)).toBeNull();
  });

  it("wersja robocza INNEGO użytkownika nie przecieka do tego wiersza", () => {
    setDraft(CHAT_IDS.peer, CHAT_IDS.conversation, "cudza notatka");
    renderItem();
    expect(screen.queryByText("cudza notatka")).toBeNull();
  });
});

describe("potwierdzenia ✓/✓✓ przy własnej ostatniej wiadomości", () => {
  const ownLast = (peers: ReturnType<typeof participantRow>[]) =>
    conversationView({
      conversation: {
        last_message_kind: "text",
        last_message_preview: "Wysłane",
        last_message_sender: CHAT_IDS.me,
        last_message_at: isoOffset(-5),
      },
      peers,
    });

  it("bez stanu rozmówcy: jeden ptaszek (wysłane)", () => {
    renderItem({ view: ownLast([participantRow({ user_id: CHAT_IDS.peer })]) });
    expect(screen.getByLabelText(chatPl.chat.receipt.sent)).toBeTruthy();
  });

  it("doręczone: dwa szare ptaszki", () => {
    renderItem({
      view: ownLast([participantRow({ user_id: CHAT_IDS.peer, last_delivered_at: isoOffset(-4) })]),
    });
    expect(screen.getByLabelText(chatPl.chat.receipt.delivered)).toBeTruthy();
  });

  it("przeczytane: dwa ptaszki w kolorze marki", () => {
    renderItem({
      view: ownLast([
        participantRow({
          user_id: CHAT_IDS.peer,
          last_delivered_at: isoOffset(-4),
          last_read_at: isoOffset(-3),
        }),
      ]),
    });
    expect(screen.getByLabelText(chatPl.chat.receipt.read)).toBeTruthy();
  });

  it("w kręgu przeczytane wymaga WSZYSTKICH - jeden bez odczytu cofa do doręczonego", () => {
    renderItem({
      view: groupConversationView({
        conversation: {
          last_message_kind: "text",
          last_message_preview: "Wysłane",
          last_message_sender: CHAT_IDS.me,
          last_message_at: isoOffset(-5),
        },
        peers: [
          participantRow({
            user_id: CHAT_IDS.peer,
            last_delivered_at: isoOffset(-4),
            last_read_at: isoOffset(-3),
          }),
          participantRow({ user_id: CHAT_IDS.peerTwo, last_delivered_at: isoOffset(-4) }),
        ],
      }),
    });
    expect(screen.queryByLabelText(chatPl.chat.receipt.read)).toBeNull();
    expect(screen.getByLabelText(chatPl.chat.receipt.delivered)).toBeTruthy();
  });

  it("CUDZA ostatnia wiadomość nie dostaje ptaszków (nie ma czego potwierdzać)", () => {
    renderItem({
      view: conversationView({
        conversation: {
          last_message_kind: "text",
          last_message_preview: "Od rozmówcy",
          last_message_sender: CHAT_IDS.peer,
          last_message_at: isoOffset(-5),
        },
        peers: [participantRow({ user_id: CHAT_IDS.peer, last_read_at: isoOffset(-1) })],
      }),
    });
    expect(screen.queryByLabelText(chatPl.chat.receipt.sent)).toBeNull();
    expect(screen.queryByLabelText(chatPl.chat.receipt.read)).toBeNull();
  });

  it("cofnięta własna wiadomość (tombstone) nie dostaje ptaszków", () => {
    renderItem({
      view: conversationView({
        conversation: {
          last_message_kind: "deleted",
          last_message_preview: null,
          last_message_sender: CHAT_IDS.me,
          last_message_at: isoOffset(-5),
        },
        peers: [participantRow({ user_id: CHAT_IDS.peer, last_read_at: isoOffset(-1) })],
      }),
    });
    expect(screen.queryByLabelText(chatPl.chat.receipt.read)).toBeNull();
  });
});

describe("plakietki i licznik", () => {
  it("wyciszenie i przypięcie mają etykiety dostępne", () => {
    renderItem({
      view: conversationView({ me: { muted_until: "infinity", pinned_at: isoOffset(-1) } }),
    });
    expect(screen.getByLabelText(chatPl.chat.menu.mutedBadge)).toBeTruthy();
    expect(screen.getByLabelText(chatPl.chat.menu.pinnedBadge)).toBeTruthy();
  });

  it("wygasłe wyciszenie NIE pokazuje plakietki", () => {
    renderItem({ view: conversationView({ me: { muted_until: isoOffset(-60) } }) });
    expect(screen.queryByLabelText(chatPl.chat.menu.mutedBadge)).toBeNull();
  });

  it("licznik nieprzeczytanych pokazuje liczbę i etykietę", () => {
    renderItem({ view: conversationView({ me: { unread_count: 7 } }) });
    expect(screen.getByText("7")).toBeTruthy();
  });

  it("licznik powyżej 99 skraca się do 99+, żeby nie rozpychać wiersza", () => {
    renderItem({ view: conversationView({ me: { unread_count: 128 } }) });
    expect(screen.getByText("99+")).toBeTruthy();
  });

  it("zero nieprzeczytanych nie renderuje licznika", () => {
    renderItem({ view: conversationView({ me: { unread_count: 0 } }) });
    expect(screen.queryByText("0")).toBeNull();
  });

  it("presence rozmówcy zapala kropkę, krąg jej nie dostaje", () => {
    const direct = renderItem({ onlineUsers: new Set([CHAT_IDS.peer]) });
    expect(direct.container.querySelectorAll("span.bg-emerald-500")).toHaveLength(1);
    cleanup();

    const group = renderItem({
      view: groupConversationView(),
      onlineUsers: new Set([CHAT_IDS.peer, CHAT_IDS.peerTwo]),
    });
    expect(group.container.querySelectorAll("span.bg-emerald-500")).toHaveLength(0);
  });

  it("brak daty ostatniej wiadomości nie renderuje znacznika czasu", () => {
    const { container } = renderItem({
      view: conversationView({ conversation: { last_message_at: null } }),
    });
    expect(container.querySelector("span.text-\\[10px\\]")).toBeNull();
  });
});
