// Domknięcia okna rozmowy, których NIE woła żaden inny test.
//
// PO CO TEN PLIK ISTNIEJE. `ChatWindow.test.tsx` bada chrome okna: warianty,
// nagłówek, pozycje menu i mapowanie werdyktów serwera na komunikaty. Zostawia
// jednak nietkniętą całą warstwę INTENCJI PRZEKAZANYCH W DÓŁ - handlery, które
// organizm wręcza `MessageList`, `ChatComposer`, paskowi wyszukiwania, panelowi
// mediów i `ChatWindowDialogs`. Tam mieszkało 26 niepokrytych funkcji, czyli
// dokładnie ten kod, który psuje się cicho: reakcja bez mutacji, gwiazdka na
// wiadomości w locie, ponowienie wysyłające plik drugi raz, dialog, który się
// otwiera i nie chce zamknąć.
//
// PRZEDMIOT DOWODU: każdy handler wywołany Z ATRAPY DZIECKA (tak, jak zrobiłby
// to prawdziwy komponent) woła WŁAŚCIWĄ mutację z WŁAŚCIWYMI argumentami albo
// przestawia WŁAŚCIWY stan okna, a każda warstwa modalna ma drogę powrotną.
//
// ŚWIADOMIE POZA ZAKRESEM (dowody stoją gdzie indziej, nie dublujemy ich):
//   - `onSend`, `onSaveEdit`, `onTyping` i mapowanie błędów wysyłki -
//     `ChatWindow.test.tsx`,
//   - wnętrzności listy, kompozytora, paska i panelu - ich własne pliki,
//   - reguły czyste (`thread`, `useThreadJump`, `messageCache`) - `lib/chat`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/lib/i18n-chat";
import { chatPl } from "@/lib/i18n-chat";
import {
  BASE_ISO,
  CHAT_IDS,
  chatMessage,
  conversationView,
  groupConversationView,
  isoOffset,
  minutesAgo,
  peerProfile,
  peerProfileMap,
} from "@/test/chat/fixtures";
import type { ChatMessage, ConversationView, PeerProfile } from "@/lib/chat/types";
import type { ChatComposerProps } from "../ChatComposer";
import type { MessageListProps } from "../MessageList";
import type { MessageSearchBarProps } from "../MessageSearchBar";

/** Kontrakt panelu mediów widziany przez organizm (`Props` nie jest eksportowany). */
interface MediaPanelStubProps {
  conversationId: string;
  enabled: boolean;
  onClose: () => void;
  className?: string;
}

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
  views: [] as ConversationView[],
  peers: null as ReadonlyMap<string, PeerProfile> | null,
  nicknames: null as ReadonlyMap<string, ReadonlyMap<string, string>> | null,
  blocks: new Set<string>() as ReadonlySet<string>,
  online: new Set<string>() as ReadonlySet<string>,
  prefs: { typing_indicators_enabled: true, auto_mark_on_open: true } as Record<string, boolean>,
  messages: [] as ChatMessage[],
  hasNextPage: false,
  isFetchingNextPage: false,
  typingUserIds: new Set<string>() as ReadonlySet<string>,
  fetchNextPage: vi.fn(),
  toast: { error: vi.fn(), success: vi.fn() },
  sendTyping: vi.fn(),
  discardFailed: vi.fn(),
  mutations: {} as Record<string, MutationRecord>,
  listProps: null as MessageListProps | null,
  composerProps: null as ChatComposerProps | null,
  searchBarProps: null as MessageSearchBarProps | null,
  mediaPanelProps: null as MediaPanelStubProps | null,
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
    user: {
      id: CHAT_IDS.me,
      email: "jan.przykladowy@example.com",
      user_metadata: { display_name: "Jan Przykładowy" },
    },
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
  useTypingRegistry: () => ({ typingUserIds: h.typingUserIds, sendTyping: h.sendTyping }),
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
    usePrefetchAttachmentUrls: () => undefined,
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

// --- atrapy dzieci: każda wystawia swój KONTRAKT, nie swoje wnętrzności -----
// `ChatWindowDialogs` NIE jest atrapą - to jego gałęzie są tu przedmiotem
// dowodu; atrapami są dopiero jego ciężkie dzieci z własną warstwą danych.

vi.mock("../MessageList", () => ({
  MessageList: (props: MessageListProps) => {
    h.listProps = props;
    return <div data-testid="message-list" data-count={props.messages.length} />;
  },
}));

vi.mock("../ChatComposer", () => ({
  ChatComposer: (props: ChatComposerProps) => {
    h.composerProps = props;
    return <div data-testid="composer" />;
  },
}));

vi.mock("../MessageSearchBar", () => ({
  MessageSearchBar: (props: MessageSearchBarProps) => {
    h.searchBarProps = props;
    return <div data-testid="search-bar" />;
  },
}));

vi.mock("../ChatMediaPanel", () => ({
  ChatMediaPanel: (props: MediaPanelStubProps) => {
    h.mediaPanelProps = props;
    return <div data-testid="media-panel" />;
  },
}));

vi.mock("../GroupInfoDialog", () => ({
  GroupInfoDialog: ({
    open,
    onClose,
    onLeft,
  }: {
    open: boolean;
    onClose: () => void;
    onLeft?: () => void;
  }) =>
    open ? (
      <div data-testid="group-info">
        <button type="button" data-testid="group-info-close" onClick={onClose} />
        <button type="button" data-testid="group-info-left" onClick={() => onLeft?.()} />
      </div>
    ) : null,
}));

vi.mock("../ChatAppearanceDialog", () => ({
  ChatAppearanceDialog: ({ open, onClose }: { open: boolean; onClose: () => void }) =>
    open ? (
      <div data-testid="appearance">
        <button type="button" data-testid="appearance-close" onClick={onClose} />
      </div>
    ) : null,
}));

vi.mock("@/components/network/ReportUserDialog", () => ({
  ReportUserDialog: ({ open, userId }: { open: boolean; userId: string }) =>
    open ? <div data-testid="report" data-user={userId} /> : null,
}));

vi.mock("../ForwardDialog", () => ({
  ForwardDialog: ({
    message,
    excludeConversationId,
    onClose,
  }: {
    message: ChatMessage | null;
    excludeConversationId: string;
    onClose: () => void;
  }) =>
    message ? (
      <div data-testid="forward" data-message={message.id} data-exclude={excludeConversationId}>
        <button type="button" data-testid="forward-close" onClick={onClose} />
      </div>
    ) : null,
}));

import { ChatWindow, type ChatWindowProps } from "../ChatWindow";

function renderWindow(overrides: Partial<ChatWindowProps> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (props: Partial<ChatWindowProps>) => (
    <QueryClientProvider client={client}>
      <ChatWindow conversationId={CHAT_IDS.conversation} variant="page" {...props} />
    </QueryClientProvider>
  );
  const result = render(tree(overrides));
  return {
    ...result,
    /** Ponowny render tego samego okna (zmiana propsów / świeża strona historii). */
    show: (next: Partial<ChatWindowProps>) => result.rerender(tree(next)),
  };
}

/** Propsy, które organizm wręczył liście - albo twardy błąd, gdy jej nie ma. */
function listProps(): MessageListProps {
  if (!h.listProps) throw new Error("test: MessageList nie został wyrenderowany");
  return h.listProps;
}

function composerProps(): ChatComposerProps {
  if (!h.composerProps) throw new Error("test: ChatComposer nie został wyrenderowany");
  return h.composerProps;
}

/** Handler opcjonalny w kontrakcie dziecka, ale WYMAGANY od tego organizmu. */
function requireHandler<A extends unknown[]>(
  fn: ((...args: A) => void) | undefined,
  name: string,
): (...args: A) => void {
  if (!fn) throw new Error(`test: organizm nie podał handlera ${name}`);
  return fn;
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
  h.typingUserIds = new Set();
  h.fetchNextPage.mockReset();
  h.toast.error.mockReset();
  h.toast.success.mockReset();
  h.sendTyping.mockReset();
  h.discardFailed.mockReset();
  h.listProps = null;
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

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("ChatWindow - intencje wręczone liście wiadomości", () => {
  it("reakcja z dymka woła mutację z emotką i POPRZEDNIM wyborem", () => {
    renderWindow();
    act(() => listProps().onReact(chatMessage({ id: "m1" }), "👍", null));
    expect(h.mutations.react?.calls).toEqual([{ messageId: "m1", emoji: "👍", current: null }]);

    // Zamiana reakcji niesie stary wybór - serwer musi wiedzieć, co zdjąć.
    act(() => listProps().onReact(chatMessage({ id: "m1" }), "🎉", "👍"));
    expect(h.mutations.react?.calls.at(-1)).toEqual({
      messageId: "m1",
      emoji: "🎉",
      current: "👍",
    });
  });

  it("nieudana reakcja mówi wprost, że jej NIE zapisano", () => {
    renderWindow();
    h.mutations.react!.outcome = { kind: "error", error: new Error("denied") };
    act(() => listProps().onReact(chatMessage({ id: "m1" }), "👍", null));
    expect(h.toast.error).toHaveBeenCalledWith(chatPl.chat.reactions.error);
  });

  it("odpowiedź trafia do kompozytora RAZEM z nazwą autora cytowanej wiadomości", () => {
    renderWindow();
    act(() => listProps().onReply(chatMessage({ id: "m1", sender_id: CHAT_IDS.peer })));
    expect(composerProps().replyTo?.id).toBe("m1");
    expect(composerProps().replyToAuthor).toBe("Anna Nowak");

    // Cytat własnej wiadomości podpisuje się etykietą wołającego, nie nazwiskiem.
    act(() => listProps().onReply(chatMessage({ id: "moja", sender_id: CHAT_IDS.me })));
    expect(composerProps().replyToAuthor).toBe(chatPl.chat.you);
  });

  it("edycja i odpowiedź WYPIERAJĄ się nawzajem - kompozytor ma jeden kontekst", () => {
    renderWindow();
    act(() => listProps().onReply(chatMessage({ id: "cytowana" })));
    act(() => listProps().onEdit(chatMessage({ id: "moja", sender_id: CHAT_IDS.me })));
    expect(composerProps().editing?.id).toBe("moja");
    expect(composerProps().replyTo).toBeNull();

    act(() => listProps().onReply(chatMessage({ id: "cytowana" })));
    expect(composerProps().replyTo?.id).toBe("cytowana");
    expect(composerProps().editing).toBeNull();
  });

  it("`canEdit` otwiera ołówek tylko na WŁASNYM świeżym tekście", () => {
    renderWindow();
    const canEdit = listProps().canEdit;
    expect(
      canEdit(chatMessage({ id: "a", sender_id: CHAT_IDS.me, created_at: minutesAgo(1) })),
    ).toBe(true);
    // Po pięciu minutach okno edycji jest zamknięte.
    expect(
      canEdit(chatMessage({ id: "b", sender_id: CHAT_IDS.me, created_at: minutesAgo(30) })),
    ).toBe(false);
    // Cudzej wiadomości nie edytuje się nigdy.
    expect(
      canEdit(chatMessage({ id: "c", sender_id: CHAT_IDS.peer, created_at: minutesAgo(1) })),
    ).toBe(false);
  });

  it("odrzucenie nieudanej wiadomości zdejmuje DOKŁADNIE ten wiersz", () => {
    renderWindow();
    act(() => listProps().onDiscardFailed(chatMessage({ id: "nieudana", failed: true })));
    expect(h.discardFailed).toHaveBeenCalledWith("nieudana");
  });

  it("ponowienie zdejmuje wiersz i wysyła TEN SAM ładunek, bez przesyłania pliku drugi raz", () => {
    renderWindow();
    const failed = chatMessage({
      id: "nieudana",
      sender_id: CHAT_IDS.me,
      failed: true,
      kind: "image",
      body: "Wykres zużycia",
      attachment_path: "tenant-alfa/conv-1/user-me/wykres.png",
      attachment_name: "wykres.png",
      attachment_mime: "image/png",
      attachment_size: 2048,
    });
    act(() => requireHandler(listProps().onRetryFailed, "onRetryFailed")(failed));

    expect(h.discardFailed).toHaveBeenCalledWith("nieudana");
    expect(h.mutations.send?.calls).toEqual([
      {
        conversationId: CHAT_IDS.conversation,
        kind: "image",
        body: "Wykres zużycia",
        attachment: {
          path: "tenant-alfa/conv-1/user-me/wykres.png",
          name: "wykres.png",
          mime: "image/png",
          size: 2048,
          duration: undefined,
        },
        replyToId: null,
        forwarded: false,
      },
    ]);
  });

  it("ponowienie wiadomości, która NIE jest nieudana, nie rusza wątku", () => {
    renderWindow();
    act(() =>
      requireHandler(listProps().onRetryFailed, "onRetryFailed")(chatMessage({ id: "m1" })),
    );
    expect(h.discardFailed).not.toHaveBeenCalled();
    expect(h.mutations.send?.calls).toEqual([]);
  });

  it("gwiazdka woła mutację z docelowym stanem, a jej błąd nie zostaje niemy", () => {
    renderWindow();
    const toggleStar = requireHandler(listProps().onToggleStar, "onToggleStar");
    act(() => toggleStar(chatMessage({ id: "m1" }), true));
    expect(h.mutations.star?.calls).toEqual([{ messageId: "m1", starred: true }]);

    act(() => toggleStar(chatMessage({ id: "m1" }), false));
    expect(h.mutations.star?.calls.at(-1)).toEqual({ messageId: "m1", starred: false });

    h.mutations.star!.outcome = { kind: "error", error: new Error("denied") };
    act(() => toggleStar(chatMessage({ id: "m1" }), true));
    expect(h.toast.error).toHaveBeenCalledWith(chatPl.chat.star.error);
  });

  it("gwiazdki NIE da się postawić na wierszu, którego serwer jeszcze nie zna", () => {
    renderWindow();
    const toggleStar = requireHandler(listProps().onToggleStar, "onToggleStar");
    act(() => toggleStar(chatMessage({ id: "w-locie", pending: true }), true));
    act(() => toggleStar(chatMessage({ id: "nieudana", failed: true }), true));
    act(() => toggleStar(chatMessage({ id: "usunieta", deleted_at: isoOffset(-1) }), true));
    expect(h.mutations.star?.calls).toEqual([]);
  });

  it("prośba listy o starszą historię dociąga kolejną stronę", () => {
    h.hasNextPage = true;
    renderWindow();
    act(() => listProps().onLoadOlder());
    expect(h.fetchNextPage).toHaveBeenCalledTimes(1);
  });
});

describe("ChatWindow - kompozytor traci kontekst tylko na żądanie", () => {
  it("zamknięcie cytatu czyści odpowiedź, a edycji nie dotyka", () => {
    renderWindow();
    act(() => listProps().onReply(chatMessage({ id: "cytowana" })));
    act(() => composerProps().onClearReply());
    expect(composerProps().replyTo).toBeNull();
  });

  it("rezygnacja z edycji zamyka tryb edycji", () => {
    renderWindow();
    act(() => listProps().onEdit(chatMessage({ id: "moja", sender_id: CHAT_IDS.me })));
    expect(composerProps().editing?.id).toBe("moja");
    act(() => composerProps().onCancelEdit());
    expect(composerProps().editing).toBeNull();
  });

  it("przejście do INNEJ rozmowy zeruje cytat i tryb edycji", () => {
    h.views = [
      conversationView(),
      conversationView({ conversation: { id: CHAT_IDS.otherConversation } }),
    ];
    const { show } = renderWindow();
    act(() => listProps().onReply(chatMessage({ id: "cytowana" })));
    expect(composerProps().replyTo?.id).toBe("cytowana");

    show({ conversationId: CHAT_IDS.otherConversation });
    expect(composerProps().conversationId).toBe(CHAT_IDS.otherConversation);
    expect(composerProps().replyTo).toBeNull();
    expect(composerProps().editing).toBeNull();
  });
});

describe("ChatWindow - warstwy modalne mają drogę powrotną", () => {
  it("cofnięcie wysłania pyta o potwierdzenie i dopiero potem usuwa", async () => {
    renderWindow();
    act(() => listProps().onDelete(chatMessage({ id: "m1" })));

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain(chatPl.chat.deleteConfirm);
    expect(h.mutations.remove?.calls).toEqual([]);

    fireEvent.click(within(dialog).getByRole("button", { name: chatPl.chat.deleteMessage }));
    expect(h.mutations.remove?.calls).toEqual(["m1"]);
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  });

  it("rezygnacja z potwierdzenia zamyka dialog i NIE usuwa wiadomości", async () => {
    renderWindow();
    act(() => listProps().onDelete(chatMessage({ id: "m1" })));

    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: chatPl.chat.close }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(h.mutations.remove?.calls).toEqual([]);
  });

  it("przekazanie dalej otwiera dialog z tą wiadomością i wyklucza bieżącą rozmowę", () => {
    renderWindow();
    act(() => requireHandler(listProps().onForward, "onForward")(chatMessage({ id: "m1" })));

    const forward = screen.getByTestId("forward");
    expect(forward.getAttribute("data-message")).toBe("m1");
    // Przekazanie „do siebie" byłoby duplikatem w tym samym wątku.
    expect(forward.getAttribute("data-exclude")).toBe(CHAT_IDS.conversation);

    fireEvent.click(screen.getByTestId("forward-close"));
    expect(screen.queryByTestId("forward")).toBeNull();
  });

  it("informacje o kręgu otwierają się z MENU i zamykają własnym przyciskiem", () => {
    h.views = [groupConversationView()];
    renderWindow({ conversationId: CHAT_IDS.group });
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: chatPl.chat.group.info }));
    expect(screen.getByTestId("group-info")).toBeTruthy();

    fireEvent.click(screen.getByTestId("group-info-close"));
    expect(screen.queryByTestId("group-info")).toBeNull();
  });

  it("wyjście z kręgu w wariancie page wraca na listę rozmów", () => {
    h.views = [groupConversationView()];
    const back = vi.fn();
    renderWindow({ conversationId: CHAT_IDS.group, onBack: back });
    fireEvent.click(screen.getByRole("button", { name: chatPl.chat.group.info }));
    fireEvent.click(screen.getByTestId("group-info-left"));
    expect(back).toHaveBeenCalled();
  });

  it("wyjście z kręgu w oknie dokowanym zamyka to okno", () => {
    h.views = [groupConversationView()];
    const close = vi.fn();
    // Belka dokowana nie ma klikalnej tożsamości - jedyne wejście do informacji
    // o kręgu prowadzi przez menu rozmowy.
    renderWindow({ conversationId: CHAT_IDS.group, variant: "dock", onClose: close });
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: chatPl.chat.group.info }));
    fireEvent.click(screen.getByTestId("group-info-left"));
    expect(close).toHaveBeenCalled();
  });

  it("dialog wyglądu zamyka się własnym przyciskiem", () => {
    renderWindow();
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: chatPl.chat.appearance.open }));
    fireEvent.click(screen.getByTestId("appearance-close"));
    expect(screen.queryByTestId("appearance")).toBeNull();
  });

  it("pasek wyszukiwania zamyka się swoim krzyżykiem, nie tylko przełącznikiem", () => {
    renderWindow();
    fireEvent.click(screen.getByRole("button", { name: chatPl.chat.search.inConversation }));
    expect(screen.getByTestId("search-bar")).toBeTruthy();

    const bar = h.searchBarProps;
    if (!bar) throw new Error("test: MessageSearchBar nie został wyrenderowany");
    act(() => bar.onClose());
    expect(screen.queryByTestId("search-bar")).toBeNull();
    expect(
      screen
        .getByRole("button", { name: chatPl.chat.search.inConversation })
        .getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("panel mediów zamyka się swoim krzyżykiem i gasi przełącznik w nagłówku", () => {
    renderWindow();
    fireEvent.click(screen.getByRole("button", { name: chatPl.chat.mediaPanel.open }));
    const panel = h.mediaPanelProps;
    if (!panel) throw new Error("test: ChatMediaPanel nie został wyrenderowany");
    expect(panel.enabled).toBe(true);

    act(() => panel.onClose());
    expect(screen.queryByTestId("media-panel")).toBeNull();
    expect(
      screen
        .getByRole("button", { name: chatPl.chat.mediaPanel.open })
        .getAttribute("aria-pressed"),
    ).toBe("false");
  });
});

describe("ChatWindow - ustawienia rozmowy, gdy serwer odmawia", () => {
  it("potwierdzone czyszczenie historii ZAMYKA dialog, zanim ruszy mutacja", async () => {
    renderWindow();
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: chatPl.chat.menu.clear }));

    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: chatPl.chat.menu.clear }));

    expect(h.mutations.clear?.calls).toEqual([{ conversationId: CHAT_IDS.conversation }]);
    // Dialog nieodwracalnej operacji nie może wisieć nad wyczyszczonym wątkiem.
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  });

  it("nieudane przypięcie z powodu INNEGO niż limit daje ogólny komunikat", () => {
    renderWindow();
    h.mutations.pin!.outcome = { kind: "error", error: new Error("denied") };
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: chatPl.chat.menu.pin }));
    expect(h.toast.error).toHaveBeenCalledWith(chatPl.chat.menu.error);
    expect(h.toast.error).not.toHaveBeenCalledWith(chatPl.chat.menu.pinLimit);
  });

  it("nieudana archiwizacja NIE ogłasza sukcesu", () => {
    renderWindow();
    h.mutations.archive!.outcome = { kind: "error", error: new Error("denied") };
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: chatPl.chat.menu.archive }));
    expect(h.toast.error).toHaveBeenCalledWith(chatPl.chat.menu.error);
    expect(h.toast.success).not.toHaveBeenCalled();
  });

  it("nieudany zapis znikania wiadomości NIE ogłasza zapisania okna", () => {
    renderWindow();
    h.mutations.ttl!.outcome = { kind: "error", error: new Error("denied") };
    openMenu();
    fireEvent.click(screen.getByRole("menuitemradio", { name: chatPl.chat.disappearing.week }));
    expect(h.mutations.ttl?.calls).toEqual([
      { conversationId: CHAT_IDS.conversation, ttlSeconds: 604800 },
    ]);
    expect(h.toast.error).toHaveBeenCalledWith(chatPl.chat.menu.error);
    expect(h.toast.success).not.toHaveBeenCalled();
  });

  it("nieudane czyszczenie historii nie kłamie o wyczyszczeniu", async () => {
    renderWindow();
    h.mutations.clear!.outcome = { kind: "error", error: new Error("denied") };
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: chatPl.chat.menu.clear }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: chatPl.chat.menu.clear }));
    expect(h.toast.error).toHaveBeenCalledWith(chatPl.chat.menu.error);
    expect(h.toast.success).not.toHaveBeenCalled();
  });
});

describe("ChatWindow - nieudane zdjęcie blokady", () => {
  it("odblokowanie z paska kompozytora, które padło, mówi o tym wprost", () => {
    h.blocks = new Set([CHAT_IDS.peer]);
    renderWindow();
    h.mutations.unblock!.outcome = { kind: "error", error: new Error("denied") };

    fireEvent.click(screen.getByRole("button", { name: chatPl.chat.block.unblock }));
    expect(h.mutations.unblock?.calls).toEqual([CHAT_IDS.peer]);
    expect(h.toast.error).toHaveBeenCalledWith(chatPl.chat.block.error);
  });

  it("potwierdzenie odblokowania w dialogu woła ODBLOKOWANIE, nie blokadę", async () => {
    h.blocks = new Set([CHAT_IDS.peer]);
    renderWindow();
    h.mutations.unblock!.outcome = { kind: "error", error: new Error("denied") };
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: chatPl.chat.block.unblock }));

    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: chatPl.chat.block.unblock }));
    expect(h.mutations.unblock?.calls).toEqual([CHAT_IDS.peer]);
    expect(h.mutations.block?.calls).toEqual([]);
    expect(h.toast.error).toHaveBeenCalledWith(chatPl.chat.block.error);
  });
});

describe("ChatWindow - kto pisze w kręgu", () => {
  it("nazwy piszących biorą pseudonim, potem profil, a na końcu placeholder", () => {
    h.views = [groupConversationView()];
    h.peers = peerProfileMap([
      peerProfile(),
      peerProfile({
        id: CHAT_IDS.peerTwo,
        display_name: "Bartosz Przykładowy",
        avatar_url: "https://example.com/bartosz.png",
        slug: "bartosz-przykladowy",
      }),
    ]);
    h.nicknames = new Map([[CHAT_IDS.group, new Map([[CHAT_IDS.peer, "Ania z DG ENER"]])]]);
    h.typingUserIds = new Set([CHAT_IDS.peerTwo, CHAT_IDS.peer, CHAT_IDS.stranger]);

    renderWindow({ conversationId: CHAT_IDS.group });

    expect(listProps().typingNames).toEqual([
      "Bartosz Przykładowy",
      "Ania z DG ENER",
      // Osoba spoza wczytanych profili nie blokuje wskaźnika - dostaje placeholder.
      "...",
    ]);
    // Avatar bierze się od PIERWSZEGO piszącego.
    expect(listProps().typingAvatarUrl).toBe("https://example.com/bartosz.png");
    expect(listProps().peerTyping).toBe(true);
  });
});

describe("ChatWindow - skok do trafienia wyszukiwarki", () => {
  it("dociąga strony, aż trafienie wejdzie w okno, i gasi cel po przewinięciu", () => {
    h.hasNextPage = true;
    h.messages = [chatMessage({ id: "m1", created_at: isoOffset(-1) })];
    const jumpRequest = { id: "sprzed-roku", nonce: 1 };
    const { show } = renderWindow({ jumpRequest });

    expect(h.fetchNextPage).toHaveBeenCalledTimes(1);
    expect(listProps().jumpToId).toBe("sprzed-roku");

    // Druga strona nadal bez trafienia - okno prosi o kolejną.
    h.messages = [chatMessage({ id: "m0", created_at: isoOffset(-40) }), ...h.messages];
    show({ jumpRequest });
    expect(h.fetchNextPage).toHaveBeenCalledTimes(2);

    // Trzecia strona wnosi trafienie: dociąganie STAJE, cel idzie do listy.
    h.messages = [chatMessage({ id: "sprzed-roku", created_at: isoOffset(-90) }), ...h.messages];
    show({ jumpRequest });
    expect(h.fetchNextPage).toHaveBeenCalledTimes(2);
    expect(listProps().jumpToId).toBe("sprzed-roku");

    act(() => requireHandler(listProps().onJumpHandled, "onJumpHandled")());
    expect(listProps().jumpToId).toBeNull();
  });
});

describe("ChatWindow - tyknięcie minuty", () => {
  it("wiadomość znikająca przepada na tyknięciu, bez czekania na refetch", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(BASE_ISO));
    h.messages = [
      chatMessage({ id: "trwala", created_at: isoOffset(-10) }),
      // Wygasa 30 sekund po otwarciu wątku - czyli PRZED pierwszym tyknięciem.
      chatMessage({ id: "znikajaca", created_at: isoOffset(-10), expires_at: isoOffset(0.5) }),
    ];

    renderWindow();
    expect(listProps().messages.map((m) => m.id)).toEqual(["trwala", "znikajaca"]);

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(listProps().messages.map((m) => m.id)).toEqual(["trwala"]);
  });
});
