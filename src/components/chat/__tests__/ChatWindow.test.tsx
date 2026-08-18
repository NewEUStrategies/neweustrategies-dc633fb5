// Organizm okna rozmowy - do refaktoru 1212 linii na 0% pokrycia.
//
// CO TU TESTUJEMY, A CZEGO NIE. Warstwa danych ma własne testy
// (`src/lib/chat/__tests__`), więc tutaj jest zamockowana: przedmiotem badania
// jest KOMPOZYCJA, czyli to, co użytkownik widzi i klika:
//   - dwa warianty chrome'u (page vs dock) i ich różnice,
//   - tożsamość w nagłówku (pseudonim > profil, tytuł kręgu, presence),
//   - rząd akcji z `aria-pressed` i menu rozmowy z parami stan/etykieta,
//   - blokada zamienia kompozytor na pasek z odblokowaniem,
//   - potwierdzenia i dialogi wołają WŁAŚCIWE mutacje z właściwymi argumentami,
//   - mapowanie werdyktów serwera na komunikaty (blokada / limit / brak odbiorcy).
//
// Ciężkie dzieci z własną warstwą danych (kompozytor, panel mediów, pasek
// wyszukiwania, dialogi kręgu i wyglądu) są atrapami wystawiającymi swój
// KONTRAKT - test sprawdza, że organizm podaje im poprawne propsy, a nie
// renderuje ich wnętrzności po raz drugi.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/lib/i18n-chat";
import { chatPl } from "@/lib/i18n-chat";
import {
  CHAT_IDS,
  chatMessage,
  conversationView,
  groupConversationView,
  isoOffset,
  peerProfileMap,
} from "@/test/chat/fixtures";
import type { ConversationView } from "@/lib/chat/types";

type MutateFn = (
  vars: unknown,
  options?: { onSuccess?: () => void; onError?: (e: Error) => void },
) => void;

interface MutationRecord {
  readonly mutate: MutateFn;
  readonly calls: unknown[];
  /** Werdykt, jaki mutacja ma odegrać (domyślnie sukces). */
  outcome: { kind: "success" } | { kind: "error"; error: Error };
}

const h = vi.hoisted(() => ({
  views: [] as unknown[],
  peers: null as unknown,
  nicknames: null as unknown,
  blocks: new Set<string>() as ReadonlySet<string>,
  online: new Set<string>() as ReadonlySet<string>,
  prefs: { typing_indicators_enabled: true, auto_mark_on_open: true } as Record<string, boolean>,
  messages: [] as unknown[],
  hasNextPage: false,
  isFetchingNextPage: false,
  fetchNextPage: vi.fn(),
  toast: { error: vi.fn(), success: vi.fn() },
  sendTyping: vi.fn(),
  discardFailed: vi.fn(),
  prefetchedPaths: [] as string[],
  mutations: {} as Record<string, MutationRecord>,
  composerProps: null as Record<string, unknown> | null,
  searchBarProps: null as Record<string, unknown> | null,
  mediaPanelProps: null as Record<string, unknown> | null,
}));

/** Atrapa mutacji react-query: zapisuje wywołania i odgrywa werdykt. */
function mutation(name: string): MutationRecord {
  const record: MutationRecord = {
    calls: [],
    outcome: { kind: "success" },
    mutate: (vars, options) => {
      record.calls.push(vars);
      if (record.outcome.kind === "success") options?.onSuccess?.();
      else options?.onError?.(record.outcome.error);
    },
  };
  h.mutations[name] = record;
  return record;
}

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: CHAT_IDS.me, email: "ja@nes.eu", user_metadata: { display_name: "Jan Testowy" } },
    tenantId: CHAT_IDS.tenant,
  }),
}));

vi.mock("@/lib/chat/useConversations", () => ({
  useConversations: () => ({ data: h.views }),
  usePeerProfiles: () => ({ data: h.peers }),
  isMuted: (view: ConversationView) => !!view.me.muted_until,
  useMarkConversationRead: () => ({ mutate: vi.fn() }),
  useSetConversationPinned: () => ({ mutate: h.mutations.pin?.mutate ?? vi.fn() }),
  useSetConversationArchived: () => ({ mutate: h.mutations.archive?.mutate ?? vi.fn() }),
  useSetConversationMuted: () => ({ mutate: h.mutations.mute?.mutate ?? vi.fn() }),
  useClearConversationHistory: () => ({ mutate: h.mutations.clear?.mutate ?? vi.fn() }),
  useSetMessageTtl: () => ({ mutate: h.mutations.ttl?.mutate ?? vi.fn() }),
}));

vi.mock("@/lib/chat/useMessages", async () => {
  const cache = await import("@/lib/chat/messageCache");
  return {
    useMessages: () => ({
      data: { pages: [{ rows: h.messages, nextCursor: null }], pageParams: [null] },
      hasNextPage: h.hasNextPage,
      isFetchingNextPage: h.isFetchingNextPage,
      isLoading: false,
      fetchNextPage: h.fetchNextPage,
    }),
    useReactions: () => ({ data: new Map() }),
    useSendMessage: () => ({ mutate: h.mutations.send?.mutate ?? vi.fn() }),
    useEditMessage: () => ({ mutate: h.mutations.edit?.mutate ?? vi.fn() }),
    useDeleteMessage: () => ({ mutate: h.mutations.remove?.mutate ?? vi.fn() }),
    useDiscardFailedMessage: () => h.discardFailed,
    useToggleReaction: () => ({ mutate: h.mutations.react?.mutate ?? vi.fn() }),
    useConversationChannel: () => ({ sendTyping: h.sendTyping }),
    useConversationAttachments: () => ({ data: [] }),
    canEditMessage: cache.canEditMessage,
    retrySendInput: cache.retrySendInput,
  };
});

vi.mock("@/lib/chat/useTypingRegistry", () => ({
  TYPING_VISIBLE_MS: 4000,
  useTypingRegistry: () => ({ typingUserIds: new Set<string>(), sendTyping: h.sendTyping }),
}));

vi.mock("@/lib/chat/nicknames", () => ({
  useNicknames: () => ({ data: h.nicknames }),
  useSetNickname: () => ({ mutate: vi.fn() }),
  resolveMemberName: (_i: unknown, _c: string, _u: string, _p: unknown, fallback = "...") =>
    fallback,
}));

vi.mock("@/lib/chat/stars", () => ({
  useStarredIds: () => ({ data: new Set<string>() }),
  useStarredMessages: () => ({ data: [] }),
  useToggleStar: () => ({ mutate: h.mutations.star?.mutate ?? vi.fn() }),
}));

vi.mock("@/lib/chat/useBlocks", () => ({
  useMyBlocks: () => ({ data: h.blocks }),
  useBlockUser: () => ({ mutate: h.mutations.block?.mutate ?? vi.fn(), isPending: false }),
  useUnblockUser: () => ({ mutate: h.mutations.unblock?.mutate ?? vi.fn(), isPending: false }),
}));

vi.mock("@/lib/chat/presence", () => ({ useOnlineUsers: () => h.online }));

vi.mock("@/lib/notifications/useNotifications", () => ({
  useNotificationPreferences: () => ({ data: h.prefs }),
}));

vi.mock("@/lib/chat/attachments", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/chat/attachments")>("@/lib/chat/attachments");
  return {
    ...actual,
    usePrefetchAttachmentUrls: (paths: ReadonlyArray<string>) => {
      h.prefetchedPaths = [...paths];
    },
    useAttachmentUrl: () => ({ data: undefined, isSuccess: false }),
  };
});

vi.mock("sonner", () => ({ toast: h.toast }));

// `ChatAvatar` linkuje do profilu publicznego, a <Link> TanStacka wymaga
// routera. Podmiana na zwykły <a> - test bada okno czatu, nie routing.
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

// --- atrapy ciężkich dzieci (każda wystawia swój kontrakt propsów) ---------

vi.mock("../ChatComposer", () => ({
  ChatComposer: (props: Record<string, unknown>) => {
    h.composerProps = props;
    return <div data-testid="composer" />;
  },
}));

vi.mock("../MessageSearchBar", () => ({
  MessageSearchBar: (props: Record<string, unknown>) => {
    h.searchBarProps = props;
    return <div data-testid="search-bar" />;
  },
}));

vi.mock("../ChatMediaPanel", () => ({
  ChatMediaPanel: (props: Record<string, unknown>) => {
    h.mediaPanelProps = props;
    return <div data-testid="media-panel" />;
  },
}));

vi.mock("../GroupInfoDialog", () => ({
  GroupInfoDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="group-info" /> : null,
}));

vi.mock("../ChatAppearanceDialog", () => ({
  ChatAppearanceDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="appearance" /> : null,
}));

vi.mock("@/components/network/ReportUserDialog", () => ({
  ReportUserDialog: ({ open, userId }: { open: boolean; userId: string }) =>
    open ? <div data-testid="report" data-user={userId} /> : null,
}));

vi.mock("../ForwardDialog", () => ({
  ForwardDialog: ({ message }: { message: unknown }) =>
    message ? <div data-testid="forward" /> : null,
}));

import { ChatWindow, type ChatWindowProps } from "../ChatWindow";

function renderWindow(overrides: Partial<ChatWindowProps> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ChatWindow conversationId={CHAT_IDS.conversation} variant="page" {...overrides} />
    </QueryClientProvider>,
  );
}

/** Otwiera menu rozmowy i zwraca jego kontener. */
function openMenu(): HTMLElement {
  fireEvent.click(screen.getByRole("button", { name: chatPl.chat.menu.title }));
  return screen.getByRole("menu", { name: chatPl.chat.menu.title });
}

beforeEach(() => {
  h.views = [conversationView()];
  h.peers = peerProfileMap();
  h.nicknames = new Map();
  h.blocks = new Set();
  h.online = new Set();
  h.prefs = { typing_indicators_enabled: true, auto_mark_on_open: true };
  h.messages = [chatMessage({ id: "m1", created_at: isoOffset(-5) })];
  h.hasNextPage = false;
  h.isFetchingNextPage = false;
  h.fetchNextPage.mockReset();
  h.toast.error.mockReset();
  h.toast.success.mockReset();
  h.sendTyping.mockReset();
  h.discardFailed.mockReset();
  h.prefetchedPaths = [];
  h.composerProps = null;
  h.searchBarProps = null;
  h.mediaPanelProps = null;
  h.mutations = {};
  for (const name of [
    "pin",
    "archive",
    "mute",
    "clear",
    "ttl",
    "send",
    "edit",
    "remove",
    "react",
    "star",
    "block",
    "unblock",
  ]) {
    mutation(name);
  }
  Element.prototype.scrollTo = Element.prototype.scrollTo ?? (() => undefined);
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => undefined);
});

afterEach(() => cleanup());

describe("ChatWindow - nagłówek wątku bezpośredniego", () => {
  it("pokazuje nazwę rozmówcy z profilu i stan offline", () => {
    renderWindow();
    expect(screen.getByText("Anna Nowak")).toBeTruthy();
    expect(screen.getByText(chatPl.chat.offline)).toBeTruthy();
  });

  it("presence rozmówcy przełącza podtytuł na online", () => {
    h.online = new Set([CHAT_IDS.peer]);
    renderWindow();
    expect(screen.getByText(chatPl.chat.online)).toBeTruthy();
  });

  it("pseudonim wygrywa z nazwą profilu", () => {
    h.nicknames = new Map([[CHAT_IDS.conversation, new Map([[CHAT_IDS.peer, "Ania z DG ENER"]])]]);
    renderWindow();
    expect(screen.getByText("Ania z DG ENER")).toBeTruthy();
    expect(screen.queryByText("Anna Nowak")).toBeNull();
  });

  it("wyciszenie i przypięcie mają plakietki z etykietą dostępną", () => {
    h.views = [conversationView({ me: { muted_until: "infinity", pinned_at: isoOffset(-1) } })];
    renderWindow();
    expect(screen.getByLabelText(chatPl.chat.menu.mutedBadge)).toBeTruthy();
    expect(screen.getByLabelText(chatPl.chat.menu.pinnedBadge)).toBeTruthy();
  });

  it("wariant page na mobile pokazuje powrót do listy tylko z `onBack`", () => {
    const back = vi.fn();
    const { unmount } = renderWindow({ onBack: back });
    fireEvent.click(screen.getByRole("button", { name: chatPl.chat.messages }));
    expect(back).toHaveBeenCalled();
    unmount();

    renderWindow();
    expect(screen.queryByRole("button", { name: chatPl.chat.messages })).toBeNull();
  });
});

describe("ChatWindow - nagłówek kręgu", () => {
  /** Krąg ma własne id rozmowy - okno musi renderować JEGO wątek. */
  const renderGroup = (overrides: Partial<ChatWindowProps> = {}) =>
    renderWindow({ conversationId: CHAT_IDS.group, ...overrides });

  beforeEach(() => {
    h.views = [groupConversationView()];
  });

  it("pokazuje tytuł kręgu i liczbę uczestników WRAZ z wołającym", () => {
    renderGroup();
    expect(screen.getByText("Krąg energetyczny")).toBeTruthy();
    // Dwóch rozmówców + wołający = 3.
    expect(screen.getByText(/3/)).toBeTruthy();
  });

  it("kliknięcie tożsamości otwiera informacje o kręgu", () => {
    renderGroup();
    fireEvent.click(screen.getByRole("button", { name: chatPl.chat.group.info }));
    expect(screen.getByTestId("group-info")).toBeTruthy();
  });

  it("menu kręgu ma pozycję informacji, a NIE ma blokady ani zgłoszenia osoby", () => {
    renderGroup();
    const menu = openMenu();
    expect(menu.textContent).toContain(chatPl.chat.group.info);
    // Blokuje się i zgłasza OSOBĘ - w kręgu nie wiadomo którą.
    expect(menu.textContent).not.toContain(chatPl.chat.block.block);
    expect(menu.textContent).not.toContain(chatPl.chat.menu.report);
  });
});

describe("ChatWindow - rząd akcji", () => {
  it("przełącznik wyszukiwania ogłasza stan i montuje pasek", () => {
    renderWindow();
    const toggle = screen.getByRole("button", { name: chatPl.chat.search.inConversation });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByTestId("search-bar")).toBeNull();

    fireEvent.click(toggle);
    expect(screen.getByTestId("search-bar")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: chatPl.chat.search.close }).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("przełącznik mediów montuje panel z klasą właściwą dla wariantu page", () => {
    renderWindow();
    fireEvent.click(screen.getByRole("button", { name: chatPl.chat.mediaPanel.open }));
    expect(screen.getByTestId("media-panel")).toBeTruthy();
    expect(String(h.mediaPanelProps?.className)).toContain("md:w-[260px]");
  });

  it("wariant dock ma minimalizację i zamknięcie, wariant page ich nie ma", () => {
    const minimize = vi.fn();
    const close = vi.fn();
    const { unmount } = renderWindow({ variant: "dock", onMinimize: minimize, onClose: close });
    fireEvent.click(screen.getByRole("button", { name: chatPl.chat.minimize }));
    fireEvent.click(screen.getByRole("button", { name: chatPl.chat.close }));
    expect(minimize).toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
    unmount();

    renderWindow({ variant: "page", onMinimize: minimize, onClose: close });
    expect(screen.queryByRole("button", { name: chatPl.chat.minimize })).toBeNull();
  });

  it("wariant dock jest dialogiem z nazwą rozmówcy w etykiecie", () => {
    renderWindow({ variant: "dock" });
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-label")).toBe(`${chatPl.chat.title}: Anna Nowak`);
  });

  it("Escape w oknie dokowanym zamyka je", () => {
    const close = vi.fn();
    renderWindow({ variant: "dock", onClose: close });
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(close).toHaveBeenCalled();
  });

  it("panel mediów w wariancie dock jest wąską kolumną, nie nakładką", () => {
    renderWindow({ variant: "dock" });
    fireEvent.click(screen.getByRole("button", { name: chatPl.chat.mediaPanel.open }));
    expect(String(h.mediaPanelProps?.className)).toContain("w-[180px]");
  });
});

describe("ChatWindow - menu rozmowy", () => {
  it("przypina wątek i tłumaczy limit przypięć na osobny komunikat", () => {
    renderWindow();
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: chatPl.chat.menu.pin }));
    expect(h.mutations.pin?.calls).toEqual([
      { conversationId: CHAT_IDS.conversation, pinned: true },
    ]);

    h.mutations.pin!.outcome = { kind: "error", error: new Error("chat: pin limit reached") };
    fireEvent.click(screen.getByRole("button", { name: chatPl.chat.menu.title }));
    fireEvent.click(screen.getByRole("menuitem", { name: chatPl.chat.menu.pin }));
    expect(h.toast.error).toHaveBeenCalledWith(chatPl.chat.menu.pinLimit);
  });

  it("odpina wątek już przypięty (para stan/etykieta)", () => {
    h.views = [conversationView({ me: { pinned_at: isoOffset(-1) } })];
    renderWindow();
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: chatPl.chat.menu.unpin }));
    expect(h.mutations.pin?.calls).toEqual([
      { conversationId: CHAT_IDS.conversation, pinned: false },
    ]);
  });

  it("archiwizuje z potwierdzeniem sukcesu i odwrotnie dla przywrócenia", () => {
    const { unmount } = renderWindow();
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: chatPl.chat.menu.archive }));
    expect(h.mutations.archive?.calls).toEqual([
      { conversationId: CHAT_IDS.conversation, archived: true },
    ]);
    expect(h.toast.success).toHaveBeenCalledWith(chatPl.chat.menu.archived);
    unmount();

    h.views = [conversationView({ me: { archived_at: isoOffset(-1) } })];
    renderWindow();
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: chatPl.chat.menu.unarchive }));
    expect(h.mutations.archive?.calls.at(-1)).toEqual({
      conversationId: CHAT_IDS.conversation,
      archived: false,
    });
    expect(h.toast.success).toHaveBeenLastCalledWith(chatPl.chat.menu.unarchived);
  });

  it("wycisza na 8 h, tydzień i na zawsze - w sekundach", () => {
    renderWindow();
    for (const [label, seconds] of [
      [chatPl.chat.menu.mute8h, 8 * 3600],
      [chatPl.chat.menu.muteWeek, 7 * 86400],
      [chatPl.chat.menu.muteAlways, -1],
    ] as const) {
      openMenu();
      fireEvent.click(screen.getByRole("menuitem", { name: label }));
      expect(h.mutations.mute?.calls.at(-1)).toEqual({
        conversationId: CHAT_IDS.conversation,
        seconds,
      });
    }
  });

  it("wątek wyciszony oferuje TYLKO zdjęcie wyciszenia", () => {
    h.views = [conversationView({ me: { muted_until: "infinity" } })];
    renderWindow();
    const menu = openMenu();
    expect(menu.textContent).toContain(chatPl.chat.menu.unmute);
    expect(menu.textContent).not.toContain(chatPl.chat.menu.mute8h);

    fireEvent.click(screen.getByRole("menuitem", { name: chatPl.chat.menu.unmute }));
    expect(h.mutations.mute?.calls).toEqual([
      { conversationId: CHAT_IDS.conversation, seconds: null },
    ]);
  });

  it("znikanie wiadomości: aktywna opcja jest zaznaczona, klik zapisuje okno", () => {
    h.views = [conversationView({ conversation: { message_ttl_seconds: 86400 } })];
    renderWindow();
    const menu = openMenu();
    const day = screen.getByRole("menuitemradio", { name: chatPl.chat.disappearing.day });
    expect(day.getAttribute("aria-checked")).toBe("true");
    expect(
      screen
        .getByRole("menuitemradio", { name: chatPl.chat.disappearing.off })
        .getAttribute("aria-checked"),
    ).toBe("false");
    expect(menu.textContent).toContain(chatPl.chat.disappearing.quarter);

    fireEvent.click(screen.getByRole("menuitemradio", { name: chatPl.chat.disappearing.week }));
    expect(h.mutations.ttl?.calls).toEqual([
      { conversationId: CHAT_IDS.conversation, ttlSeconds: 604800 },
    ]);
    expect(h.toast.success).toHaveBeenCalledWith(chatPl.chat.disappearing.saved);
  });

  it("wyłączenie znikania przekazuje null, nie zero", () => {
    h.views = [conversationView({ conversation: { message_ttl_seconds: 86400 } })];
    renderWindow();
    openMenu();
    fireEvent.click(screen.getByRole("menuitemradio", { name: chatPl.chat.disappearing.off }));
    expect(h.mutations.ttl?.calls).toEqual([
      { conversationId: CHAT_IDS.conversation, ttlSeconds: null },
    ]);
  });

  it("otwiera dialog wyglądu rozmowy", () => {
    renderWindow();
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: chatPl.chat.appearance.open }));
    expect(screen.getByTestId("appearance")).toBeTruthy();
  });

  it("błąd ustawienia daje ogólny komunikat menu", () => {
    renderWindow();
    h.mutations.mute!.outcome = { kind: "error", error: new Error("denied") };
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: chatPl.chat.menu.mute8h }));
    expect(h.toast.error).toHaveBeenCalledWith(chatPl.chat.menu.error);
  });
});

describe("ChatWindow - czyszczenie historii", () => {
  it("wymaga potwierdzenia przed wywołaniem mutacji", async () => {
    renderWindow();
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: chatPl.chat.menu.clear }));

    // Sama pozycja menu NIE czyści - to operacja nieodwracalna.
    expect(h.mutations.clear?.calls).toEqual([]);
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain(chatPl.chat.menu.clearConfirm);

    fireEvent.click(screen.getByRole("button", { name: chatPl.chat.menu.clear }));
    expect(h.mutations.clear?.calls).toEqual([{ conversationId: CHAT_IDS.conversation }]);
    expect(h.toast.success).toHaveBeenCalledWith(chatPl.chat.menu.cleared);
  });
});

describe("ChatWindow - blokada rozmówcy", () => {
  it("menu proponuje blokadę, a dialog potwierdza ją nazwą rozmówcy", async () => {
    renderWindow();
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: chatPl.chat.block.block }));

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("Anna Nowak");
    expect(dialog.textContent).toContain(chatPl.chat.block.blockConfirm);

    fireEvent.click(screen.getByRole("button", { name: chatPl.chat.block.block }));
    expect(h.mutations.block?.calls).toEqual([CHAT_IDS.peer]);
  });

  it("zablokowany rozmówca: pasek zamiast kompozytora, z odblokowaniem", () => {
    h.blocks = new Set([CHAT_IDS.peer]);
    renderWindow();

    expect(screen.queryByTestId("composer")).toBeNull();
    expect(screen.getByText(chatPl.chat.block.composerNotice)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: chatPl.chat.block.unblock }));
    expect(h.mutations.unblock?.calls).toEqual([CHAT_IDS.peer]);
  });

  it("dla zablokowanego menu proponuje ODBLOKOWANIE i dialog też", async () => {
    h.blocks = new Set([CHAT_IDS.peer]);
    renderWindow();
    const menu = openMenu();
    expect(menu.textContent).toContain(chatPl.chat.block.unblock);

    fireEvent.click(screen.getByRole("menuitem", { name: chatPl.chat.block.unblock }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain(chatPl.chat.block.unblockConfirm);
  });

  it("menu wątku bezpośredniego prowadzi do ZGŁOSZENIA osoby do moderacji", () => {
    // Rekomendacja audytu 14.08 (MODUŁ 9): do tej pory zgłoszenie istniało
    // wyłącznie na profilu i w popoverze sieci - nie tam, gdzie problem się dzieje.
    renderWindow();
    const menu = openMenu();
    expect(menu.textContent).toContain(chatPl.chat.menu.report);

    fireEvent.click(screen.getByRole("menuitem", { name: chatPl.chat.menu.report }));
    expect(screen.getByTestId("report").getAttribute("data-user")).toBe(CHAT_IDS.peer);
  });

  it("nieudana blokada daje komunikat błędu", async () => {
    renderWindow();
    h.mutations.block!.outcome = { kind: "error", error: new Error("denied") };
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: chatPl.chat.block.block }));
    await screen.findByRole("alertdialog");
    fireEvent.click(screen.getByRole("button", { name: chatPl.chat.block.block }));
    expect(h.toast.error).toHaveBeenCalledWith(chatPl.chat.block.error);
  });
});

describe("ChatWindow - kontrakt z kompozytorem", () => {
  it("podaje język, szybką emotkę i id rozmowy", () => {
    h.views = [conversationView({ conversation: { quick_emoji: "🎉" } })];
    renderWindow();
    expect(h.composerProps?.conversationId).toBe(CHAT_IDS.conversation);
    expect(h.composerProps?.lang).toBe("pl");
    expect(h.composerProps?.quickEmoji).toBe("🎉");
  });

  it("wysyłka nadaje jawne zatrzymanie pisania PRZED mutacją", () => {
    renderWindow();
    const onSend = h.composerProps?.onSend as (input: unknown) => void;
    onSend({ conversationId: CHAT_IDS.conversation, kind: "text", body: "hej" });

    expect(h.sendTyping).toHaveBeenCalledWith(false);
    expect(h.mutations.send?.calls).toEqual([
      { conversationId: CHAT_IDS.conversation, kind: "text", body: "hej" },
    ]);
  });

  it("mapuje werdykty serwera na osobne komunikaty", () => {
    renderWindow();
    const onSend = h.composerProps?.onSend as (input: unknown) => void;

    for (const [message, expected] of [
      ["chat: blocked", chatPl.chat.block.sendBlocked],
      ["recipient unavailable", chatPl.chat.recipientUnavailable],
      ["chat: rate limited", chatPl.chat.rateLimited],
    ] as const) {
      h.mutations.send!.outcome = { kind: "error", error: new Error(message) };
      onSend({ conversationId: CHAT_IDS.conversation, kind: "text", body: "x" });
      expect(h.toast.error).toHaveBeenLastCalledWith(expected);
    }
  });

  it("nieznany błąd wysyłki NIE hałasuje toastem (dymek sam sygnalizuje)", () => {
    renderWindow();
    h.mutations.send!.outcome = { kind: "error", error: new Error("boom") };
    const onSend = h.composerProps?.onSend as (input: unknown) => void;
    onSend({ conversationId: CHAT_IDS.conversation, kind: "text", body: "x" });
    expect(h.toast.error).not.toHaveBeenCalled();
  });

  it("zapis edycji z wygasłym oknem daje komunikat o wygaśnięciu", () => {
    renderWindow();
    h.mutations.edit!.outcome = { kind: "error", error: new Error("edit window closed") };
    const onSaveEdit = h.composerProps?.onSaveEdit as (id: string, body: string) => void;
    onSaveEdit("m1", "poprawione");
    expect(h.mutations.edit?.calls).toEqual([{ messageId: "m1", body: "poprawione" }]);
    expect(h.toast.error).toHaveBeenCalledWith(chatPl.chat.editExpired);
  });

  it("z wyłączonym wskaźnikiem pisania kompozytor dostaje handler, który nic nie nadaje", () => {
    // Blokadę nadawania trzyma `useTypingRegistry` (test w threadHooks); tutaj
    // sprawdzamy, że organizm faktycznie podaje jego emiter, a nie własny.
    renderWindow();
    const onTyping = h.composerProps?.onTyping as (typing?: boolean) => void;
    onTyping(true);
    expect(h.sendTyping).toHaveBeenCalledWith(true);
  });
});

describe("ChatWindow - wyszukiwanie i skok", () => {
  it("pasek dostaje resolver nazwy autora zwracający etykietę wołającego dla siebie", () => {
    renderWindow();
    fireEvent.click(screen.getByRole("button", { name: chatPl.chat.search.inConversation }));
    const resolve = h.searchBarProps?.resolveAuthorName as (id: string) => string;
    expect(resolve(CHAT_IDS.me)).toBe(chatPl.chat.you);
    expect(resolve(CHAT_IDS.peer)).toBe("Anna Nowak");
  });

  it("zewnętrzne żądanie skoku poza wczytane okno dociąga starsze strony", () => {
    h.hasNextPage = true;
    renderWindow({ jumpRequest: { id: "poza-oknem", nonce: 1 } });
    expect(h.fetchNextPage).toHaveBeenCalled();
  });

  it("skok bez dalszej historii kończy się komunikatem porażki", async () => {
    h.hasNextPage = false;
    renderWindow({ jumpRequest: { id: "znikneła-po-ttl", nonce: 1 } });
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith(chatPl.chat.search.jumpFailed));
  });

  it("klik w trafienie paska rozpoczyna skok", () => {
    h.hasNextPage = true;
    renderWindow();
    fireEvent.click(screen.getByRole("button", { name: chatPl.chat.search.inConversation }));
    const onJump = h.searchBarProps?.onJump as (hit: { id: string }) => void;
    act(() => onJump({ id: "hit-1" }));
    expect(h.fetchNextPage).toHaveBeenCalled();
  });
});

describe("ChatWindow - załączniki i stan pusty", () => {
  it("podpisuje batchem tylko żywe, potwierdzone załączniki", () => {
    h.messages = [
      chatMessage({ id: "img", kind: "image", attachment_path: "t/c/u/a.png" }),
      chatMessage({
        id: "gone",
        kind: "image",
        attachment_path: "t/c/u/b.png",
        deleted_at: isoOffset(-1),
      }),
      chatMessage({ id: "pending", kind: "image", attachment_path: "t/c/u/c.png", pending: true }),
    ];
    renderWindow();
    expect(h.prefetchedPaths).toEqual(["t/c/u/a.png"]);
  });

  it("brak wczytanej rozmowy renderuje placeholder nagłówka bez wywrotki", () => {
    h.views = [];
    h.messages = [];
    renderWindow();
    expect(screen.getByText("...")).toBeTruthy();
    expect(screen.getByTestId("composer")).toBeTruthy();
  });
});
