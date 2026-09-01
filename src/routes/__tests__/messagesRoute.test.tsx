// Trasa `/messages` - PEŁNA skrzynka czatu (687 linii, 0% pokrycia przed tym
// plikiem). To pierwszy test trasy czatu w repo.
//
// PO CO TEN PLIK. Skrzynka jest jedynym miejscem, w którym spotykają się
// cztery niezależne kontrakty i żaden z nich nie ma dowodu w testach warstwy
// danych:
//   1. KONTRAKT ADRESU - `?c=<id>` (deep link do rozmowy) i `?view=` z zamkniętą
//      listą wartości; nieznana wartość musi zniknąć, a nie przeciec do stanu;
//   2. KONTRAKT NAGŁÓWKA - skrzynka prywatnych wiadomości NIE MOŻE trafić do
//      indeksu (`robots: noindex, nofollow`) ani renderować się na serwerze
//      (`ssr: false` - sesja żyje w localStorage, SSR = mismatch hydratacji);
//   3. BRAMKI WIDOCZNOŚCI - AuthGate (anonim nie widzi ani jednej rozmowy),
//      wyłączony przez administratora moduł czatu i zakładka „Zapytania"
//      zarezerwowana dla ekspertów będących ODBIORCAMI zapytań;
//   4. SKLEJENIE LISTY Z PANELEM - filtry, archiwum, wyszukiwanie w treści
//      i skok do trafionej wiadomości.
//
// CO JEST ATRAPĄ, A CO NIE. Warstwa danych czatu (`useConversations`,
// `usePeerProfiles`, `useNicknames`, `useOnlineUsers`, `useChatUnreadTotal`,
// `useMessageSearch`, `useUnreadCount`, `useMyExpertRequests`,
// `useCommunityModules`, `useChatListRealtime`) ma własne testy w
// `src/lib/chat/__tests__` i jest tu zamockowana. Ciężkie dzieci z własną
// warstwą danych (`ChatWindow`, `DemoBotChat`, `NewChatSearch`,
// `GroupCreateDialog`, `ExpertRequestsInbox`, `NotificationsCenter`) to atrapy
// WYSTAWIAJĄCE SWÓJ KONTRAKT - dowodzimy, że trasa podaje im właściwe propsy,
// a nie renderujemy ich wnętrzności po raz drugi.
//
// AuthGate renderujemy PRAWDZIWY (razem z jego ekranem 401), bo to on jest
// przedmiotem dowodu; zamockowany jest wyłącznie `@/hooks/useAuth`, czyli
// źródło sesji, z którego bramka korzysta.
//
// ŚWIADOMIE POZA ZAKRESEM: wnętrze okna rozmowy (`ChatWindow.test.tsx`),
// centrum powiadomień, tworzenie kręgu, wyszukiwarka nowych rozmówców i
// arytmetyka RPC wyszukiwania - każde ma własny plik.
//
// RODO: żadnych prawdziwych osób - tożsamości pochodzą z `CHAT_IDS`, nazwy są
// zmyślone („Zofia Testowa", „Jan Przykładowy"), treści i tytuły kręgów też.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import "@/lib/i18n-chat";
import "@/lib/i18n-notifications";
import "@/lib/i18n-expert-request";
import "@/lib/i18n-community";
import { chatPl } from "@/lib/i18n-chat";
import { communityPl } from "@/lib/i18n-community";
import { errorCopy } from "@/lib/errorCopy";
import { realT } from "@/test/i18nReal";
import { renderRoute, routeMeta, routeSearchValidator } from "@/test/routeHarness";
import {
  CHAT_IDS,
  conversationView,
  groupConversationView,
  isoOffset,
  messageSearchHit,
  participantRow,
  peerProfile,
  peerProfileMap,
} from "@/test/chat/fixtures";
import type { ConversationView, PeerProfile } from "@/lib/chat/types";
import type { MessageSearchHit } from "@/lib/chat/useMessageSearch";

/** Kontrakt propsów `ChatWindow` w części, którą podaje mu trasa. */
interface ChatWindowStubProps {
  conversationId: string;
  variant?: string;
  autoFocus?: boolean;
  jumpRequest?: { id: string; nonce: number } | null;
  onBack?: () => void;
}

interface DemoBotChatStubProps {
  lang: string;
  onBack: () => void;
}

interface NewChatSearchStubProps {
  onOpened: (conversationId: string) => void;
}

interface GroupCreateDialogStubProps {
  open: boolean;
  onClose: () => void;
  onCreated: (conversationId: string) => void;
}

interface ExpertRequestsInboxStubProps {
  onOpenConversation: (conversationId: string) => void;
  className?: string;
}

/**
 * Router widziany OD ŚRODKA drzewa. `renderRoute` nie wystawia instancji
 * routera, a bez niej nie da się odróżnić `replace: true` od zwykłego wejścia
 * w historię - a to jest tu kontraktem (skrzynka nie może zaśmiecać przycisku
 * „wstecz" każdą otwartą rozmową). Atrapa `GroupCreateDialog` jest jedynym
 * dzieckiem montowanym ZAWSZE, więc to ona podbiera router przez `useRouter()`.
 */
interface RouterProbe {
  history: { length: number };
}

/** Zapytanie o zapytania eksperckie w kształcie, którego dotyka trasa. */
interface ExpertRequestStub {
  status: string;
}

const h = vi.hoisted(() => ({
  auth: {
    session: null as { access_token: string } | null,
    user: null as { id: string } | null,
    loading: false,
  },
  modules: { chat_enabled: true },
  views: [] as ConversationView[],
  conversationsLoading: false,
  peers: undefined as ReadonlyMap<string, PeerProfile> | undefined,
  nicknames: undefined as ReadonlyMap<string, ReadonlyMap<string, string>> | undefined,
  online: new Set<string>() as ReadonlySet<string>,
  unreadTotal: 0,
  unreadNotif: 0,
  expertRequests: [] as ExpertRequestStub[],
  expertRequestBoxes: [] as string[],
  searchHits: [] as MessageSearchHit[],
  searchLoading: false,
  searchArgs: [] as Array<{ q: string; conversationId: string | null; enabled: boolean }>,
  chatListRealtime: vi.fn(),
  chatWindow: null as ChatWindowStubProps | null,
  demoBotChat: null as DemoBotChatStubProps | null,
  newChatSearch: null as NewChatSearchStubProps | null,
  groupCreateDialog: null as GroupCreateDialogStubProps | null,
  expertInbox: null as ExpertRequestsInboxStubProps | null,
  router: null as RouterProbe | null,
}));

// --- granica sesji: bramka ma działać NAPRAWDĘ, mockujemy tylko jej źródło ---
vi.mock("@/hooks/useAuth", async () => {
  const { CHAT_IDS: ids } = await import("@/test/chat/fixtures");
  return {
    useAuth: () => ({
      session: h.auth.session,
      user: h.auth.user,
      loading: h.auth.loading,
      roles: [],
      tenantId: ids.tenant,
      isStaff: false,
      isAdmin: false,
      isSuperAdmin: false,
      signOut: async () => {},
    }),
  };
});

// `<Link to="/profile">` w skrzynce i skróty ratunkowe ekranu 401 - zwykłe
// kotwice, żeby dowód dotyczył treści, a nie budowania href-ów.
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

// --- warstwa danych (ma własne testy) --------------------------------------

vi.mock("@/lib/community/useCommunityModules", () => ({
  useCommunityModules: () => h.modules,
}));

vi.mock("@/lib/chat/useExpertRequests", () => ({
  useMyExpertRequests: (box: string) => {
    h.expertRequestBoxes.push(box);
    return { data: h.expertRequests };
  },
}));

// `splitArchived` i `isMuted` zostają PRAWDZIWE - to czyste funkcje, na
// których stoi podział na listę aktywną i archiwum.
vi.mock("@/lib/chat/useConversations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/chat/useConversations")>();
  return {
    ...actual,
    useConversations: () => ({ data: h.views, isLoading: h.conversationsLoading }),
    usePeerProfiles: () => ({ data: h.peers }),
    useChatUnreadTotal: () => h.unreadTotal,
    useChatListRealtime: h.chatListRealtime,
  };
});

vi.mock("@/lib/chat/nicknames", () => ({
  useNicknames: () => ({ data: h.nicknames }),
}));

vi.mock("@/lib/chat/presence", () => ({
  useOnlineUsers: () => h.online,
}));

vi.mock("@/lib/notifications/useNotifications", () => ({
  useUnreadCount: () => ({ data: h.unreadNotif }),
}));

// `MESSAGE_SEARCH_MIN_CHARS` zostaje prawdziwy - próg widoczności sekcji
// wyników jest w tym pliku przedmiotem dowodu, więc nie może być literałem.
vi.mock("@/lib/chat/useMessageSearch", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/chat/useMessageSearch")>();
  return {
    ...actual,
    useMessageSearch: (q: string, conversationId: string | null, enabled = true) => {
      h.searchArgs.push({ q, conversationId, enabled });
      return { data: h.searchHits, isLoading: h.searchLoading };
    },
  };
});

// --- atrapy ciężkich dzieci (każda wystawia swój kontrakt propsów) ----------

vi.mock("@/components/chat/ChatWindow", () => ({
  ChatWindow: (props: ChatWindowStubProps) => {
    h.chatWindow = props;
    return <div data-testid="chat-window" data-conversation={props.conversationId} />;
  },
}));

// `DEMO_BOT_ID` bierzemy z ORYGINAŁU - to identyfikator, który trafia do
// adresu (`?c=...`), więc test nie może go sobie wymyślić.
vi.mock("@/components/chat/DemoBotChat", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/chat/DemoBotChat")>();
  return {
    DEMO_BOT_ID: actual.DEMO_BOT_ID,
    DemoBotChat: (props: DemoBotChatStubProps) => {
      h.demoBotChat = props;
      return <div data-testid="demo-bot-chat" data-lang={props.lang} />;
    },
  };
});

vi.mock("@/components/chat/NewChatSearch", () => ({
  NewChatSearch: (props: NewChatSearchStubProps) => {
    h.newChatSearch = props;
    return <div data-testid="new-chat-search" />;
  },
}));

vi.mock("@/components/chat/GroupCreateDialog", async () => {
  const { useRouter } = await import("@tanstack/react-router");
  return {
    GroupCreateDialog: (props: GroupCreateDialogStubProps) => {
      h.groupCreateDialog = props;
      h.router = useRouter();
      return <div data-testid="group-create-dialog" data-open={String(props.open)} />;
    },
  };
});

vi.mock("@/components/chat/ExpertRequestsInbox", () => ({
  ExpertRequestsInbox: (props: ExpertRequestsInboxStubProps) => {
    h.expertInbox = props;
    return <div data-testid="expert-requests-inbox" />;
  },
}));

vi.mock("@/components/notifications/NotificationsCenter", () => ({
  NotificationsCenter: (props: { mode?: string }) => (
    <div data-testid="notifications-center" data-mode={String(props.mode)} />
  ),
}));

import { DEMO_BOT_ID } from "@/components/chat/DemoBotChat";
import { MESSAGE_SEARCH_MIN_CHARS } from "@/lib/chat/useMessageSearch";
import { Route } from "@/routes/messages";

const t = realT("pl");
/** Etykiety zakładek spoza słownika czatu - ze słownika, nie z literałów. */
const TAB_NOTIFICATIONS = t("notifications.title");
const TAB_CONSENTS = t("notifications.consents.tab");
const TAB_REQUESTS = t("expertRequest.inbox.tab");

const ARCHIVED_ONE = "arch-1";
const ARCHIVED_TWO = "arch-2";

/** Wątek bezpośredni z „Zofią Testową" (domyślny rozmówca fixture'ów). */
const zofiaThread = () => conversationView();

/** Wątek bezpośredni z „Janem Przykładowym", z nieprzeczytanymi. */
const janThread = () =>
  conversationView({
    conversation: { id: CHAT_IDS.otherConversation },
    me: { unread_count: 3 },
    peers: [
      participantRow({ conversation_id: CHAT_IDS.otherConversation, user_id: CHAT_IDS.peerTwo }),
    ],
  });

/** Krąg (rozmowa grupowa) - jedyny wątek, który przechodzi filtr „Kręgi". */
const circleThread = () => groupConversationView();

const archivedThread = (id: string, title: string) =>
  groupConversationView({
    conversation: { id, title },
    me: { archived_at: isoOffset(-100) },
  });

const mountMessages = (initialEntry = "/messages") =>
  renderRoute({ route: Route, path: "/messages", initialEntry });

/** Pole filtra listy - jedno wejście dla nazw rozmów i dla treści wiadomości. */
const filterInput = () => screen.getByLabelText(chatPl.chat.searchConversations);

/** Router przechwycony przez atrapę dialogu - strażnik zamiast rzutowania. */
function routerProbe(): RouterProbe {
  const probe = h.router;
  if (!probe) throw new Error("test: atrapa GroupCreateDialog nie przechwyciła routera");
  return probe;
}

beforeEach(() => {
  h.auth.session = { access_token: "test-session" };
  h.auth.user = { id: CHAT_IDS.me };
  h.auth.loading = false;
  h.modules = { chat_enabled: true };
  h.views = [];
  h.conversationsLoading = false;
  h.peers = peerProfileMap([
    peerProfile({ id: CHAT_IDS.peer, display_name: "Zofia Testowa", slug: "zofia-testowa" }),
    peerProfile({ id: CHAT_IDS.peerTwo, display_name: "Jan Przykładowy", slug: "jan-przykladowy" }),
  ]);
  h.nicknames = new Map();
  h.online = new Set();
  h.unreadTotal = 0;
  h.unreadNotif = 0;
  h.expertRequests = [];
  h.expertRequestBoxes = [];
  h.searchHits = [];
  h.searchLoading = false;
  h.searchArgs = [];
  h.chatListRealtime.mockClear();
  h.chatWindow = null;
  h.demoBotChat = null;
  h.newChatSearch = null;
  h.groupCreateDialog = null;
  h.expertInbox = null;
  h.router = null;
});

afterEach(() => cleanup());

describe("trasa /messages - kontrakt adresu", () => {
  const validate = routeSearchValidator(Route);

  it("deep link do rozmowy przechodzi, a pusty `c` nie tworzy fałszywego wskazania", () => {
    const conversationId = "11111111-1111-4111-8111-111111111111";
    expect(validate({ c: conversationId })).toEqual({ c: conversationId });
    // Pusty łańcuch otworzyłby „rozmowę o pustym id" - musi zniknąć.
    expect(validate({ c: "" })).toEqual({});
    // Wartość spoza typu (np. `?c=1&c=2` daje tablicę) też odpada.
    expect(validate({ c: 42 })).toEqual({});
    expect(validate({})).toEqual({});
  });

  it("`view` przyjmuje wyłącznie cztery znane widoki, reszta odpada do `undefined`", () => {
    for (const view of ["chats", "notifications", "consents", "requests"] as const) {
      expect(validate({ view })).toEqual({ view });
    }
    // Nieznana wartość NIE może przeciec do stanu - inaczej skrzynka
    // renderowałaby pustkę zamiast któregokolwiek widoku.
    expect(validate({ view: "admin" })).toEqual({});
    expect(validate({ view: "" })).toEqual({});
    expect(validate({ view: 7 })).toEqual({});
  });
});

describe("trasa /messages - kontrakt nagłówka i hydratacji", () => {
  it("skrzynka prywatnych wiadomości nie może trafić do indeksu wyszukiwarek", async () => {
    const meta = await routeMeta(Route);
    // Tytuł jest wpisany w `head()` trasy (nie pochodzi ze słownika), więc
    // asertujemy dokładnie to, co trafia do <title>.
    expect(meta).toContainEqual({ title: "Wiadomości" });
    expect(meta).toContainEqual({ name: "robots", content: "noindex, nofollow" });
  });

  it("trasa nie renderuje się na serwerze - sesja żyje po stronie klienta", () => {
    // `ssr: false` nie jest kosmetyką: SSR wyrenderowałby spinner AuthGate,
    // a klient treść skrzynki - czyli gwarantowany mismatch hydratacji.
    expect(Route.options.ssr).toBe(false);
  });
});

describe("trasa /messages - bramka logowania", () => {
  it("anonim nie widzi ANI JEDNEJ rozmowy, tylko prośbę o zalogowanie", async () => {
    h.auth.session = null;
    h.auth.user = null;
    h.views = [zofiaThread(), janThread()];
    await mountMessages("/messages?c=" + CHAT_IDS.conversation);

    expect(screen.getAllByText(errorCopy().unauthorized.title).length).toBeGreaterThan(0);
    // Żaden element skrzynki: ani taby widoków, ani lista, ani okno rozmowy.
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByLabelText(chatPl.chat.searchConversations)).toBeNull();
    expect(screen.queryByTestId("chat-window")).toBeNull();
    expect(screen.queryByText("Zofia Testowa")).toBeNull();
  });

  it("dopóki sesja się wczytuje, skrzynka nie miga ani treścią, ani ekranem 401", async () => {
    h.auth.loading = true;
    h.views = [zofiaThread()];
    await mountMessages();

    expect(screen.getByLabelText("loading")).toBeInTheDocument();
    expect(screen.queryByText(errorCopy().unauthorized.title)).toBeNull();
    expect(screen.queryByRole("tablist")).toBeNull();
  });
});

describe("trasa /messages - moduł czatu wyłączony przez administratora", () => {
  beforeEach(() => {
    h.modules = { chat_enabled: false };
    h.views = [zofiaThread(), janThread()];
  });

  it("zakładka czatu znika, a widok domyślny spada na powiadomienia", async () => {
    await mountMessages();

    expect(screen.queryByRole("tab", { name: chatPl.chat.messages })).toBeNull();
    expect(screen.getByRole("tab", { name: TAB_NOTIFICATIONS }).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(screen.getByTestId("notifications-center").getAttribute("data-mode")).toBe("inbox");
  });

  it("wejście wprost na `?view=chats` NIE pokazuje czatu", async () => {
    await mountMessages("/messages?view=chats");

    // Gdyby zadziałał sam adres, wyłączenie modułu byłoby fikcją.
    expect(screen.queryByLabelText(chatPl.chat.searchConversations)).toBeNull();
    expect(screen.queryByTestId("chat-window")).toBeNull();
    expect(screen.queryByText("Zofia Testowa")).toBeNull();
    expect(screen.getByTestId("notifications-center")).toBeInTheDocument();
    // Skrzynka NIE pokazuje ekranu „moduł wyłączony": trasa hostuje dalej
    // powiadomienia i zgody, więc użytkownik nie zostaje ze ślepym zaułkiem.
    expect(screen.queryByText(communityPl.community.disabled.title)).toBeNull();
  });

  it("zgody pozostają dostępne mimo wyłączonego czatu", async () => {
    await mountMessages("/messages?view=consents");

    expect(screen.getByTestId("notifications-center").getAttribute("data-mode")).toBe("consents");
    expect(screen.getByRole("tab", { name: TAB_CONSENTS }).getAttribute("aria-selected")).toBe(
      "true",
    );
  });
});

describe("trasa /messages - zakładka Zapytania", () => {
  it("bez rekordów zakładki nie ma, a `?view=requests` spada na powiadomienia", async () => {
    h.expertRequests = [];
    h.views = [zofiaThread()];
    await mountMessages("/messages?view=requests");

    expect(screen.queryByRole("tab", { name: TAB_REQUESTS })).toBeNull();
    expect(screen.queryByTestId("expert-requests-inbox")).toBeNull();
    expect(screen.getByTestId("notifications-center").getAttribute("data-mode")).toBe("inbox");
  });

  it("zakładka pojawia się wyłącznie dla ODBIORCY zapytań", async () => {
    h.expertRequests = [{ status: "approved" }];
    h.views = [zofiaThread()];
    await mountMessages("/messages?view=requests");

    // Pytamy o skrzynkę „otrzymane" - „wysłane" ma inne uprawnienia.
    expect(h.expertRequestBoxes).toContain("received");
    expect(h.expertRequestBoxes).not.toContain("sent");
    expect(screen.getByRole("tab", { name: TAB_REQUESTS }).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(screen.getByTestId("expert-requests-inbox")).toBeInTheDocument();
  });

  it("otwarcie rozmowy z zapytania przełącza panel na czat i zapisuje ją w adresie", async () => {
    h.expertRequests = [{ status: "approved" }];
    h.views = [zofiaThread()];
    const view = await mountMessages("/messages?view=requests");

    const inbox = h.expertInbox;
    if (!inbox) throw new Error("test: atrapa ExpertRequestsInbox nie dostała propsów");
    act(() => inbox.onOpenConversation(CHAT_IDS.conversation));

    await waitFor(() => expect(screen.getByTestId("chat-window")).toBeInTheDocument());
    // `search: { c }` podmienia CAŁY zestaw parametrów, więc `view=requests`
    // znika - i to ono przełącza panel z listy zapytań na rozmowę.
    expect(view.search()).toEqual({ c: CHAT_IDS.conversation });
  });
});

describe("trasa /messages - deep link i wybór rozmowy", () => {
  it("`?c=<id>` otwiera dokładnie tę rozmowę, nie pierwszą z listy", async () => {
    h.views = [zofiaThread(), janThread()];
    await mountMessages(`/messages?c=${CHAT_IDS.otherConversation}`);

    await waitFor(() => expect(screen.getByTestId("chat-window")).toBeInTheDocument());
    expect(h.chatWindow?.conversationId).toBe(CHAT_IDS.otherConversation);
    expect(h.chatWindow?.variant).toBe("page");
  });

  it("`?c=<demo>` otwiera wątek demonstracyjny, a nie realne okno rozmowy", async () => {
    h.views = [zofiaThread()];
    await mountMessages(`/messages?c=${DEMO_BOT_ID}`);

    expect(screen.getByTestId("demo-bot-chat")).toBeInTheDocument();
    expect(screen.queryByTestId("chat-window")).toBeNull();
    expect(h.demoBotChat?.lang).toBe("pl");
  });

  it("wybór rozmowy zapisuje ją w adresie i NIE dokłada wpisu do historii", async () => {
    h.views = [zofiaThread(), janThread()];
    const view = await mountMessages("/messages");
    const history = routerProbe().history;

    // Punkt odniesienia: zwykłe przejście DOKŁADA wpis do historii...
    const before = history.length;
    await view.navigate("/messages?view=chats");
    expect(history.length).toBe(before + 1);
    const afterPush = history.length;

    // ...a otwarcie rozmowy z listy - nie, bo idzie z `replace: true`.
    fireEvent.click(screen.getByRole("button", { name: /Jan Przykładowy/ }));
    await waitFor(() => expect(view.search().c).toBe(CHAT_IDS.otherConversation));
    expect(history.length).toBe(afterPush);
    // `search: { c }` podaje CAŁY zestaw parametrów, więc `view` odpada.
    expect(view.search()).toEqual({ c: CHAT_IDS.otherConversation });
    expect(h.chatWindow?.conversationId).toBe(CHAT_IDS.otherConversation);
  });

  it("bez deep linku pulpit otwiera najnowszy AKTYWNY wątek, nigdy zarchiwizowanego", async () => {
    h.views = [archivedThread(ARCHIVED_ONE, "Archiwum jeden"), janThread()];
    await mountMessages();

    await waitFor(() => expect(h.chatWindow?.conversationId).toBe(CHAT_IDS.otherConversation));
    // Auto-otwarcie nie dotyka adresu - deep link zostaje pusty.
    expect(screen.queryByTestId("chat-window")).toBeInTheDocument();
  });

  it("lista rozmów jest podpięta pod aktualizacje na żywo", async () => {
    h.views = [zofiaThread()];
    await mountMessages();
    expect(h.chatListRealtime).toHaveBeenCalled();
  });
});

describe("trasa /messages - zakładki widoków", () => {
  it("przełączenie na powiadomienia zapisuje widok w adresie i zachowuje otwartą rozmowę", async () => {
    h.views = [zofiaThread()];
    const view = await mountMessages(`/messages?c=${CHAT_IDS.conversation}`);

    fireEvent.click(screen.getByRole("tab", { name: TAB_NOTIFICATIONS }));
    await waitFor(() => expect(view.search().view).toBe("notifications"));
    // Zakładki scalają parametry (`...prev`), więc otwarta rozmowa przeżywa
    // wycieczkę do powiadomień.
    expect(view.search()).toEqual({ c: CHAT_IDS.conversation, view: "notifications" });
    expect(screen.getByTestId("notifications-center").getAttribute("data-mode")).toBe("inbox");

    fireEvent.click(screen.getByRole("tab", { name: chatPl.chat.messages }));
    // Czat jest widokiem domyślnym - w adresie nie zostaje po nim parametr.
    await waitFor(() => expect(view.search()).toEqual({ c: CHAT_IDS.conversation }));
    expect(screen.getByTestId("chat-window")).toBeInTheDocument();
  });
});

describe("trasa /messages - filtry listy rozmów", () => {
  beforeEach(() => {
    h.views = [zofiaThread(), janThread(), circleThread()];
  });

  it("filtr nieprzeczytanych zostawia tylko wątki z licznikiem", async () => {
    await mountMessages();
    fireEvent.click(screen.getByRole("radio", { name: chatPl.chat.filters.unread }));

    expect(screen.getByText("Jan Przykładowy")).toBeInTheDocument();
    expect(screen.queryByText("Zofia Testowa")).toBeNull();
    expect(screen.queryByText("Krąg energetyczny")).toBeNull();
  });

  it("filtr kręgów zostawia tylko rozmowy grupowe", async () => {
    await mountMessages();
    fireEvent.click(screen.getByRole("radio", { name: chatPl.chat.filters.circles }));

    expect(screen.getByText("Krąg energetyczny")).toBeInTheDocument();
    expect(screen.queryByText("Zofia Testowa")).toBeNull();
    expect(screen.queryByText("Jan Przykładowy")).toBeNull();
  });

  it("fraza zawęża listę po nazwie rozmowy", async () => {
    await mountMessages();
    fireEvent.change(filterInput(), { target: { value: "jan" } });

    await waitFor(() => expect(screen.queryByText("Zofia Testowa")).toBeNull());
    expect(screen.getByText("Jan Przykładowy")).toBeInTheDocument();
    expect(screen.queryByText("Krąg energetyczny")).toBeNull();
  });

  it("pusta skrzynka mówi wprost, że rozmów nie ma", async () => {
    h.views = [];
    await mountMessages();

    expect(screen.getByText(chatPl.chat.noConversations)).toBeInTheDocument();
    expect(screen.queryByText(chatPl.chat.filters.empty)).toBeNull();
  });

  it("gdy filtr wyciął wszystko, komunikat dotyczy FILTRA, nie pustej skrzynki", async () => {
    h.views = [zofiaThread()];
    await mountMessages();
    fireEvent.click(screen.getByRole("radio", { name: chatPl.chat.filters.unread }));

    expect(screen.getByText(chatPl.chat.filters.empty)).toBeInTheDocument();
    expect(screen.queryByText(chatPl.chat.noConversations)).toBeNull();
  });
});

describe("trasa /messages - sekcja archiwum", () => {
  it("rozwijanie ogłasza stan, pokazuje licznik i podmienia listę", async () => {
    h.views = [
      zofiaThread(),
      archivedThread(ARCHIVED_ONE, "Archiwum jeden"),
      archivedThread(ARCHIVED_TWO, "Archiwum dwa"),
    ];
    await mountMessages();

    const toggle = screen.getByRole("button", {
      name: new RegExp(chatPl.chat.menu.archivedSection),
    });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.textContent).toContain("2");
    expect(screen.queryByText("Archiwum jeden")).toBeNull();

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Archiwum jeden")).toBeInTheDocument();
    expect(screen.getByText("Archiwum dwa")).toBeInTheDocument();
    // Archiwum ZASTĘPUJE listę aktywną, nie dokleja się do niej.
    expect(screen.queryByText("Zofia Testowa")).toBeNull();
  });

  it("bez zarchiwizowanych wątków sekcja w ogóle się nie pojawia", async () => {
    h.views = [zofiaThread()];
    await mountMessages();

    expect(
      screen.queryByRole("button", { name: new RegExp(chatPl.chat.menu.archivedSection) }),
    ).toBeNull();
  });
});

describe("trasa /messages - wyszukiwanie w treści wiadomości", () => {
  beforeEach(() => {
    h.views = [zofiaThread(), janThread()];
    h.searchHits = [
      messageSearchHit({
        id: "hit-1",
        conversation_id: CHAT_IDS.otherConversation,
        snippet: "[[[zofia]]] pisała o terminie",
      }),
    ];
  });

  it("sekcja wyników pojawia się dopiero od progu długości frazy", async () => {
    await mountMessages();
    const section = () => screen.queryByRole("region", { name: chatPl.chat.search.sectionTitle });

    expect(section()).toBeNull();

    fireEvent.change(filterInput(), {
      target: { value: "zofia".slice(0, MESSAGE_SEARCH_MIN_CHARS - 1) },
    });
    expect(section()).toBeNull();

    fireEvent.change(filterInput(), {
      target: { value: "zofia".slice(0, MESSAGE_SEARCH_MIN_CHARS) },
    });
    expect(section()).toBeInTheDocument();
    // Skrzynka szuka po WSZYSTKICH rozmowach (null), nie po otwartej.
    expect(h.searchArgs.at(-1)?.conversationId).toBeNull();
  });

  it("klik w trafienie otwiera właściwą rozmowę i przekazuje żądanie skoku", async () => {
    const view = await mountMessages();
    fireEvent.change(filterInput(), {
      target: { value: "zofia".slice(0, MESSAGE_SEARCH_MIN_CHARS) },
    });

    const section = screen.getByRole("region", { name: chatPl.chat.search.sectionTitle });
    fireEvent.click(within(section).getByRole("button"));

    await waitFor(() => expect(h.chatWindow?.conversationId).toBe(CHAT_IDS.otherConversation));
    expect(h.chatWindow?.jumpRequest).toEqual({ id: "hit-1", nonce: 1 });
    expect(view.search()).toEqual({ c: CHAT_IDS.otherConversation });
  });
});

describe("trasa /messages - wątek demonstracyjny", () => {
  it("jest widoczny tylko dla filtra wszystkich rozmów i pustej frazy", async () => {
    h.views = [zofiaThread(), janThread()];
    await mountMessages();
    const demoRow = () => screen.queryByRole("button", { name: chatPl.chat.demoBot.openAria });

    expect(demoRow()).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: chatPl.chat.filters.unread }));
    expect(demoRow()).toBeNull();

    fireEvent.click(screen.getByRole("radio", { name: chatPl.chat.filters.all }));
    expect(demoRow()).toBeInTheDocument();

    // Fraza filtruje REALNE rozmowy - wirtualny wiersz nie może jej udawać.
    fireEvent.change(filterInput(), { target: { value: "jan" } });
    await waitFor(() => expect(demoRow()).toBeNull());
  });

  it("otwarcie wątku demo zapisuje jego identyfikator w adresie", async () => {
    h.views = [zofiaThread()];
    const view = await mountMessages();

    fireEvent.click(screen.getByRole("button", { name: chatPl.chat.demoBot.openAria }));
    await waitFor(() => expect(screen.getByTestId("demo-bot-chat")).toBeInTheDocument());
    expect(view.search()).toEqual({ c: DEMO_BOT_ID });
  });
});

describe("trasa /messages - tryb nowej rozmowy", () => {
  it("przełącznik podmienia listę na wyszukiwarkę osób i wraca", async () => {
    h.views = [zofiaThread()];
    await mountMessages();

    fireEvent.click(screen.getByRole("button", { name: chatPl.chat.newMessage }));
    expect(screen.getByTestId("new-chat-search")).toBeInTheDocument();
    expect(screen.queryByLabelText(chatPl.chat.searchConversations)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: chatPl.chat.newMessage }));
    expect(screen.queryByTestId("new-chat-search")).toBeNull();
    expect(screen.getByLabelText(chatPl.chat.searchConversations)).toBeInTheDocument();
  });

  it("rozpoczęta rozmowa z wyszukiwarki wraca do listy i ląduje w adresie", async () => {
    h.views = [zofiaThread()];
    const view = await mountMessages();

    fireEvent.click(screen.getByRole("button", { name: chatPl.chat.newMessage }));
    const search = h.newChatSearch;
    if (!search) throw new Error("test: atrapa NewChatSearch nie dostała propsów");
    act(() => search.onOpened(CHAT_IDS.otherConversation));

    await waitFor(() => expect(view.search()).toEqual({ c: CHAT_IDS.otherConversation }));
    expect(screen.queryByTestId("new-chat-search")).toBeNull();
    expect(h.chatWindow?.conversationId).toBe(CHAT_IDS.otherConversation);
  });
});
