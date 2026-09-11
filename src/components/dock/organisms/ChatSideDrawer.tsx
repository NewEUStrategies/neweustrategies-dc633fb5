// Organizm: wysuwana skrzynka czatu z lewej krawędzi ekranu (jak na nagraniu).
// Lewa kolumna to lista rozmów (wyszukiwarka osób + nowa grupa), a po
// wybraniu rozmowy obok otwiera się pełne okno czatu. Reużywamy istniejących
// komponentów czatu - nie budujemy drugiej implementacji wiadomości.
//
// ── OKNO ROZMOWY I DIALOG GRUPY SĄ LENIWE. ZMIERZONE ─────────────────────
// Oba były importowane STATYCZNIE, choć oba renderują się warunkowo: okno
// dopiero po wybraniu wątku, dialog dopiero po kliknięciu „nowa grupa".
// Skutek policzony na domknięciu importów: otwarcie SAMEJ skrzynki ciągnęło
// 80 plików / 592,7 kB źródła. Po zdjęciu tych dwóch krawędzi zostaje
// 17 plików / 141,5 kB - o 76% mniej kodu przed pierwszym malowaniem listy
// rozmów. To była najdroższa pozycja w całej odczuwanej powolności doku:
// użytkownik klikał „Czat", żeby zobaczyć LISTĘ, a płacił za pełne okno
// wiadomości, którego w tym momencie nie ma na ekranie.
//
// Koszt nie przenosi się na kliknięcie wątku, bo paczka okna rozgrzewa się
// na ZAMIAR - najechanie kursorem albo wejście focusem na wiersz listy
// (`prefetchChatWindow`). W praktyce kod jest już na miejscu, gdy padnie klik.
import "@/lib/i18n-chat";
import { lazy, Suspense, useDeferredValue, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Inbox,
  Minus,
  MessageCircle,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  SquarePen,
  UsersRound,
  X,
} from "lucide-react";
import { Link } from "@tanstack/react-router";

import {
  loadChatWindow,
  loadGroupCreateDialog,
  prefetchChatWindow,
  prefetchGroupCreateDialog,
} from "@/components/chat/chatWindowChunk";
import { ConversationListItem } from "@/components/chat/ConversationListItem";
import { ExpertRequestsInbox } from "@/components/chat/ExpertRequestsInbox";
import { NewChatSearch } from "@/components/chat/NewChatSearch";
import { useAuth } from "@/hooks/useAuth";
import { conversationDisplay, isGroupView } from "@/lib/chat/display";
import { useNicknames } from "@/lib/chat/nicknames";
import { useOnlineUsers } from "@/lib/chat/presence";
import {
  splitArchived,
  useChatListRealtime,
  useConversations,
  usePeerProfiles,
} from "@/lib/chat/useConversations";
import { useMyExpertRequests } from "@/lib/chat/useExpertRequests";
import { minimizedChatsStore, useMinimizedChats } from "@/lib/chat/minimizedChats";
import type { ChatLang } from "@/lib/chat/time";
import type { DockPresenceState } from "@/lib/dock/dockMotion";
import { ensureI18n as ensureExpertRequestI18n } from "@/lib/i18n-expert-request";
import { cn } from "@/lib/utils";
import "@/lib/i18n-dock";

const ChatWindow = lazy(loadChatWindow);
const GroupCreateDialog = lazy(loadGroupCreateDialog);

type Tab = "chats" | "new" | "requests";

export interface ChatSideDrawerProps {
  onClose: () => void;
  /** Wysokość paska doku - panel nie może pod nim znikać. */
  bottomOffset: number;
  /**
   * Żądanie otwarcia konkretnej rozmowy (np. przycisk "Napisz" w sieci).
   * Sygnałem jest TOŻSAMOŚĆ obiektu - efekt niżej zależy od `openRequest`,
   * więc świeży literał wystarcza i nie trzeba tu znacznika czasu.
   */
  openRequest?: { conversationId: string } | null;
  /**
   * Faza wejścia/wyjścia z `useDockPresence`. Przejęcie tej fazy z zewnątrz
   * jest tym, co daje skrzynce ruch przy ZAMYKANIU: dopóki komponent sam
   * przestawiał sobie flagę `entered` po zamontowaniu, wyjścia nie było
   * wcale - rodzic zdejmował węzeł w tej samej klatce, w której zamknięcie
   * padło.
   */
  presenceState: DockPresenceState;
}

export function ChatSideDrawer({
  onClose,
  bottomOffset,
  openRequest,
  presenceState,
}: ChatSideDrawerProps) {
  ensureExpertRequestI18n();
  const { t, i18n } = useTranslation();
  const lang: ChatLang = i18n.language?.startsWith("en") ? "en" : "pl";
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("chats");

  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [inboxCollapsed, setInboxCollapsed] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  // Dialog grupy zostaje zamontowany po pierwszym otwarciu, żeby Radix dograł
  // animację zamknięcia - ta sama zasada, co w granicy leniwej kasy.
  const [groupEverOpened, setGroupEverOpened] = useState(false);

  useChatListRealtime();
  const online = useOnlineUsers();
  const conversationsQ = useConversations();
  const nicknamesQ = useNicknames();

  // Skrzynka zapytań eksperckich: RPC zwraca rekordy tylko wtedy, gdy
  // zalogowany użytkownik jest ODBIORCĄ - czyli jest ekspertem. Zakładkę
  // pokazujemy więc wyłącznie takim osobom, bez dodatkowego zapytania o rolę.
  const expertRequestsQ = useMyExpertRequests("received");
  const expertRequests = useMemo(() => expertRequestsQ.data ?? [], [expertRequestsQ.data]);
  const isExpertRecipient = expertRequests.length > 0;
  const pendingExpertRequests = useMemo(
    () => expertRequests.reduce((sum, row) => sum + (row.status === "pending" ? 1 : 0), 0),
    [expertRequests],
  );

  // Gdy zakładka zniknie (np. brak zapytań), nie zostawiamy pustego widoku.
  useEffect(() => {
    if (!isExpertRecipient) setTab((current) => (current === "requests" ? "chats" : current));
  }, [isExpertRecipient]);

  // WEJŚCIE PANELU NIE JEST JUŻ TUTAJ. Gałąź `main` miała w tym miejscu
  // `requestAnimationFrame(() => setEntered(true))` i lokalną flagę `entered`;
  // fazę wejścia I WYJŚCIA przejął `useDockPresence` w `WorkspaceDock`, który
  // podaje ją propem `presenceState`. Zostawienie obu dałoby dwa równoległe
  // źródła prawdy o tym samym ruchu, a wyjścia nadal by nie było.

  // Żądanie z zewnątrz (chatDockBus) - od razu wybieramy wskazaną rozmowę
  // I rozgrzewamy paczkę okna, bo za chwilę będzie potrzebna.
  useEffect(() => {
    if (!openRequest?.conversationId) return;
    prefetchChatWindow();
    setSelected(openRequest.conversationId);
  }, [openRequest]);

  useEffect(() => {
    if (groupOpen) setGroupEverOpened(true);
  }, [groupOpen]);

  // ESCAPE OBSŁUGUJE `WorkspaceDock` (`useDockDismiss`), nie ten komponent.
  // Własny nasłuch na `window` bez sprawdzenia `defaultPrevented` zamykał
  // skrzynkę także wtedy, gdy Escape miał zamknąć wyłącznie dialog tworzenia
  // grupy otwarty W ŚRODKU skrzynki.

  const { active } = useMemo(() => splitArchived(conversationsQ.data ?? []), [conversationsQ.data]);
  const peerIds = useMemo(
    () => [...new Set(active.flatMap((view) => view.peers.map((peer) => peer.user_id)))],
    [active],
  );
  const peersQ = usePeerProfiles(peerIds);

  // Filtrowanie w niskim priorytecie - pisanie w wyszukiwarce pozostaje płynne.
  const deferredQuery = useDeferredValue(query);
  const needle = deferredQuery.trim().toLowerCase();
  const groupLabel = t("chat.group.circle");
  const rows = useMemo(() => {
    if (needle.length === 0) return active;
    return active.filter((view) =>
      conversationDisplay(view, peersQ.data, groupLabel).name.toLowerCase().includes(needle),
    );
  }, [active, needle, peersQ.data, groupLabel]);

  const direct = useMemo(() => rows.filter((view) => !isGroupView(view)), [rows]);
  const groups = useMemo(() => rows.filter((view) => isGroupView(view)), [rows]);

  // Kliknięcie pigułki w doku prosi o otwarcie konkretnej rozmowy.
  const { requested } = useMinimizedChats();
  useEffect(() => {
    if (!requested) return;
    prefetchChatWindow();
    setSelected(requested);
    setTab("chats");
    minimizedChatsStore.clearRequest();
  }, [requested]);

  const selectedView = useMemo(
    () => active.find((item) => item.conversation.id === selected),
    [active, selected],
  );

  const selectedName = useMemo(() => {
    if (!selectedView) return "";
    return conversationDisplay(selectedView, peersQ.data, groupLabel).name;
  }, [selectedView, peersQ.data, groupLabel]);

  const selectedAvatarUrl = useMemo(() => {
    if (!selectedView || isGroupView(selectedView) || !peersQ.data) return null;
    const peerUserId = selectedView.peers[0]?.user_id;
    if (!peerUserId) return null;
    return peersQ.data.get(peerUserId)?.avatar_url ?? null;
  }, [selectedView, peersQ.data]);

  if (!user) return null;

  const minimizeSelected = () => {
    if (!selected) return;
    minimizedChatsStore.minimize({
      id: selected,
      name: selectedName || t("dock.chat.title"),
      avatarUrl: selectedAvatarUrl,
    });
    setInboxCollapsed(false);
    setSelected(null);
  };

  const closeSelected = () => {
    setInboxCollapsed(false);
    setSelected(null);
  };

  const openConversation = (conversationId: string) => {
    setSelected(conversationId);
    setTab("chats");
  };

  const renderRows = (views: typeof rows) => (
    <ul className="divide-y divide-border/60">
      {views.map((view) => (
        <li key={view.conversation.id}>
          <ConversationListItem
            view={view}
            profiles={peersQ.data}
            nicknames={nicknamesQ.data?.get(view.conversation.id)}
            onlineUsers={online}
            myUserId={user.id}
            lang={lang}
            active={selected === view.conversation.id}
            onOpen={() => openConversation(view.conversation.id)}
            onIntent={prefetchChatWindow}
          />
        </li>
      ))}
    </ul>
  );

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-40 flex"
      style={{ bottom: `${Math.max(bottomOffset, 0)}px` }}
    >
      <div
        role="dialog"
        aria-modal="false"
        aria-label={t("dock.chat.title")}
        data-state={presenceState}
        data-mobile-view={selected ? "conversation" : "inbox"}
        className={cn(
          // `.wd-drawer` niesie CAŁY ruch (wejście i wyjście) z warstwy CSS
          // doku. Poprzednia wersja pinowała `will-change-transform` na
          // stałe - to trzyma warstwę kompozytora przez całe życie panelu,
          // choć ruch trwa ćwierć sekundy.
          "wd-drawer pointer-events-auto h-full w-full flex-col border-r border-border/70 sm:w-[320px] sm:max-w-[85vw]",
          "bg-card/95 shadow-xl backdrop-blur-md supports-[backdrop-filter]:bg-card/80",
          selected ? "hidden sm:flex" : "flex",
          inboxCollapsed && "sm:hidden",
        )}
      >
        <header className="flex items-center gap-2 border-b border-border px-3 py-2.5">
          <MessageCircle className="h-4 w-4 text-primary" aria-hidden />
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{t("dock.chat.title")}</h2>
          <Link
            to="/messages"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-[11px] font-medium text-primary hover:underline"
          >
            {t("dock.chat.openAll")}
          </Link>
          <button
            type="button"
            onClick={selected ? () => setInboxCollapsed(true) : onClose}
            aria-label={t(selected ? "dock.chat.hideInbox" : "dock.close")}
            title={t(selected ? "dock.chat.hideInbox" : "dock.close")}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </header>

        <div className="border-b border-border p-2">
          <label className="relative block">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("dock.chat.searchPlaceholder")}
              aria-label={t("dock.chat.searchPlaceholder")}
              className="w-full rounded-md border border-input bg-background py-1.5 pl-8 pr-2 text-sm"
            />
          </label>
          <div className="mt-2 flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setTab("chats")}
              aria-pressed={tab === "chats"}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium",
                tab === "chats"
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted",
              )}
            >
              <MessageCircle className="h-3.5 w-3.5" aria-hidden />
              {t("dock.chat.title")}
            </button>
            <button
              type="button"
              onClick={() => setTab("new")}
              aria-pressed={tab === "new"}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium",
                tab === "new"
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted",
              )}
            >
              <SquarePen className="h-3.5 w-3.5" aria-hidden />
              {t("dock.chat.start")}
            </button>
            {isExpertRecipient ? (
              <button
                type="button"
                onClick={() => setTab("requests")}
                aria-pressed={tab === "requests"}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium",
                  tab === "requests"
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted",
                )}
              >
                <Inbox className="h-3.5 w-3.5" aria-hidden />
                {t("expertRequest.inbox.tab")}
                {pendingExpertRequests > 0 ? (
                  <span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground">
                    {pendingExpertRequests}
                  </span>
                ) : null}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setGroupOpen(true)}
              onPointerEnter={prefetchGroupCreateDialog}
              onPointerDown={prefetchGroupCreateDialog}
              onFocus={prefetchGroupCreateDialog}
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted"
            >
              <UsersRound className="h-3.5 w-3.5" aria-hidden />
              {t("chat.group.create")}
            </button>
          </div>
        </div>

        {/* Bezpieczny obszar na dole: ostatni wiersz listy nigdy nie wchodzi
            pod dolny pasek doku ani krawędź ekranu (safe-area). */}
        <div className="min-h-0 flex-1 overflow-y-auto pb-[max(1rem,env(safe-area-inset-bottom))]">
          {tab === "requests" ? (
            <ExpertRequestsInbox onOpenConversation={openConversation} className="p-2" />
          ) : tab === "new" ? (
            <NewChatSearch onOpened={openConversation} />
          ) : conversationsQ.isError ? (
            <p className="p-4 text-sm text-muted-foreground">{t("dock.error")}</p>
          ) : rows.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">{t("dock.chat.empty")}</p>
          ) : (
            <>
              {direct.length > 0 ? (
                <section>
                  <h3 className="bg-muted/50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {t("dock.chat.sections.direct")}
                  </h3>
                  {renderRows(direct)}
                </section>
              ) : null}
              {groups.length > 0 ? (
                <section>
                  <h3 className="bg-muted/50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {t("dock.chat.sections.groups")}
                  </h3>
                  {renderRows(groups)}
                </section>
              ) : null}
            </>
          )}
        </div>
      </div>

      {/* `animate-fade-in` STĄD ZNIKŁO, bo tej klasy NIE MA w projekcie:
          `tw-animate-css` daje `animate-in` + modyfikator `fade-in`, a nie
          `animate-fade-in`, i nic w `styles.css` jej nie definiuje. Panel
          rozmowy nie miał więc żadnej animacji - tylko jej pozór w znaczniku.
          Ruch idzie teraz warstwą `.wd-panel` (transform + opacity). */}
      {selected ? (
        <div
          data-state={presenceState}
          data-mobile-chat-conversation
          className="wd-panel pointer-events-auto flex h-full w-full min-w-0 flex-col bg-background/95 shadow-lg backdrop-blur-md supports-[backdrop-filter]:bg-background/85 sm:w-[380px] sm:max-w-[90vw] sm:border-r sm:border-border/70"
        >
          <div className="flex items-center gap-1 border-b border-border/70 px-2 py-1">
            <button
              type="button"
              onClick={() => setInboxCollapsed((collapsed) => !collapsed)}
              aria-label={t(inboxCollapsed ? "dock.chat.showInbox" : "dock.chat.hideInbox")}
              aria-expanded={!inboxCollapsed}
              title={t(inboxCollapsed ? "dock.chat.showInbox" : "dock.chat.hideInbox")}
              className="hidden rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground sm:inline-flex"
            >
              {inboxCollapsed ? (
                <PanelLeftOpen className="h-4 w-4" aria-hidden />
              ) : (
                <PanelLeftClose className="h-4 w-4" aria-hidden />
              )}
            </button>
            <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-muted-foreground">
              {selectedName}
            </span>
            <button
              type="button"
              onClick={minimizeSelected}
              aria-label={t("dock.chat.minimize")}
              title={t("dock.chat.minimize")}
              className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <Minus className="h-4 w-4" aria-hidden />
            </button>
            <button
              type="button"
              onClick={closeSelected}
              aria-label={t("dock.chat.closeConversation")}
              title={t("dock.chat.closeConversation")}
              className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
          {/* Własna granica, nie wspólna z listą: dociąganie okna nie może
              wygasić listy rozmów, która JUŻ jest na ekranie. Zastępnik ma
              geometrię wątku, więc podmiana na treść nie rusza układu. */}
          <Suspense
            fallback={
              <div
                role="status"
                aria-live="polite"
                aria-busy="true"
                className="min-h-0 flex-1 space-y-3 p-4"
              >
                <div className="skeleton-shimmer h-4 w-1/3 rounded-[6px]" />
                <div className="skeleton-shimmer ml-auto h-12 w-2/3 rounded-[10px]" />
                <div className="skeleton-shimmer h-16 w-3/4 rounded-[10px]" />
                <div className="skeleton-shimmer ml-auto h-10 w-1/2 rounded-[10px]" />
                <div className="skeleton-shimmer h-14 w-2/3 rounded-[10px]" />
                <span className="sr-only">{t("dock.loading")}</span>
              </div>
            }
          >
            <ChatWindow
              key={selected}
              conversationId={selected}
              variant="page"
              onBack={closeSelected}
              onClose={closeSelected}
              className="min-h-0 flex-1"
            />
          </Suspense>
        </div>
      ) : null}

      {/* Dialog grupy montuje się dopiero po pierwszym otwarciu - dopóki nikt
          go nie zawołał, jego paczka nie jest pobierana wcale. */}
      {groupEverOpened ? (
        <Suspense fallback={null}>
          <GroupCreateDialog
            open={groupOpen}
            onClose={() => setGroupOpen(false)}
            onCreated={(conversationId) => {
              setGroupOpen(false);
              openConversation(conversationId);
            }}
          />
        </Suspense>
      ) : null}
    </div>
  );
}
