// TOASTY NOWYCH WIADOMOŚCI W PRZESTRZENI ROBOCZEJ CZŁONKA.
//
// Regresja, którą ten plik zamyka: hak `useIncomingChatToasts` montował
// wyłącznie `ChatBell`, a tego od przeniesienia rozmów do doku nie renderuje
// nic. Kanał realtime nie powstawał, więc zalogowany członek nie dostawał
// toasta o żadnej nowej wiadomości - i żaden test tego nie widział, bo testy
// haka renderowały go w izolacji, a test paska go atrapował.
//
// Dlatego tu PRAWDZIWE są: pasek, hak, hub kanałów, szyna `chatDockBus`,
// magazyn zminimalizowanych rozmów, odczyt ustawień modułów (zasiany w cache
// zapytania `site_settings`, tak jak robi to loader korzenia) i odczyt
// preferencji powiadomień (zasiany pod kluczem, który wypełnia dzwonek
// w nagłówku). Atrapą jest klient Supabase (kanały, podgląd rozmowy, profil
// nadawcy), sonner (zapis toastów), nawigacja routera i leniwa skrzynka
// czatu, która - jak prawdziwe `ChatWindow` - wystawia znacznik
// `data-active-conversation` otwartej rozmowy.
//
// Źródłem toastów są WŁASNE wiersze uczestnika (`conversation_participants`,
// `user_id=eq.<uid>`), nie tabela `messages`, której RLS przepuszcza
// personelowi cały tenant. Wiadomość emulujemy tak, jak zapisuje ją trigger
// `messages_after_insert`: rozmowa dostaje `last_message_*`, wiersz odbiorcy
// podbity licznik i `updated_at` z tej samej transakcji.
//
// RODO: rozmówcy to identyfikatory z `CHAT_IDS`, treści zmyślone.
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/test/i18nReal";
import {
  CHAT_IDS,
  conversationRow,
  fail,
  ok,
  participantRow,
  peerProfile,
} from "@/test/chat/fixtures";
import type { RealtimeStub, SupabaseFromStub, SupabaseResult } from "@/test/supabase";
import type { ConversationRow, ParticipantRow } from "@/lib/chat/types";
import type { NotificationPreferences } from "@/lib/notifications/preferences";

interface ToastCall {
  readonly title: string;
  readonly options: {
    id?: string;
    description?: string;
    action?: { label: string; onClick: () => void };
  };
}

const h = vi.hoisted(() => ({
  uid: "user-me" as string | null,
  pathname: "/",
  toasts: [] as ToastCall[],
  dismissed: [] as string[],
  navigations: [] as unknown[],
  conversations: new Map<string, unknown>(),
  rpc: vi.fn(),
  realtime: null as unknown,
  from: null as unknown,
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: h.uid ? { id: h.uid } : null }),
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useRouterState: <T,>({ select }: { select: (state: unknown) => T }): T =>
    select({ location: { pathname: h.pathname } }),
  useNavigate: () => (options: unknown) => {
    h.navigations.push(options);
    return Promise.resolve();
  },
}));

vi.mock("@/components/atoms/AppLink", async () => ({
  AppLink: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

vi.mock("sonner", () => ({
  toast: Object.assign(
    (title: string, options: ToastCall["options"]) => {
      h.toasts.push({ title, options });
      return options.id;
    },
    {
      error: vi.fn(),
      success: vi.fn(),
      dismiss: (id: string) => {
        h.dismissed.push(id);
      },
    },
  ),
}));

vi.mock("@/integrations/supabase/client", async () => {
  const fixtures = await import("@/test/chat/fixtures");
  const realtime = fixtures.realtimeStub();
  const from = fixtures.supabaseFromStub();
  h.realtime = realtime;
  h.from = from;
  return {
    supabase: {
      channel: realtime.channel,
      removeChannel: realtime.removeChannel,
      from: from.from,
      rpc: (fn: string, args: unknown) => h.rpc(fn, args),
    },
  };
});

// Skrzynka czatu: zamiast pełnego organizmu - węzeł ze znacznikiem otwartej
// rozmowy, dokładnie tym, który renderuje `ChatWindow` (oba warianty).
vi.mock("../panelChunks", () => ({
  prefetchDockPanel: () => {},
  loadTodoPanel: () => Promise.resolve({ default: () => null }),
  loadNotesPanel: () => Promise.resolve({ default: () => null }),
  loadSavedPanel: () => Promise.resolve({ default: () => null }),
  loadCalendarPanel: () => Promise.resolve({ default: () => null }),
  loadChatSideDrawer: () =>
    Promise.resolve({
      default: (props: { openRequest?: { conversationId: string } | null }) => (
        <div
          data-testid="panel-chat"
          data-active-conversation={props.openRequest?.conversationId}
        />
      ),
    }),
}));

vi.mock("@/lib/dock/prefetchDockData", () => ({ prefetchDockData: () => {} }));
vi.mock("@/lib/dock/useTodos", () => ({ useOpenTodoCount: () => 0 }));
vi.mock("@/components/mobile/bottomBar/LiveTabBadge", () => ({ LiveTabBadge: () => null }));
vi.mock("@/components/chat/chatWindowChunk", () => ({ prefetchChatWindow: () => {} }));
// Szyna zminimalizowanych rozmów dociąga awatary z listy rozmów - bez sieci.
// Specyfikacja kanału własnych wierszy i `mutedUntilMs` zostają prawdziwe.
vi.mock("@/lib/chat/useConversations", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/chat/useConversations")>()),
  useConversations: () => ({ data: [] }),
  usePeerProfiles: () => ({ data: undefined }),
}));

import { WorkspaceDock } from "../WorkspaceDock";
import { openChatWindow } from "@/lib/chat/chatDockBus";
import { minimizedChatsStore } from "@/lib/chat/minimizedChats";
import { COMMUNITY_MODULES_KEY } from "@/lib/community/modulesSettings";
import { DEFAULT_NOTIFICATION_PREFERENCES } from "@/lib/notifications/preferences";
import { useNotificationPreferences as useBellPreferences } from "@/lib/notifications/useNotifications";
import { siteSettingsQueryOptions } from "@/lib/useSiteSetting";

const realtime = () => h.realtime as RealtimeStub;
const from = () => h.from as SupabaseFromStub;

/** Kanał własnych wierszy uczestnika (hub: tabela, każde zdarzenie, filtr właściciela). */
const PARTICIPANTS = `hub:public|conversation_participants|*|user_id=eq.${CHAT_IDS.me}:`;

/**
 * Klucz preferencji powiadomień w cache (`useNotificationPreferences`), ten
 * sam, który wypełnia dzwonek w nagłówku. Gdyby się rozjechał, pasek
 * wysłałby własne żądanie - test „bez żadnego zapytania" by to wychwycił.
 */
const prefsKey = (uid: string) => ["notifications", "preferences", uid] as const;

/**
 * Klient zapytań z ZASIANYMI ustawieniami serwisu (loader korzenia)
 * i preferencjami powiadomień (dzwonek). Świeże dane nie są pobierane
 * ponownie, więc każde żądanie widoczne w atrapie byłoby kosztem paska.
 */
function settingsClient(
  chatEnabled = true,
  prefs: Partial<NotificationPreferences> | null = {},
): QueryClient {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(siteSettingsQueryOptions.queryKey, {
    [COMMUNITY_MODULES_KEY]: { chat_enabled: chatEnabled },
  });
  if (prefs) {
    client.setQueryData(prefsKey(CHAT_IDS.me), { ...DEFAULT_NOTIFICATION_PREFERENCES, ...prefs });
  }
  return client;
}

/** Zmiana w cache, o której React Query powiadamia w makrozadaniu. */
async function updateCache(change: () => void): Promise<void> {
  await act(async () => {
    change();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function renderDock(client: QueryClient = settingsClient()) {
  const tree = () => (
    <QueryClientProvider client={client}>
      <WorkspaceDock />
    </QueryClientProvider>
  );
  const view = render(tree());
  return { ...view, client, rerenderDock: () => view.rerender(tree()) };
}

let clock = Date.parse("2026-10-08T12:00:00.000Z");
let seq = 0;
/** Unikalny identyfikator - stan rozmów żyje w module przez całą sesję. */
function fresh(prefix: string): string {
  seq += 1;
  return `${prefix}-dock-${seq}`;
}

function emitParticipant(row: Partial<ParticipantRow>): void {
  const [channel] = realtime().liveChannels(PARTICIPANTS);
  if (!channel) throw new Error("test: kanał wierszy uczestnika nie istnieje");
  act(() => {
    channel.emitPostgres("conversation_participants", {
      eventType: "UPDATE",
      new: participantRow({ user_id: CHAT_IDS.me, ...row }),
    });
  });
}

/** Wiadomość od rozmówcy w zapisie triggera `messages_after_insert`. */
function deliver(
  conversationId: string,
  options: { unread?: number; body?: string; sender?: string } = {},
): void {
  clock += 1000;
  const at = new Date(clock).toISOString();
  h.conversations.set(
    conversationId,
    conversationRow({
      id: conversationId,
      last_message_at: at,
      last_message_preview: options.body ?? "Masz chwilę?",
      last_message_sender: options.sender ?? CHAT_IDS.peer,
    }),
  );
  emitParticipant({
    conversation_id: conversationId,
    unread_count: options.unread ?? 1,
    updated_at: at,
  });
}

/** Odczekanie na asynchroniczną obsługę (podgląd rozmowy -> profil -> toast). */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** Rozmowa otwarta w skrzynce, karta widoczna i skupiona. */
async function openConversationInDrawer(conversationId: string): Promise<void> {
  await act(async () => {
    openChatWindow({ conversationId });
  });
  const drawer = await screen.findByTestId("panel-chat");
  await waitFor(() => expect(drawer.getAttribute("data-active-conversation")).toBe(conversationId));
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
}

const originalObserver = globalThis.ResizeObserver;

beforeEach(() => {
  h.uid = CHAT_IDS.me;
  h.pathname = "/";
  h.toasts = [];
  h.dismissed = [];
  h.navigations = [];
  h.conversations = new Map();
  h.rpc = vi.fn(async () => ok([peerProfile({ display_name: "Zofia Testowa" })]));
  realtime().reset();
  from().reset();
  from().setResponse("conversations", (chain) => {
    const [, id] = chain.argsOf("eq") ?? [];
    return ok((h.conversations.get(String(id)) as ConversationRow | undefined) ?? null);
  });
  minimizedChatsStore.reset();
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  globalThis.ResizeObserver = originalObserver;
  delete document.documentElement.dataset.mbb;
  delete document.documentElement.dataset.mbbOwner;
  document.documentElement.style.removeProperty("--mbb-space");
});

describe("montaż: raz na sesję, tylko dla członka", () => {
  it("zalogowany członek dostaje JEDEN kanał własnych wierszy, bez żadnego zapytania", () => {
    renderDock();

    const live = realtime().liveChannels(PARTICIPANTS);
    expect(live).toHaveLength(1);
    expect(live[0]?.subscribeCount).toBe(1);
    expect(live[0]?.listeners.find((l) => l.type === "postgres_changes")?.filter).toMatchObject({
      schema: "public",
      table: "conversation_participants",
      filter: `user_id=eq.${CHAT_IDS.me}`,
    });
    // Ustawienia modułów i preferencje są w cache, a sam kanał niczego nie
    // pobiera - do pierwszej wiadomości toasty nie kosztują żadnego żądania.
    expect(from().chains).toHaveLength(0);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("bez preferencji w cache pasek wysyła JEDNO żądanie preferencji i nic poza nim", async () => {
    from().setResponse("notification_preferences", ok(null));
    renderDock(settingsClient(true, null));
    // Kanał powstaje dopiero po odpowiedzi preferencji (patrz niżej).
    await waitFor(() => expect(realtime().liveChannels(PARTICIPANTS)).toHaveLength(1));

    expect(from().chains.map((chain) => chain.table)).toEqual(["notification_preferences"]);
    expect(realtime().channels).toHaveLength(1);
  });

  it("nawigacja przerysowuje pasek, ale nie otwiera drugiego kanału", () => {
    const { rerenderDock } = renderDock();
    h.pathname = "/network";
    rerenderDock();
    h.pathname = "/clubs";
    rerenderDock();

    expect(realtime().channels).toHaveLength(1);
    expect(realtime().liveChannels(PARTICIPANTS)).toHaveLength(1);
  });

  it("gość: pasek się nie renderuje, zero kanałów, zero zapytań i zero RPC", () => {
    h.uid = null;
    const { container } = renderDock();

    expect(container.firstChild).toBeNull();
    expect(realtime().channels).toHaveLength(0);
    expect(from().chains).toHaveLength(0);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("StrictMode (podwójny efekt klienta) zostawia JEDEN żywy kanał, który doręcza", async () => {
    const client = settingsClient();
    render(
      <StrictMode>
        <QueryClientProvider client={client}>
          <WorkspaceDock />
        </QueryClientProvider>
      </StrictMode>,
    );

    expect(realtime().liveChannels(PARTICIPANTS)).toHaveLength(1);
    deliver(fresh("conv"));
    await waitFor(() => expect(h.toasts).toHaveLength(1));
  });

  it("zejście paska (wejście do /admin, wylogowanie) zwalnia kanał i zdejmuje toasty", async () => {
    const conversationId = fresh("conv-unmount");
    const { unmount } = renderDock();
    deliver(conversationId);
    await waitFor(() => expect(h.toasts).toHaveLength(1));

    unmount();
    expect(realtime().liveChannels(PARTICIPANTS)).toHaveLength(0);
    expect(h.dismissed).toEqual([`chat-incoming:${conversationId}`]);
  });

  it("moduł czatu wyłączony w panelu: pasek działa, kanału nie ma, włączenie go otwiera", async () => {
    const { client } = renderDock(settingsClient(false));

    expect(document.querySelector("[data-workspace-dock]")).not.toBeNull();
    expect(realtime().channels).toHaveLength(0);

    await updateCache(() =>
      client.setQueryData(siteSettingsQueryOptions.queryKey, {
        [COMMUNITY_MODULES_KEY]: { chat_enabled: true },
      }),
    );
    expect(realtime().liveChannels(PARTICIPANTS)).toHaveLength(1);

    await updateCache(() =>
      client.setQueryData(siteSettingsQueryOptions.queryKey, {
        [COMMUNITY_MODULES_KEY]: { chat_enabled: false },
      }),
    );
    expect(realtime().liveChannels(PARTICIPANTS)).toHaveLength(0);
  });
});

/** Odpowiedź preferencji trzymana do ręcznego zwolnienia - okno „jeszcze się wczytują”. */
function deferredPreferences() {
  let release: (result: SupabaseResult) => void = () => {};
  from().setResponse(
    "notification_preferences",
    () =>
      new Promise<SupabaseResult>((resolve) => {
        release = resolve;
      }),
  );
  return {
    resolve: async (result: SupabaseResult) => {
      await act(async () => {
        release(result);
      });
      await settle();
    },
  };
}

/** Dzwonek w nagłówku: ten sam odczyt preferencji, ścieżką ciężkiej warstwy powiadomień. */
function BellPreferencesProbe({ onData }: { onData: (value: unknown) => void }) {
  onData(useBellPreferences().data);
  return null;
}

describe("preferencje powiadomień (jak serwerowy fan-out)", () => {
  it("do czasu wczytania preferencji kanału nie ma - „wyłączone” nie daje join i leave", async () => {
    const prefs = deferredPreferences();
    renderDock(settingsClient(true, null));
    await settle();
    expect(from().chains.map((chain) => chain.table)).toEqual(["notification_preferences"]);
    expect(realtime().channels).toHaveLength(0);

    await prefs.resolve(ok({ enabled_message: false }));
    // Ani jednego kanału w całej sesji - wiadomość z okna wczytywania nie
    // mogła więc dać toasta wbrew jawnemu „wyłączone”.
    expect(realtime().channels).toHaveLength(0);
  });

  it("po wczytaniu „włączonych” kanał się otwiera i doręcza", async () => {
    const prefs = deferredPreferences();
    renderDock(settingsClient(true, null));
    await settle();
    expect(realtime().channels).toHaveLength(0);

    await prefs.resolve(ok(null));
    expect(realtime().liveChannels(PARTICIPANTS)).toHaveLength(1);
    deliver(fresh("conv-prefs-loaded"));
    await waitFor(() => expect(h.toasts).toHaveLength(1));
  });

  it("błąd odczytu preferencji nie wyłącza toastów (jak przy innych flagach)", async () => {
    from().setResponse("notification_preferences", fail("boom"));
    renderDock(settingsClient(true, null));
    await waitFor(() => expect(realtime().liveChannels(PARTICIPANTS)).toHaveLength(1));
  });

  it("pasek i dzwonek dzielą JEDEN wpis cache - jedno żądanie preferencji dla obu", async () => {
    from().setResponse("notification_preferences", ok({ allow_messages_from: "contacts" }));
    const client = settingsClient(true, null);
    const seen: unknown[] = [];
    render(
      <QueryClientProvider client={client}>
        <WorkspaceDock />
        <BellPreferencesProbe onData={(value) => seen.push(value)} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(realtime().liveChannels(PARTICIPANTS)).toHaveLength(1));

    expect(from().chainsFor("notification_preferences")).toHaveLength(1);
    expect(seen.at(-1)).toEqual({
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      allow_messages_from: "contacts",
    });
  });

  it("wyłączone „Wiadomości na czacie” (`enabled_message`): kanału nie ma", () => {
    renderDock(settingsClient(true, { enabled_message: false }));
    expect(realtime().channels).toHaveLength(0);
  });

  it("tryb cichy (`allow_messages_from = 'nobody'`): kanału nie ma", () => {
    renderDock(settingsClient(true, { allow_messages_from: "nobody" }));
    expect(realtime().channels).toHaveLength(0);
  });

  it("„tylko kontakty” nie wycisza wiadomości w istniejących wątkach", () => {
    renderDock(settingsClient(true, { allow_messages_from: "contacts" }));
    expect(realtime().liveChannels(PARTICIPANTS)).toHaveLength(1);
  });

  it("wyłączenie w trakcie sesji (np. w innej karcie) zamyka kanał i zdejmuje toasty", async () => {
    const conversationId = fresh("conv-prefs");
    const { client } = renderDock();
    deliver(conversationId);
    await waitFor(() => expect(h.toasts).toHaveLength(1));

    await updateCache(() =>
      client.setQueryData(prefsKey(CHAT_IDS.me), {
        ...DEFAULT_NOTIFICATION_PREFERENCES,
        enabled_message: false,
      }),
    );
    expect(realtime().liveChannels(PARTICIPANTS)).toHaveLength(0);
    expect(h.dismissed).toEqual([`chat-incoming:${conversationId}`]);
  });
});

describe("tylko własne rozmowy", () => {
  it("cudzy wiersz uczestnika (personel czyta cały tenant): zero toastów, zapytań i RPC", async () => {
    renderDock();
    const conversationId = fresh("conv-foreign");
    h.conversations.set(
      conversationId,
      conversationRow({ id: conversationId, last_message_preview: "prywatna treść" }),
    );
    emitParticipant({
      conversation_id: conversationId,
      user_id: CHAT_IDS.stranger,
      unread_count: 1,
    });
    await settle();

    expect(h.toasts).toHaveLength(0);
    expect(from().chains).toHaveLength(0);
    expect(h.rpc).not.toHaveBeenCalled();
    const tables = realtime()
      .liveChannels()
      .flatMap((channel) => channel.listeners.map((l) => l.filter.table));
    expect(tables).not.toContain("messages");
  });

  it("własna wiadomość (echo z drugiej karty) nie daje toasta", async () => {
    renderDock();
    deliver(fresh("conv"), { sender: CHAT_IDS.me });
    await settle();
    expect(h.toasts).toHaveLength(0);
  });
});

describe("toast i jego akcja", () => {
  it("wiadomość od rozmówcy daje toast, a akcja otwiera skrzynkę na tej rozmowie", async () => {
    const conversationId = fresh("conv");
    renderDock();

    deliver(conversationId, { body: "Masz chwilę?" });
    await waitFor(() => expect(h.toasts).toHaveLength(1));
    expect(h.toasts[0]?.title).toBe("Zofia Testowa");
    expect(h.toasts[0]?.options.description).toBe("Masz chwilę?");
    expect(h.toasts[0]?.options.action?.label).toBe("Otwórz rozmowę");
    expect(screen.queryByTestId("panel-chat")).toBeNull();

    await act(async () => {
      h.toasts[0]?.options.action?.onClick();
    });
    const drawer = await screen.findByTestId("panel-chat");
    expect(drawer.getAttribute("data-active-conversation")).toBe(conversationId);
    expect(h.navigations).toEqual([]);
  });

  it("otwarcie rozmowy szyną (np. „Napisz”) zdejmuje jej toast", async () => {
    const conversationId = fresh("conv-bus");
    renderDock();
    deliver(conversationId);
    await waitFor(() => expect(h.toasts).toHaveLength(1));

    await act(async () => {
      openChatWindow({ conversationId });
    });
    expect(h.dismissed).toEqual([`chat-incoming:${conversationId}`]);
  });

  it("rozmowa otwarta w skrzynce i skupiona nie dostaje toasta, inna - dostaje", async () => {
    const openId = fresh("conv-open");
    const otherId = fresh("conv-other");
    renderDock();
    await openConversationInDrawer(openId);

    deliver(openId);
    await settle();
    expect(h.toasts).toHaveLength(0);

    deliver(otherId);
    await waitFor(() => expect(h.toasts).toHaveLength(1));

    await act(async () => {
      h.toasts[0]?.options.action?.onClick();
    });
    await waitFor(() =>
      expect(screen.getByTestId("panel-chat").getAttribute("data-active-conversation")).toBe(
        otherId,
      ),
    );
  });

  it("zminimalizowaną rozmowę akcja przywraca przez magazyn sesji: pigułka znika z paska", async () => {
    const conversationId = fresh("conv-min");
    const otherId = fresh("conv-min-other");
    minimizedChatsStore.minimize({ id: otherId, name: "Krąg roboczy" });
    minimizedChatsStore.minimize({ id: conversationId, name: "Zofia Testowa" });
    renderDock();
    expect(document.querySelectorAll("[data-mobile-minimized-chats] > button")).toHaveLength(2);

    deliver(conversationId);
    await waitFor(() => expect(h.toasts).toHaveLength(1));

    await act(async () => {
      h.toasts[0]?.options.action?.onClick();
    });

    // Magazyn sesji: rozmowa zeszła z szyny, druga została, skrzynka dostała
    // prośbę o otwarcie - i oba rzędy paska rysują to samo.
    const snapshot = minimizedChatsStore.getSnapshot();
    expect(snapshot.minimized.map((chat) => chat.id)).toEqual([otherId]);
    expect(snapshot.requested).toBe(conversationId);
    expect(document.querySelectorAll("[data-mobile-minimized-chats] > button")).toHaveLength(1);
    const drawer = await screen.findByTestId("panel-chat");
    expect(drawer.getAttribute("data-active-conversation")).toBe(conversationId);
  });

  it("na /messages akcja przełącza rozmowę STRONY (`?c=`), zamiast otwierać skrzynkę nad nią", async () => {
    const conversationId = fresh("conv-page");
    const otherId = fresh("conv-page-other");
    h.pathname = "/messages";
    minimizedChatsStore.minimize({ id: otherId, name: "Krąg roboczy" });
    minimizedChatsStore.minimize({ id: conversationId, name: "Zofia Testowa" });
    renderDock();

    deliver(conversationId);
    await waitFor(() => expect(h.toasts).toHaveLength(1));
    await act(async () => {
      h.toasts[0]?.options.action?.onClick();
    });

    expect(h.navigations).toEqual([{ to: "/messages", search: { c: conversationId } }]);
    expect(screen.queryByTestId("panel-chat")).toBeNull();
    // Rozmowę pokazuje strona, więc jej pigułka schodzi z paska bez prośby
    // o otwarcie skrzynki; druga zostaje.
    const snapshot = minimizedChatsStore.getSnapshot();
    expect(snapshot.minimized.map((chat) => chat.id)).toEqual([otherId]);
    expect(snapshot.requested).toBeNull();
  });

  it("na /messages z otwartą skrzynką doku akcja ją zamyka - zostaje JEDNO okno rozmów", async () => {
    const conversationId = fresh("conv-page-drawer");
    h.pathname = "/messages";
    renderDock();

    // Członek otworzył „Czaty” w doku na stronie rozmów.
    const [chatsTab] = Array.from(
      document.querySelectorAll<HTMLElement>('[data-dock-tab="chats"]'),
    );
    if (!chatsTab) throw new Error("test: brak zakładki czatów");
    fireEvent.click(chatsTab);
    expect(await screen.findByTestId("panel-chat")).toBeTruthy();

    deliver(conversationId);
    await waitFor(() => expect(h.toasts).toHaveLength(1));
    await act(async () => {
      h.toasts[0]?.options.action?.onClick();
    });

    expect(h.navigations).toEqual([{ to: "/messages", search: { c: conversationId } }]);
    await waitFor(() => expect(screen.queryByTestId("panel-chat")).toBeNull());
    for (const tab of document.querySelectorAll('[data-dock-tab="chats"]')) {
      expect(tab.getAttribute("aria-expanded")).toBe("false");
    }
  });
});
