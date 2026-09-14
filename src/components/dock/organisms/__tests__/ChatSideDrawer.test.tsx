// WYSUWANA SKRZYNKA CZATU DOKU - do tej pory ~2% pokrycia, a jest to
// NAJWIĘKSZY panel przestrzeni roboczej (493 linie) i jedyne miejsce, w którym
// spotyka się sześć niezależnych źródeł prawdy: sesja, trzy zapytania czatu,
// dwie leniwe paczki, magazyn zminimalizowanych rozmów i faza animacji podana
// z zewnątrz. Siedem obietnic, których nie pilnuje NIC innego w repozytorium:
//
//   1. BRAMKA GOŚCIA STOI ZA HAKAMI. `if (!user) return null` siedzi POD
//      wszystkimi hakami (ChatSideDrawer.tsx:199), więc render gościa i tak
//      przechodzi przez cały łańcuch zapytań i dopiero potem nie daje nic.
//      Przesunięcie bramki wyżej złamałoby reguły haków; ten test przypina,
//      że wynik jest pusty, a render nie wybucha.
//   2. PANEL NIE WCHODZI POD PASEK DOKU. `bottomOffset` jedzie prosto
//      w `style.bottom`, a wartość ujemna jest przycinana do zera (:245) -
//      bez tego skrzynka chowałaby ostatni wiersz listy pod paskiem.
//   3. FAZA RUCHU PRZYCHODZI Z ZEWNĄTRZ. `presenceState` musi wylądować na
//      `data-state` OBU kolumn (:251, :404). To jedyny nośnik animacji
//      WYJŚCIA: dopóki komponent przestawiał sobie flagę sam, rodzic zdejmował
//      węzeł w tej samej klatce i wyjścia nie było wcale.
//   4. OKNO ROZMOWY I DIALOG KRĘGU SĄ LENIWE. Otwarcie samej LISTY nie może
//      ciągnąć paczki okna (nagłówek panelu liczy to na 76% kodu mniej),
//      rozgrzewanie idzie na ZAMIAR, a dialog kręgu montuje się dopiero po
//      pierwszym kliknięciu i ZOSTAJE zamontowany po zamknięciu (:479-490).
//   5. ZAKŁADKA ZAPYTAŃ ISTNIEJE TYLKO DLA EKSPERTÓW I NIE ZOSTAWIA PUSTEGO
//      WIDOKU: gdy zapytania znikną, widok wraca na listę rozmów (:124-126).
//   6. MAGAZYN ZMINIMALIZOWANYCH ROZMÓW JEST DWUKIERUNKOWY. Minimalizacja
//      odkłada rozmowę Z JEJ NAZWĄ (bo pigułka w doku nie dociąga profili),
//      a `restore()` otwiera ją z powrotem, wraca na zakładkę rozmów i kasuje
//      żądanie (:174-180, :201-210).
//   7. SYGNAŁEM `openRequest` JEST TOŻSAMOŚĆ OBIEKTU, nie jego treść - ten
//      sam literał podany dwa razy nie może otwierać rozmowy po raz drugi
//      ani grzać paczki drugi raz (:136-140).
//
// WARSTWA DANYCH JEST ATRAPOWANA NA POZIOMIE MODUŁÓW HAKÓW (recepta
// z `chat/__tests__/ChatDock.test.tsx`), a nie przez łańcuch PostgREST:
// skrzynka nie ma własnych zapytań, tylko składa cudze. Za to magazyn
// zminimalizowanych rozmów zostaje PRAWDZIWY - jest synchroniczny i ma
// `reset()` opisany „wyłącznie do testów", więc atrapa niczego by tu nie
// dowiodła. Prawdziwy zostaje też `ConversationListItem`: to on rysuje nazwę
// i licznik nieprzeczytanych, czyli jedyne treści listy, które widzi
// użytkownik.
//
// Tożsamości pochodzą z `@/test/chat/fixtures` (Anna Nowak, „Krąg
// energetyczny"), a nie z wymyślonych na miejscu - żadnych prawdziwych osób.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/test/i18nReal";
import { realT } from "@/test/i18nReal";
import i18n from "@/lib/i18n";
import { dockEn, dockPl } from "@/lib/i18n-dock";
import { chatPl } from "@/lib/i18n-chat";
import { expertRequestPl } from "@/lib/i18n-expert-request";
import {
  CHAT_IDS,
  conversationView,
  groupConversationView,
  participantRow,
  peerProfile,
  peerProfileMap,
} from "@/test/chat/fixtures";
import { conversationDisplay } from "@/lib/chat/display";
import type { ConversationView, PeerProfile } from "@/lib/chat/types";
import type { DockPresenceState } from "@/lib/dock/dockMotion";
import { axeViolations, summarize } from "@/test/axe";

/** Wiersz skrzynki zapytań w kształcie, którego panel naprawdę używa. */
interface ExpertRequestStub {
  id: string;
  status: string;
}

// `views` i `requests` celowo dopuszczają `undefined`: tak wygląda zapytanie
// react-query PRZED pierwszą odpowiedzią i panel czyta obie wartości przez
// `?? []`. Bez tego wariantu pierwsze pobranie byłoby w teście niewidoczne.
const h = vi.hoisted(() => ({
  uid: "user-me" as string | null,
  pathname: "/messages",
  views: undefined as ConversationView[] | undefined,
  peers: undefined as ReadonlyMap<string, PeerProfile> | undefined,
  requests: undefined as { id: string; status: string }[] | undefined,
  conversationsError: false,
  prefetchedWindow: 0,
  prefetchedGroup: 0,
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: h.uid ? { id: h.uid } : null, tenantId: CHAT_IDS.tenant }),
}));

vi.mock("@/lib/chat/useConversations", () => ({
  useChatListRealtime: () => {},
  useConversations: () => ({ data: h.views, isError: h.conversationsError }),
  usePeerProfiles: () => ({ data: h.peers }),
  // Odwzorowanie 1:1 prawdziwego `splitArchived` (useConversations.ts:119-127):
  // podział na aktywne i zarchiwizowane idzie WYŁĄCZNIE po `me.archived_at`.
  splitArchived: (views: ConversationView[]) => ({
    active: views.filter((view) => !view.me.archived_at),
    archived: views.filter((view) => view.me.archived_at),
  }),
  // `ConversationListItem` czyta `isMuted` z TEGO modułu, więc atrapa musi go
  // oddać. Żaden widok w tym pliku nie ma `muted_until`, a prawdziwa funkcja
  // zwraca wtedy dokładnie `false` - atrapa niczego nie udaje.
  isMuted: () => false,
}));

vi.mock("@/lib/chat/presence", () => {
  const online: ReadonlySet<string> = new Set<string>();
  return { useOnlineUsers: () => online };
});

vi.mock("@/lib/chat/nicknames", () => ({ useNicknames: () => ({ data: undefined }) }));

vi.mock("@/lib/chat/useExpertRequests", () => ({
  useMyExpertRequests: () => ({ data: h.requests }),
}));

// Właściciel obu leniwych paczek. Liczniki rozgrzewania są tu jedynym sposobem
// udowodnienia, że kod leci na ZAMIAR, a nie dopiero po kliknięciu.
vi.mock("@/components/chat/chatWindowChunk", () => ({
  loadChatWindow: () =>
    Promise.resolve({
      default: (props: { conversationId: string; onClose: () => void }) => (
        <div data-testid="chat-window" data-conversation={props.conversationId}>
          <button type="button" data-testid="chat-window-close" onClick={props.onClose}>
            stub
          </button>
        </div>
      ),
    }),
  loadGroupCreateDialog: () =>
    Promise.resolve({
      default: (props: {
        open: boolean;
        onClose: () => void;
        onCreated: (conversationId: string) => void;
      }) => (
        <div data-testid="group-dialog" data-open={String(props.open)}>
          <button type="button" data-testid="group-dialog-close" onClick={props.onClose}>
            stub
          </button>
          <button
            type="button"
            data-testid="group-dialog-created"
            onClick={() => props.onCreated(CHAT_IDS.group)}
          >
            stub
          </button>
        </div>
      ),
    }),
  prefetchChatWindow: () => void (h.prefetchedWindow += 1),
  prefetchGroupCreateDialog: () => void (h.prefetchedGroup += 1),
}));

// Obie ciężkie sekcje mają własne suity; tutaj liczy się wyłącznie to, KTÓRA
// z nich jest zamontowana i że obie umieją oddać rozmowę do otwarcia.
vi.mock("@/components/chat/NewChatSearch", () => ({
  NewChatSearch: ({ onOpened }: { onOpened: (conversationId: string) => void }) => (
    <div data-testid="new-chat-search">
      <button
        type="button"
        data-testid="new-chat-open"
        onClick={() => onOpened(CHAT_IDS.conversation)}
      >
        stub
      </button>
    </div>
  ),
}));

vi.mock("@/components/chat/ExpertRequestsInbox", () => ({
  ExpertRequestsInbox: ({
    onOpenConversation,
  }: {
    onOpenConversation: (conversationId: string) => void;
  }) => (
    <div data-testid="expert-inbox">
      <button
        type="button"
        data-testid="expert-inbox-open"
        onClick={() => onOpenConversation(CHAT_IDS.conversation)}
      >
        stub
      </button>
    </div>
  ),
}));

// `<Link>` czyta kontekst routera, którego goły render nie ma. Wspólna atrapa
// repozytorium oddaje PRAWDZIWY `href`, a to jest cała rzecz, którą dowodzimy
// o skrócie „Otwórz wiadomości".
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
  // Skrzynka czyta z routera JEDNO pole - bieżącą ścieżkę - żeby na telefonie
  // złożyć się przy nawigacji. Goły render nie ma kontekstu routera, więc
  // podajemy tę ścieżkę wprost.
  useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
    select({ location: { pathname: h.pathname } }),
}));

import { ChatSideDrawer, type ChatSideDrawerProps } from "../ChatSideDrawer";
import { minimizedChatsStore } from "@/lib/chat/minimizedChats";

/** Drugi rozmówca - potrzebny, żeby licznik nieprzeczytanych miał z czym kontrastować. */
const MAREK: PeerProfile = peerProfile({
  id: CHAT_IDS.peerTwo,
  display_name: "Marek Zieliński",
  slug: "marek-zielinski",
});

const ANNA = peerProfile();
const GROUP_TITLE = groupConversationView().conversation.title ?? "";

/** Wątek prywatny z drugim rozmówcą, z zadaną liczbą nieprzeczytanych. */
function directWithMarek(unread: number): ConversationView {
  return conversationView({
    conversation: {
      id: CHAT_IDS.otherConversation,
      direct_key: `${CHAT_IDS.tenant}:${CHAT_IDS.me}:${CHAT_IDS.peerTwo}`,
    },
    me: { unread_count: unread },
    peers: [
      participantRow({ conversation_id: CHAT_IDS.otherConversation, user_id: CHAT_IDS.peerTwo }),
    ],
  });
}

interface DrawerOptions {
  bottomOffset?: number;
  openRequest?: ChatSideDrawerProps["openRequest"];
  presenceState?: DockPresenceState;
}

function renderDrawer(options: DrawerOptions = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onClose = vi.fn();
  const props: ChatSideDrawerProps = {
    onClose,
    bottomOffset: options.bottomOffset ?? 56,
    openRequest: options.openRequest ?? null,
    presenceState: options.presenceState ?? "entered",
  };
  const view = render(
    <QueryClientProvider client={client}>
      <ChatSideDrawer {...props} />
    </QueryClientProvider>,
  );
  /** Ponowny render z tymi SAMYMI referencjami propów poza podanymi. */
  const rerenderWith = (next: Partial<ChatSideDrawerProps>) =>
    view.rerender(
      <QueryClientProvider client={client}>
        <ChatSideDrawer {...props} {...next} />
      </QueryClientProvider>,
    );
  return { ...view, onClose, rerenderWith };
}

/**
 * Zakładka po jej etykiecie. `getByRole("button", { name })` tu nie wystarcza:
 * zakładka zapytań nosi obok napisu plakietkę z liczbą, więc jej nazwa
 * dostępna to „Zapytania 2", a sam napis nie jest owinięty elementem.
 */
function tabButton(label: string): HTMLElement {
  const node = screen
    .getAllByRole("button")
    .find((button) => (button.textContent ?? "").startsWith(label));
  if (!node) throw new Error(`brak zakładki: ${label}`);
  return node;
}

/** Wiersz rozmowy po nazwie widocznej dla użytkownika. */
function rowFor(name: string): HTMLElement {
  const node = screen.getByText(name).closest("button");
  if (!node) throw new Error(`brak wiersza rozmowy: ${name}`);
  return node;
}

/** Zewnętrzna, pozycjonowana ramka - nosi `bottomOffset`. */
function frame(): HTMLElement {
  const node = screen.getByRole("dialog").parentElement;
  if (!node) throw new Error("brak ramki skrzynki");
  return node;
}

function searchBox(): HTMLElement {
  return screen.getByLabelText(dockPl.dock.chat.searchPlaceholder);
}

/**
 * Nazwa, którą wspólna warstwa `conversationDisplay` daje wątkowi bez
 * rozpoznanego rozmówcy. Liczona, a nie wpisana - inaczej test przypinałby
 * literał z cudzego modułu.
 */
const UNKNOWN_NAME = conversationDisplay(conversationView({ peers: [] }), undefined).name;

beforeEach(() => {
  h.uid = CHAT_IDS.me;
  h.views = [];
  h.peers = peerProfileMap([ANNA, MAREK]);
  h.requests = [];
  h.conversationsError = false;
  h.prefetchedWindow = 0;
  h.prefetchedGroup = 0;
  minimizedChatsStore.reset();
});

afterEach(() => {
  cleanup();
  minimizedChatsStore.reset();
  window.sessionStorage.clear();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("rama skrzynki", () => {
  it("gość nie dostaje skrzynki, choć haki i tak się wykonały", () => {
    h.uid = null;
    h.views = [conversationView()];

    const { container } = renderDrawer();

    expect(container.firstChild).toBeNull();
  });

  it("wysokość paska doku jedzie w styl, a wartość ujemna przycina się do zera", () => {
    const { rerenderWith } = renderDrawer({ bottomOffset: 72 });

    expect(frame().style.bottom).toBe("72px");

    rerenderWith({ bottomOffset: -12 });

    expect(frame().style.bottom).toBe("0px");
  });

  it("skrót „otwórz wiadomości” prowadzi do pełnej skrzynki i zamyka panel", () => {
    const { onClose } = renderDrawer();

    const link = screen.getByRole("link", { name: dockPl.dock.chat.openAll });
    expect(link).toHaveAttribute("href", "/messages");

    fireEvent.click(link);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("angielski interfejs oddaje napisy z angielskiego słownika", async () => {
    h.views = [];
    await act(async () => {
      await i18n.changeLanguage("en");
    });
    try {
      renderDrawer();

      expect(screen.getByRole("dialog")).toHaveAccessibleName(dockEn.dock.chat.title);
      expect(screen.getByText(dockEn.dock.chat.empty)).toBeInTheDocument();
      expect(screen.getByRole("link", { name: dockEn.dock.chat.openAll })).toBeInTheDocument();
    } finally {
      await act(async () => {
        await i18n.changeLanguage("pl");
      });
    }
  });
});

describe("lista rozmów", () => {
  it("pusta skrzynka mówi wprost, że nie ma rozmów", () => {
    renderDrawer();

    expect(screen.getByText(dockPl.dock.chat.empty)).toBeInTheDocument();
  });

  // DEFEKT ZAREJESTROWANY, NIE OBCHODZONY. Podczas PIERWSZEGO pobrania listy
  // `conversationsQ.data` jest jeszcze `undefined`, a panel nie ma szczebla
  // „trwa pobieranie": gałąź na ChatSideDrawer.tsx:370-373 sprawdza wyłącznie
  // `isError`, a potem `rows.length === 0`. Pusta tablica z `?? []` (:151) jest
  // wtedy prawdą, więc użytkownik czyta „Brak rozmów. Wyszukaj osobę, żeby
  // zacząć." jako FAKT, zanim cokolwiek wiadomo. Cztery pozostałe panele doku
  // mają ten szczebel wprost (błąd -> pobieranie -> pustka -> lista) i ich
  // nagłówki nazywają to naprawionym błędem; skrzynka czatu jako jedyna go nie
  // ma. Naprawa (odczyt `isPending` i szkielet listy) należy do właściciela
  // panelu - tutaj przypinamy sam mechanizm, żeby nie zginął.
  it.fails("DEFEKT: pierwsze pobranie listy udaje pustą skrzynkę", () => {
    h.views = undefined;

    renderDrawer();

    expect(screen.queryByText(dockPl.dock.chat.empty)).toBeNull();
  });

  it("same kręgi nie rysują nagłówka wiadomości prywatnych", () => {
    h.views = [groupConversationView()];

    renderDrawer();

    expect(screen.queryByRole("heading", { name: dockPl.dock.chat.sections.direct })).toBeNull();
    expect(
      screen.getByRole("heading", { name: dockPl.dock.chat.sections.groups }),
    ).toBeInTheDocument();
  });

  it("błąd zapytania zastępuje listę komunikatem i nie udaje pustki", () => {
    h.conversationsError = true;
    h.views = [conversationView()];

    renderDrawer();

    expect(screen.getByText(dockPl.dock.error)).toBeInTheDocument();
    expect(screen.queryByText(dockPl.dock.chat.empty)).toBeNull();
  });

  it("wątki prywatne i kręgi trafiają do osobnych sekcji", () => {
    h.views = [conversationView(), groupConversationView()];

    renderDrawer();

    const direct = screen.getByRole("heading", { name: dockPl.dock.chat.sections.direct });
    const groups = screen.getByRole("heading", { name: dockPl.dock.chat.sections.groups });

    expect(within(direct.parentElement as HTMLElement).getByText(ANNA.display_name)).toBeVisible();
    expect(within(groups.parentElement as HTMLElement).getByText(GROUP_TITLE)).toBeVisible();
  });

  it("licznik nieprzeczytanych stoi tylko przy rozmowie z zaległościami", () => {
    h.views = [conversationView(), directWithMarek(3)];

    renderDrawer();

    // Etykieta plakietki idzie przez liczbę mnogą słownika czatu, więc bierzemy
    // ją z prawdziwego tłumacza, a nie z wpisanego tu napisu.
    const badge = screen.getByLabelText(realT()("chat.unread", { count: 3 }));
    expect(badge).toHaveTextContent("3");
    expect(badge.closest("button")).toBe(rowFor(MAREK.display_name));
  });

  it("wyszukiwarka zawęża listę, a brak trafień wraca do komunikatu o pustce", async () => {
    h.views = [conversationView(), groupConversationView()];

    renderDrawer();

    fireEvent.change(searchBox(), { target: { value: "anna" } });

    await waitFor(() => {
      expect(screen.queryByText(GROUP_TITLE)).toBeNull();
    });
    expect(screen.getByText(ANNA.display_name)).toBeVisible();

    fireEvent.change(searchBox(), { target: { value: "nikt-taki" } });

    await waitFor(() => {
      expect(screen.getByText(dockPl.dock.chat.empty)).toBeInTheDocument();
    });
  });
});

describe("wybór rozmowy", () => {
  // TEN TEST MUSI ZOSTAĆ PIERWSZYM, KTÓRY WYBIERA ROZMOWĘ. `lazy()` żyje
  // w module panelu i zapamiętuje rozwiązaną paczkę na zawsze, więc zastępnik
  // `Suspense` da się zobaczyć wyłącznie przy pierwszym montażu okna w tym
  // pliku. Przestawienie kolejności zgasi asercję o zastępniku.
  it("wybór rozmowy pokazuje zastępnik, potem montuje leniwe okno", async () => {
    h.views = [conversationView()];

    renderDrawer();

    expect(screen.getByRole("dialog")).toHaveAttribute("data-mobile-view", "inbox");

    fireEvent.click(rowFor(ANNA.display_name));

    // Paczka jeszcze nie przyszła - użytkownik widzi szkielet wątku z żywym
    // komunikatem dla czytnika ekranu, a nie pustą kolumnę.
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText(dockPl.dock.loading)).toBeInTheDocument();

    const window = await screen.findByTestId("chat-window");

    expect(window).toHaveAttribute("data-conversation", CHAT_IDS.conversation);
    expect(screen.getByRole("dialog")).toHaveAttribute("data-mobile-view", "conversation");
  });

  it("faza prezencji jedzie na obie kolumny", async () => {
    h.views = [conversationView()];

    const { rerenderWith } = renderDrawer({ presenceState: "entering" });

    expect(screen.getByRole("dialog")).toHaveAttribute("data-state", "entering");

    fireEvent.click(rowFor(ANNA.display_name));
    await screen.findByTestId("chat-window");

    const column = document.querySelector("[data-mobile-chat-conversation]");
    expect(column).toHaveAttribute("data-state", "entering");

    rerenderWith({ presenceState: "exiting" });

    expect(screen.getByRole("dialog")).toHaveAttribute("data-state", "exiting");
    expect(document.querySelector("[data-mobile-chat-conversation]")).toHaveAttribute(
      "data-state",
      "exiting",
    );
  });

  it("krzyżyk nagłówka zamyka skrzynkę bez wyboru, a z wyborem tylko chowa listę", async () => {
    h.views = [conversationView()];

    const { onClose } = renderDrawer();

    fireEvent.click(rowFor(ANNA.display_name));
    await screen.findByTestId("chat-window");

    // Przy wybranej rozmowie etykietę „ukryj listę" noszą DWA przyciski:
    // krzyżyk nagłówka i przełącznik w kolumnie rozmowy. Pierwszy w DOM to
    // krzyżyk - i to on ma NIE zamykać całej skrzynki.
    const hide = screen.getAllByLabelText(dockPl.dock.chat.hideInbox);
    expect(hide).toHaveLength(2);

    fireEvent.click(hide[0]);

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId("chat-window")).toBeInTheDocument();
  });

  it("przełącznik kolumny rozmowy zwija i rozwija listę", async () => {
    h.views = [conversationView()];

    renderDrawer();

    fireEvent.click(rowFor(ANNA.display_name));
    await screen.findByTestId("chat-window");

    const toggle = screen.getAllByLabelText(dockPl.dock.chat.hideInbox)[1];
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(toggle);

    const reopened = screen.getByLabelText(dockPl.dock.chat.showInbox);
    expect(reopened).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(reopened);

    expect(screen.getAllByLabelText(dockPl.dock.chat.hideInbox)[1]).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("zamknięcie rozmowy wraca do skrzynki", async () => {
    h.views = [conversationView()];

    const { onClose } = renderDrawer();

    fireEvent.click(rowFor(ANNA.display_name));
    await screen.findByTestId("chat-window");

    fireEvent.click(screen.getByLabelText(dockPl.dock.chat.closeConversation));

    expect(screen.queryByTestId("chat-window")).toBeNull();
    expect(screen.getByRole("dialog")).toHaveAttribute("data-mobile-view", "inbox");
    // Zamknięcie WĄTKU to nie zamknięcie skrzynki - lista zostaje na ekranie.
    expect(onClose).not.toHaveBeenCalled();
  });

  it("okno rozmowy samo potrafi się zamknąć przez oddany mu uchwyt", async () => {
    h.views = [conversationView()];

    renderDrawer();

    fireEvent.click(rowFor(ANNA.display_name));
    await screen.findByTestId("chat-window");

    fireEvent.click(screen.getByTestId("chat-window-close"));

    expect(screen.queryByTestId("chat-window")).toBeNull();
  });
});

describe("zakładki", () => {
  it("zakładka „napisz” montuje wyszukiwarkę osób, a jej wynik otwiera rozmowę", async () => {
    h.views = [conversationView()];

    renderDrawer();

    fireEvent.click(tabButton(dockPl.dock.chat.start));

    expect(screen.getByTestId("new-chat-search")).toBeInTheDocument();
    expect(screen.queryByText(ANNA.display_name)).toBeNull();

    fireEvent.click(screen.getByTestId("new-chat-open"));

    await screen.findByTestId("chat-window");
    // Otwarcie rozmowy sprowadza widok z powrotem na listę.
    expect(screen.queryByTestId("new-chat-search")).toBeNull();
  });

  it("powrót na zakładkę rozmów przywraca listę", () => {
    h.views = [conversationView()];

    renderDrawer();

    const chats = tabButton(dockPl.dock.chat.title);
    expect(chats).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(tabButton(dockPl.dock.chat.start));
    expect(chats).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(chats);

    expect(chats).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(ANNA.display_name)).toBeVisible();
  });

  it("bez zapytań eksperckich zakładka zapytań w ogóle nie istnieje", () => {
    h.requests = [];

    const { rerenderWith } = renderDrawer();

    expect(() => tabButton(expertRequestPl.expertRequest.inbox.tab)).toThrow();

    // Ta sama odpowiedź, tylko jeszcze w locie - zakładki nadal ma nie być.
    h.requests = undefined;
    rerenderWith({});

    expect(() => tabButton(expertRequestPl.expertRequest.inbox.tab)).toThrow();
  });

  it("zapytania bez oczekujących dają zakładkę bez plakietki", () => {
    h.requests = [{ id: "req-1", status: "answered" }];

    renderDrawer();

    const tab = tabButton(expertRequestPl.expertRequest.inbox.tab);
    // Cały napis przycisku to sama etykieta - żadnego „0" obok niej.
    expect(tab.textContent).toBe(expertRequestPl.expertRequest.inbox.tab);
  });

  it("zakładka zapytań liczy tylko oczekujące i otwiera skrzynkę zapytań", async () => {
    const requests: ExpertRequestStub[] = [
      { id: "req-1", status: "pending" },
      { id: "req-2", status: "pending" },
      { id: "req-3", status: "answered" },
    ];
    h.requests = requests;

    renderDrawer();

    const tab = tabButton(expertRequestPl.expertRequest.inbox.tab);
    expect(within(tab).getByText("2")).toBeInTheDocument();

    fireEvent.click(tab);

    expect(tab).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("expert-inbox")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("expert-inbox-open"));

    await screen.findByTestId("chat-window");
  });

  it("znikające zapytania nie zostawiają pustego widoku", () => {
    h.requests = [{ id: "req-1", status: "pending" }];
    h.views = [conversationView()];

    const { rerenderWith } = renderDrawer();

    fireEvent.click(tabButton(expertRequestPl.expertRequest.inbox.tab));
    expect(screen.getByTestId("expert-inbox")).toBeInTheDocument();

    h.requests = [];
    rerenderWith({});

    expect(screen.queryByTestId("expert-inbox")).toBeNull();
    expect(screen.getByText(ANNA.display_name)).toBeVisible();
  });
});

describe("magazyn zminimalizowanych rozmów", () => {
  it("minimalizacja odkłada rozmowę z jej nazwą i gasi okno", async () => {
    h.views = [conversationView()];

    renderDrawer();

    fireEvent.click(rowFor(ANNA.display_name));
    await screen.findByTestId("chat-window");

    fireEvent.click(screen.getByLabelText(dockPl.dock.chat.minimize));

    const snapshot = minimizedChatsStore.getSnapshot();
    expect(snapshot.minimized).toHaveLength(1);
    expect(snapshot.minimized[0]).toMatchObject({
      id: CHAT_IDS.conversation,
      name: ANNA.display_name,
    });
    expect(screen.queryByTestId("chat-window")).toBeNull();
  });

  // Trzy drogi do tego samego skutku: pigułka w doku nie dociąga profili, więc
  // to, co zapiszemy przy minimalizacji, JEST całą jej treścią. Nienazwana
  // pigułka byłaby dla użytkownika nie do odróżnienia od innej nienazwanej.
  it("minimalizacja bez rozpoznanego rozmówcy zapisuje nazwę zastępczą, nie pustkę", async () => {
    // (a) wątek, którego lista jeszcze nie zna - żądanie przyszło z zewnątrz.
    h.views = [conversationView()];
    renderDrawer({ openRequest: { conversationId: "conv-spoza-listy" } });
    await screen.findByTestId("chat-window");
    fireEvent.click(screen.getByLabelText(dockPl.dock.chat.minimize));

    expect(minimizedChatsStore.getSnapshot().minimized[0]).toMatchObject({
      id: "conv-spoza-listy",
      name: dockPl.dock.chat.title,
      avatarUrl: null,
    });

    cleanup();
    minimizedChatsStore.reset();

    // (b) wątek bez wiersza uczestnika - RLS potrafi ukryć rozmówcę.
    h.views = [conversationView({ peers: [] })];
    renderDrawer();
    fireEvent.click(rowFor(UNKNOWN_NAME));
    await screen.findByTestId("chat-window");
    fireEvent.click(screen.getByLabelText(dockPl.dock.chat.minimize));

    expect(minimizedChatsStore.getSnapshot().minimized[0]).toMatchObject({
      name: UNKNOWN_NAME,
      avatarUrl: null,
    });

    cleanup();
    minimizedChatsStore.reset();

    // (c) uczestnik jest, ale jego karty profilu nie ma w odpowiedzi.
    h.views = [
      conversationView({
        peers: [
          participantRow({ conversation_id: CHAT_IDS.conversation, user_id: CHAT_IDS.stranger }),
        ],
      }),
    ];
    renderDrawer();
    fireEvent.click(rowFor(UNKNOWN_NAME));
    await screen.findByTestId("chat-window");
    fireEvent.click(screen.getByLabelText(dockPl.dock.chat.minimize));

    expect(minimizedChatsStore.getSnapshot().minimized[0]).toMatchObject({
      name: UNKNOWN_NAME,
      avatarUrl: null,
    });
  });

  it("przywrócenie z paska otwiera rozmowę, wraca na listę i kasuje żądanie", async () => {
    h.views = [conversationView()];

    renderDrawer();

    fireEvent.click(tabButton(dockPl.dock.chat.start));
    expect(screen.getByTestId("new-chat-search")).toBeInTheDocument();

    await act(async () => {
      minimizedChatsStore.restore(CHAT_IDS.conversation);
    });

    await screen.findByTestId("chat-window");
    expect(screen.queryByTestId("new-chat-search")).toBeNull();
    // Żądanie jest jednorazowe - gdyby zostało, każdy kolejny render otwierałby
    // tę samą rozmowę wbrew użytkownikowi.
    expect(minimizedChatsStore.getSnapshot().requested).toBeNull();
    expect(h.prefetchedWindow).toBeGreaterThan(0);
  });
});

describe("żądanie otwarcia z zewnątrz", () => {
  it("świeży literał otwiera rozmowę, ten sam obiekt nie robi nic drugi raz", async () => {
    h.views = [conversationView()];

    const { rerenderWith } = renderDrawer({
      openRequest: { conversationId: CHAT_IDS.conversation },
    });

    const first = await screen.findByTestId("chat-window");
    expect(first).toHaveAttribute("data-conversation", CHAT_IDS.conversation);
    expect(h.prefetchedWindow).toBe(1);

    // Ten sam obiekt - efekt zależy od TOŻSAMOŚCI, więc nie ma prawa ruszyć.
    rerenderWith({});
    expect(h.prefetchedWindow).toBe(1);

    rerenderWith({ openRequest: { conversationId: CHAT_IDS.otherConversation } });

    const second = await screen.findByTestId("chat-window");
    expect(second).toHaveAttribute("data-conversation", CHAT_IDS.otherConversation);
    expect(h.prefetchedWindow).toBe(2);
  });
});

describe("dialog kręgu", () => {
  it("rozgrzewa się na zamiar, montuje po kliknięciu i zostaje po zamknięciu", async () => {
    renderDrawer();

    const create = tabButton(chatPl.chat.group.create);

    fireEvent.pointerEnter(create);
    expect(h.prefetchedGroup).toBeGreaterThan(0);
    // Rozgrzanie to nie montaż: dopóki nikt nie kliknął, dialogu nie ma.
    expect(screen.queryByTestId("group-dialog")).toBeNull();

    fireEvent.click(create);

    const dialog = await screen.findByTestId("group-dialog");
    expect(dialog).toHaveAttribute("data-open", "true");

    fireEvent.click(screen.getByTestId("group-dialog-close"));

    // Węzeł ZOSTAJE zamontowany - inaczej Radix nie miałby czego animować.
    expect(screen.getByTestId("group-dialog")).toHaveAttribute("data-open", "false");
  });

  it("utworzony krąg otwiera się jako rozmowa", async () => {
    renderDrawer();

    fireEvent.click(tabButton(chatPl.chat.group.create));
    await screen.findByTestId("group-dialog");

    fireEvent.click(screen.getByTestId("group-dialog-created"));

    const window = await screen.findByTestId("chat-window");
    expect(window).toHaveAttribute("data-conversation", CHAT_IDS.group);
    expect(screen.getByTestId("group-dialog")).toHaveAttribute("data-open", "false");
  });
});

describe("dostępność", () => {
  it("wczytana skrzynka nie ma naruszeń axe", async () => {
    h.views = [conversationView(), directWithMarek(3), groupConversationView()];

    const { container } = renderDrawer();
    await screen.findByText(ANNA.display_name);

    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});
