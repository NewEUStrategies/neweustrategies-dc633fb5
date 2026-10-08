// TOASTY NOWYCH WIADOMOŚCI W PRZESTRZENI ROBOCZEJ CZŁONKA.
//
// Regresja, którą ten plik zamyka: hak `useIncomingChatToasts` montował
// wyłącznie `ChatBell`, a tego od przeniesienia rozmów do doku nie renderuje
// nic. Kanał realtime nie powstawał, więc zalogowany członek nie dostawał
// toasta o żadnej nowej wiadomości - i żaden test tego nie widział, bo testy
// haka renderowały go w izolacji, a test paska go atrapował.
//
// Dlatego tu PRAWDZIWE są: pasek, hak, hub kanałów, szyna `chatDockBus`,
// magazyn zminimalizowanych rozmów i odczyt ustawień modułów (zasiany w cache
// zapytania `site_settings`, tak jak robi to loader korzenia). Atrapą jest
// tylko klient Supabase (kanały, odczyt wyciszenia, profil nadawcy), sonner
// (zapis toastów) i leniwa skrzynka czatu, która - jak prawdziwe `ChatWindow`
// - wystawia znacznik `data-active-conversation` otwartej rozmowy.
//
// RODO: rozmówcy to identyfikatory z `CHAT_IDS`, treści zmyślone.
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/test/i18nReal";
import { CHAT_IDS, messageRow, ok, peerProfile } from "@/test/chat/fixtures";
import type { RealtimeStub, SupabaseFromStub } from "@/test/supabase";
import type { MessageRow } from "@/lib/chat/types";

interface ToastCall {
  readonly title: string;
  readonly options: { description?: string; action?: { label: string; onClick: () => void } };
}

const h = vi.hoisted(() => ({
  uid: "user-me" as string | null,
  pathname: "/",
  toasts: [] as ToastCall[],
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
  useNavigate: () => () => Promise.resolve(),
}));

vi.mock("@/components/atoms/AppLink", async () => ({
  AppLink: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

vi.mock("sonner", () => ({
  toast: Object.assign(
    (title: string, options: ToastCall["options"]) => {
      h.toasts.push({ title, options });
    },
    { error: vi.fn(), success: vi.fn() },
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
// `mutedUntilMs` (bramka wyciszenia toasta) zostaje prawdziwe.
vi.mock("@/lib/chat/useConversations", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/chat/useConversations")>()),
  useConversations: () => ({ data: [] }),
  usePeerProfiles: () => ({ data: undefined }),
}));

import { WorkspaceDock } from "../WorkspaceDock";
import { openChatWindow } from "@/lib/chat/chatDockBus";
import { minimizedChatsStore } from "@/lib/chat/minimizedChats";
import { invalidateMuteCache } from "@/lib/chat/useIncomingChatToasts";
import { COMMUNITY_MODULES_KEY } from "@/lib/community/modulesSettings";
import { siteSettingsQueryOptions } from "@/lib/useSiteSetting";

const realtime = () => h.realtime as RealtimeStub;
const from = () => h.from as SupabaseFromStub;

/** Kanał wiadomości przychodzących (hub: tabela, zdarzenie, filtr nadawcy). */
const INCOMING = `hub:public|messages|INSERT|sender_id=neq.${CHAT_IDS.me}:`;

/**
 * Klient zapytań z ZASIANYMI ustawieniami serwisu - tak, jak zostawia je
 * loader korzenia. Świeże dane nie są pobierane ponownie, więc każde
 * żądanie widoczne w atrapie byłoby kosztem dołożonym przez pasek.
 */
function settingsClient(chatEnabled = true): QueryClient {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(siteSettingsQueryOptions.queryKey, {
    [COMMUNITY_MODULES_KEY]: { chat_enabled: chatEnabled },
  });
  return client;
}

/** Przełącznik modułu zapisany w panelu - React Query powiadamia w makrozadaniu. */
async function setChatEnabled(client: QueryClient, chatEnabled: boolean): Promise<void> {
  await act(async () => {
    client.setQueryData(siteSettingsQueryOptions.queryKey, {
      [COMMUNITY_MODULES_KEY]: { chat_enabled: chatEnabled },
    });
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

function emitInsert(row: MessageRow): void {
  const [channel] = realtime().liveChannels(INCOMING);
  if (!channel) throw new Error("test: kanał wiadomości przychodzących nie istnieje");
  act(() => {
    channel.emitPostgres("messages", { eventType: "INSERT", new: row });
  });
}

/** Odczekanie na asynchroniczną obsługę (wyciszenie -> profil -> toast). */
async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
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

let seq = 0;
/** Unikalny identyfikator - zbiór widzianych wiadomości i cache wyciszeń żyją w module. */
function fresh(prefix: string): string {
  seq += 1;
  return `${prefix}-dock-${seq}`;
}

const originalObserver = globalThis.ResizeObserver;

beforeEach(() => {
  h.uid = CHAT_IDS.me;
  h.pathname = "/";
  h.toasts = [];
  h.rpc = vi.fn(async () => ok([peerProfile({ display_name: "Zofia Testowa" })]));
  realtime().reset();
  from().reset();
  from().setResponse("conversation_participants", ok({ muted_until: null }));
  invalidateMuteCache();
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
  it("zalogowany członek dostaje JEDEN kanał, filtrowany po nadawcy, bez żadnego zapytania", () => {
    renderDock();

    const live = realtime().liveChannels(INCOMING);
    expect(live).toHaveLength(1);
    expect(live[0]?.subscribeCount).toBe(1);
    expect(live[0]?.listeners.find((l) => l.type === "postgres_changes")?.filter).toMatchObject({
      event: "INSERT",
      schema: "public",
      table: "messages",
      filter: `sender_id=neq.${CHAT_IDS.me}`,
    });
    // Bramka modułu czyta zasiane ustawienia, a sam kanał niczego nie pobiera
    // - do pierwszej wiadomości toasty nie kosztują żadnego żądania.
    expect(from().chains).toHaveLength(0);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("nawigacja przerysowuje pasek, ale nie otwiera drugiego kanału", () => {
    const { rerenderDock } = renderDock();
    h.pathname = "/network";
    rerenderDock();
    h.pathname = "/clubs";
    rerenderDock();

    expect(realtime().channels).toHaveLength(1);
    expect(realtime().liveChannels(INCOMING)).toHaveLength(1);
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
    // Klient TanStack Start hydratuje w `<StrictMode>`: w dev efekt biegnie
    // dwa razy, czyli zwolnienie i ponowny montaż w jednej chwili.
    const client = settingsClient();
    render(
      <StrictMode>
        <QueryClientProvider client={client}>
          <WorkspaceDock />
        </QueryClientProvider>
      </StrictMode>,
    );

    expect(realtime().liveChannels(INCOMING)).toHaveLength(1);
    emitInsert(messageRow({ id: fresh("msg"), conversation_id: fresh("conv") }));
    await waitFor(() => expect(h.toasts).toHaveLength(1));
  });

  it("zejście paska (wejście do /admin, wylogowanie) zwalnia kanał", () => {
    const { unmount } = renderDock();
    expect(realtime().liveChannels(INCOMING)).toHaveLength(1);

    unmount();
    expect(realtime().liveChannels(INCOMING)).toHaveLength(0);
  });

  it("moduł czatu wyłączony w panelu: pasek działa, kanału nie ma, włączenie go otwiera", async () => {
    const { client } = renderDock(settingsClient(false));

    expect(document.querySelector("[data-workspace-dock]")).not.toBeNull();
    expect(realtime().channels).toHaveLength(0);

    await setChatEnabled(client, true);
    expect(realtime().liveChannels(INCOMING)).toHaveLength(1);

    await setChatEnabled(client, false);
    expect(realtime().liveChannels(INCOMING)).toHaveLength(0);
  });
});

describe("toast i akcja „Otwórz”", () => {
  it("wiadomość od rozmówcy daje toast, a jego akcja otwiera skrzynkę na tej rozmowie", async () => {
    const conversationId = fresh("conv");
    renderDock();

    emitInsert(
      messageRow({ id: fresh("msg"), conversation_id: conversationId, body: "Masz chwilę?" }),
    );
    await waitFor(() => expect(h.toasts).toHaveLength(1));
    expect(h.toasts[0]?.title).toBe("Zofia Testowa");
    expect(h.toasts[0]?.options.description).toBe("Masz chwilę?");
    expect(screen.queryByTestId("panel-chat")).toBeNull();

    await act(async () => {
      h.toasts[0]?.options.action?.onClick();
    });
    const drawer = await screen.findByTestId("panel-chat");
    expect(drawer.getAttribute("data-active-conversation")).toBe(conversationId);
  });

  it("rozmowa otwarta w skrzynce i skupiona nie dostaje toasta, inna - dostaje", async () => {
    const openId = fresh("conv-open");
    const otherId = fresh("conv-other");
    renderDock();
    await openConversationInDrawer(openId);

    emitInsert(messageRow({ id: fresh("msg"), conversation_id: openId }));
    await settle();
    expect(h.toasts).toHaveLength(0);

    emitInsert(messageRow({ id: fresh("msg"), conversation_id: otherId }));
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

    emitInsert(messageRow({ id: fresh("msg"), conversation_id: conversationId }));
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

  it("własna wiadomość (echo z drugiej karty) nie daje toasta", async () => {
    renderDock();
    emitInsert(
      messageRow({ id: fresh("msg"), conversation_id: fresh("conv"), sender_id: CHAT_IDS.me }),
    );
    await settle();
    expect(h.toasts).toHaveLength(0);
  });
});
