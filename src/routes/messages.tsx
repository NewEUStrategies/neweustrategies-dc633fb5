// Full Messages inbox (Messenger-style two-pane). Registered users only:
// content is gated by AuthGate and the route is noindex + robots-disallowed,
// so nothing here is visible to anonymous visitors or crawlers.
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import {
  Archive,
  Bell,
  ChevronDown,
  ChevronRight,
  MessagesSquare,
  Search,
  ShieldCheck,
  SquarePen,
  UsersRound,
  X,
} from "lucide-react";
import { AuthGate } from "@/components/profile/AuthGate";
import { ChatWindow } from "@/components/chat/ChatWindow";
import { ConversationListItem } from "@/components/chat/ConversationListItem";
import { DEMO_BOT_ID, DemoBotChat } from "@/components/chat/DemoBotChat";
import { DemoBotListItem } from "@/components/chat/DemoBotListItem";
import { GroupCreateDialog } from "@/components/chat/GroupCreateDialog";
import { NewChatSearch } from "@/components/chat/NewChatSearch";
import { NotificationsCenter } from "@/components/notifications/NotificationsCenter";
import { useAuth } from "@/hooks/useAuth";
import { conversationDisplay, isGroupView } from "@/lib/chat/display";
import { useNicknames } from "@/lib/chat/nicknames";
import { useOnlineUsers } from "@/lib/chat/presence";
import {
  splitArchived,
  useChatListRealtime,
  useChatUnreadTotal,
  useConversations,
  usePeerProfiles,
} from "@/lib/chat/useConversations";
import { useUnreadCount } from "@/lib/notifications/useNotifications";
import type { ChatLang } from "@/lib/chat/time";
import { cn } from "@/lib/utils";

type MessagesView = "chats" | "notifications" | "consents";
type ListFilter = "all" | "unread" | "circles";

interface MessagesSearch {
  c?: string;
  view?: MessagesView;
}

export const Route = createFileRoute("/messages")({
  // Auth-only inbox + noindex/robots-disallowed: SSR would render the AuthGate
  // spinner on the server and MessagesInner on the client (session lives in
  // localStorage), guaranteeing a hydration mismatch. ssr:false skips SSR for
  // this route entirely — client hydrates from a clean placeholder, no diff.
  ssr: false,
  component: MessagesPage,
  validateSearch: (search: Record<string, unknown>): MessagesSearch => {
    const c = typeof search.c === "string" && search.c.length > 0 ? search.c : undefined;
    const rawView = typeof search.view === "string" ? search.view : undefined;
    const view: MessagesView | undefined =
      rawView === "notifications"
        ? "notifications"
        : rawView === "consents"
          ? "consents"
          : rawView === "chats"
            ? "chats"
            : undefined;
    return { c, view };
  },
  head: () => ({
    meta: [{ title: "Wiadomości" }, { name: "robots", content: "noindex, nofollow" }],
  }),
});

function MessagesPage() {
  return (
    <AuthGate>
      <MessagesInner />
    </AuthGate>
  );
}

function MessagesInner() {
  const { t, i18n } = useTranslation();
  const lang: ChatLang = i18n.language === "en" ? "en" : "pl";
  const { user } = useAuth();
  const { c, view } = Route.useSearch();
  const navigate = Route.useNavigate();
  const activeView: MessagesView =
    view === "notifications" ? "notifications" : view === "consents" ? "consents" : "chats";
  const unreadNotifQ = useUnreadCount();
  const unreadNotif = unreadNotifQ.data ?? 0;

  const setActiveView = (v: MessagesView) => {
    void navigate({
      search: (prev: MessagesSearch) => ({
        ...prev,
        view: v === "chats" ? undefined : v,
      }),
      replace: true,
    });
  };

  useChatListRealtime();
  const online = useOnlineUsers();
  const conversationsQ = useConversations();
  const nicknamesQ = useNicknames();
  const views = useMemo(() => conversationsQ.data ?? [], [conversationsQ.data]);
  const peerIds = useMemo(
    () => [...new Set(views.flatMap((v) => v.peers.map((p) => p.user_id)))],
    [views],
  );
  const peersQ = usePeerProfiles(peerIds);

  const [selected, setSelected] = useState<string | null>(c ?? null);
  const [mode, setMode] = useState<"list" | "new">("list");
  const [groupCreateOpen, setGroupCreateOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [listFilter, setListFilter] = useState<ListFilter>("all");
  const [showArchived, setShowArchived] = useState(false);
  const unreadTotal = useChatUnreadTotal();

  const { active: activeViews, archived: archivedViews } = useMemo(
    () => splitArchived(views),
    [views],
  );

  // Deep link (?c=...) wins; afterwards default to the newest active thread
  // on desktop (never auto-open something the user deliberately archived).
  useEffect(() => {
    if (c) setSelected(c);
  }, [c]);
  useEffect(() => {
    if (!selected && activeViews.length > 0 && window.matchMedia("(min-width: 768px)").matches) {
      setSelected(activeViews[0]?.conversation.id ?? null);
    }
  }, [activeViews, selected]);

  const openConversation = (id: string) => {
    setSelected(id);
    setMode("list");
    void navigate({ search: { c: id }, replace: true });
  };

  const normalizedFilter = filter.trim().toLowerCase();
  const sourceViews = showArchived ? archivedViews : activeViews;
  const searched = normalizedFilter
    ? sourceViews.filter((v) =>
        conversationDisplay(v, peersQ.data, undefined, nicknamesQ.data?.get(v.conversation.id))
          .name.toLowerCase()
          .includes(normalizedFilter),
      )
    : sourceViews;
  // WhatsApp-style quick filters layered on top of the text search.
  const filtered = searched.filter((v) =>
    listFilter === "unread"
      ? v.me.unread_count > 0
      : listFilter === "circles"
        ? isGroupView(v)
        : true,
  );

  if (!user) return null;

  const viewTabs: Array<{
    id: MessagesView;
    label: string;
    icon: typeof MessagesSquare;
    badge?: number;
  }> = [
    { id: "chats", label: t("chat.messages"), icon: MessagesSquare, badge: unreadTotal },
    {
      id: "notifications",
      label: t("notifications.title", { defaultValue: "Powiadomienia" }),
      icon: Bell,
      badge: unreadNotif,
    },
    {
      id: "consents",
      label: t("notifications.consents.tab", { defaultValue: "Zgody" }),
      icon: ShieldCheck,
    },
  ];

  return (
    <div className="container mx-auto max-w-6xl px-2 py-4 sm:px-4 sm:py-6">
      {/* Segmentowane taby widoków: pigułka z aktywnym tłem i licznikami. */}
      <div
        role="tablist"
        aria-label={t("chat.messages")}
        className="mb-3 inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-md border border-border/60 bg-muted/40 p-1 text-sm"
      >
        {viewTabs.map(({ id, label, icon: Icon, badge }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={activeView === id}
            onClick={() => setActiveView(id)}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-md px-3.5 py-1.5 font-medium transition-all",
              activeView === id
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:bg-background/50 hover:text-foreground",
            )}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden />
            {label}
            {!!badge && badge > 0 && (
              <span
                className="ml-0.5 inline-flex h-4 min-w-[16px] items-center justify-center rounded-md bg-[var(--brand)] px-1 text-[10px] font-semibold leading-none text-white"
                aria-label={t("chat.unread", { count: badge })}
              >
                {badge > 99 ? "99+" : badge}
              </span>
            )}
          </button>
        ))}
      </div>
      <div className="flex h-[calc(100dvh-230px)] max-h-[920px] min-h-[520px] overflow-hidden rounded-md border border-border/60 bg-card shadow-md">
        {activeView === "notifications" ? (
          <div className="w-full min-w-0">
            <NotificationsCenter mode="inbox" />
          </div>
        ) : activeView === "consents" ? (
          <div className="w-full min-w-0">
            <NotificationsCenter mode="consents" />
          </div>
        ) : (
          <>
            {/* Left pane: conversation list on its own surface (modern split). */}
            <aside
              className={cn(
                "flex w-full min-w-0 flex-col border-border/60 bg-muted/20 md:w-[340px] md:shrink-0 md:border-r",
                selected && "hidden md:flex",
              )}
            >
              <div className="flex items-center justify-between px-3.5 pb-1 pt-3">
                <h1 className="flex items-center gap-2 text-lg font-bold tracking-tight">
                  {t("chat.messages")}
                  {unreadTotal > 0 && (
                    <span
                      className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-md bg-[var(--brand)] px-1.5 text-[11px] font-semibold leading-none text-white"
                      aria-label={t("chat.unread", { count: unreadTotal })}
                    >
                      {unreadTotal > 99 ? "99+" : unreadTotal}
                    </span>
                  )}
                </h1>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setGroupCreateOpen(true)}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground motion-safe:transition-transform motion-safe:hover:scale-105"
                    aria-haspopup="dialog"
                    aria-label={t("chat.group.new")}
                    title={t("chat.group.new")}
                  >
                    <UsersRound className="h-4 w-4" aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode(mode === "new" ? "list" : "new")}
                    className={cn(
                      "inline-flex h-9 w-9 items-center justify-center rounded-md transition-colors motion-safe:transition-transform motion-safe:hover:scale-105",
                      mode === "new"
                        ? "bg-[var(--brand)] text-white hover:opacity-90"
                        : "bg-background text-foreground shadow-sm hover:bg-muted",
                    )}
                    aria-label={t("chat.newMessage")}
                    title={t("chat.newMessage")}
                  >
                    {mode === "new" ? (
                      <X className="h-4 w-4" aria-hidden />
                    ) : (
                      <SquarePen className="h-4 w-4" aria-hidden />
                    )}
                  </button>
                </div>
              </div>

              {mode === "new" ? (
                <NewChatSearch onOpened={openConversation} />
              ) : (
                <>
                  <div className="px-2.5 pb-1.5 pt-2">
                    <label className="relative block">
                      <Search
                        className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                        aria-hidden
                      />
                      <input
                        type="text"
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                        placeholder={t("chat.searchConversations")}
                        aria-label={t("chat.searchConversations")}
                        className="h-10 w-full rounded-md border border-input bg-background !pl-[42px] pr-4 text-sm shadow-sm transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      />
                    </label>
                  </div>
                  {/* Szybkie filtry listy (WhatsApp): wszystkie / nieprzeczytane / kręgi. */}
                  <div
                    role="radiogroup"
                    aria-label={t("chat.filters.label")}
                    className="flex items-center gap-1 px-2.5 pb-2"
                  >
                    {(
                      [
                        { id: "all", label: t("chat.filters.all") },
                        { id: "unread", label: t("chat.filters.unread") },
                        { id: "circles", label: t("chat.filters.circles") },
                      ] as Array<{ id: ListFilter; label: string }>
                    ).map(({ id, label }) => (
                      <button
                        key={id}
                        type="button"
                        role="radio"
                        aria-checked={listFilter === id}
                        onClick={() => setListFilter(id)}
                        className={cn(
                          "rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors",
                          listFilter === id
                            ? "bg-[var(--brand)]/15 text-brand-ink"
                            : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground",
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
                    {/* Wirtualny wątek "demo bot" - lokalny podgląd UI, bez DB.
                        Widoczny tylko dla filtra "wszystkie" i braku szukanej
                        frazy, żeby nie kolidował z filtrowaniem realnej listy. */}
                    {!showArchived && listFilter === "all" && normalizedFilter === "" && (
                      <DemoBotListItem
                        active={selected === DEMO_BOT_ID}
                        onOpen={() => {
                          setSelected(DEMO_BOT_ID);
                          setMode("list");
                          void navigate({ search: { c: DEMO_BOT_ID }, replace: true });
                        }}
                      />
                    )}
                    {archivedViews.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setShowArchived((v) => !v)}
                        aria-expanded={showArchived}
                        className={cn(
                          "mb-1 flex w-full items-center gap-2 rounded-[6px] px-2 py-2 text-left text-[12px] font-medium transition-colors",
                          showArchived ? "bg-muted text-foreground" : "hover:bg-muted/60",
                        )}
                      >
                        {showArchived ? (
                          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                        )}
                        <Archive className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                        {t("chat.menu.archivedSection")}
                        <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">
                          {archivedViews.length}
                        </span>
                      </button>
                    )}
                    {conversationsQ.isLoading ? (
                      // Skeleton listy zamiast "..." - bez skoku layoutu.
                      <ul className="flex flex-col gap-0.5" aria-hidden>
                        {[0, 1, 2, 3, 4].map((i) => (
                          <li key={i} className="flex items-center gap-2.5 px-2 py-2">
                            <span className="skeleton-shimmer h-10 w-10 shrink-0 rounded-[6px]" />
                            <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                              <span className="skeleton-shimmer h-3 w-2/5 rounded-md" />
                              <span className="skeleton-shimmer h-2.5 w-4/5 rounded-md" />
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : filtered.length === 0 ? (
                      <div className="flex flex-col items-center gap-2 p-6 text-center">
                        <MessagesSquare className="h-6 w-6 text-muted-foreground/50" aria-hidden />
                        <p className="text-sm text-muted-foreground">
                          {searched.length > 0
                            ? t("chat.filters.empty")
                            : t("chat.noConversations")}
                        </p>
                        {searched.length === 0 && (
                          <button
                            type="button"
                            onClick={() => setMode("new")}
                            className="mt-1 rounded-md bg-[var(--brand)] px-3 py-1.5 text-[11px] font-medium text-white transition-opacity hover:opacity-90"
                          >
                            {t("chat.newMessage")}
                          </button>
                        )}
                      </div>
                    ) : (
                      // key po filtrze: przełączenie chipa odtwarza wejścia
                      // wierszy (stagger przez --row-i, wyłączany reduced motion).
                      <ul
                        key={`${listFilter}:${showArchived ? "arch" : "act"}`}
                        className="flex flex-col gap-0.5"
                      >
                        {filtered.map((view, index) => (
                          <li
                            key={view.conversation.id}
                            className="chat-row-enter"
                            style={{ "--row-i": index } as CSSProperties}
                          >
                            <ConversationListItem
                              view={view}
                              profiles={peersQ.data}
                              nicknames={nicknamesQ.data?.get(view.conversation.id)}
                              onlineUsers={online}
                              myUserId={user.id}
                              lang={lang}
                              active={view.conversation.id === selected}
                              onOpen={() => openConversation(view.conversation.id)}
                            />
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </>
              )}
            </aside>

            {/* Right pane: active thread (animated swap) or the hero state. */}
            <div className={cn("min-w-0 flex-1", !selected && "hidden md:block")}>
              {selected === DEMO_BOT_ID ? (
                <div key={DEMO_BOT_ID} className="chat-pane-in h-full min-h-0">
                  <DemoBotChat
                    lang={lang}
                    onBack={() => {
                      setSelected(null);
                      void navigate({ search: {}, replace: true });
                    }}
                  />
                </div>
              ) : selected ? (
                <div key={selected} className="chat-pane-in h-full min-h-0">
                  <ChatWindow
                    conversationId={selected}
                    variant="page"
                    autoFocus={false}
                    onBack={() => {
                      setSelected(null);
                      void navigate({ search: {}, replace: true });
                    }}
                  />
                </div>
              ) : (
                <div className="chat-hero-surface flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
                  <div className="relative h-24 w-32" aria-hidden>
                    <span
                      className="chat-hero-bubble absolute left-0 top-6 h-10 w-16 rounded-[10px] rounded-bl-[3px] bg-muted shadow-sm"
                      style={{ "--hero-rot": "-4deg" } as CSSProperties}
                    />
                    <span
                      className="chat-hero-bubble absolute right-0 top-0 h-10 w-20 rounded-[10px] rounded-br-[3px] shadow-sm"
                      style={
                        {
                          "--hero-rot": "3deg",
                          "--hero-delay": "0.6s",
                          background:
                            "linear-gradient(135deg, var(--chat-user-from), var(--chat-user-to))",
                        } as CSSProperties
                      }
                    />
                    <span
                      className="chat-hero-bubble absolute bottom-0 left-8 h-8 w-14 rounded-[10px] rounded-bl-[3px] bg-background shadow-sm ring-1 ring-border/60"
                      style={{ "--hero-rot": "-2deg", "--hero-delay": "1.1s" } as CSSProperties}
                    />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold tracking-tight">
                      {t("chat.emptyHero.title")}
                    </h2>
                    <p className="mx-auto mt-1 max-w-[320px] text-sm text-muted-foreground">
                      {t("chat.emptyHero.subtitle")}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    <button
                      type="button"
                      onClick={() => setMode("new")}
                      className="inline-flex items-center gap-1.5 rounded-md bg-[var(--brand)] px-4 py-2 text-[13px] font-medium text-white shadow-sm transition-opacity hover:opacity-90 motion-safe:transition-transform motion-safe:hover:scale-[1.03]"
                    >
                      <SquarePen className="h-3.5 w-3.5" aria-hidden />
                      {t("chat.emptyHero.cta")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setGroupCreateOpen(true)}
                      className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-background px-4 py-2 text-[13px] font-medium shadow-sm transition-colors hover:bg-muted"
                      aria-haspopup="dialog"
                    >
                      <UsersRound className="h-3.5 w-3.5" aria-hidden />
                      {t("chat.emptyHero.ctaGroup")}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
      <GroupCreateDialog
        open={groupCreateOpen}
        onClose={() => setGroupCreateOpen(false)}
        onCreated={openConversation}
      />
    </div>
  );
}
