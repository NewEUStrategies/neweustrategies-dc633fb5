// Full Messages inbox (Messenger-style two-pane). Registered users only:
// content is gated by AuthGate and the route is noindex + robots-disallowed,
// so nothing here is visible to anonymous visitors or crawlers.
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bell, MessagesSquare, Search, SquarePen, X } from "lucide-react";
import { AuthGate } from "@/components/profile/AuthGate";
import { ChatWindow } from "@/components/chat/ChatWindow";
import { ConversationListItem } from "@/components/chat/ConversationListItem";
import { NewChatSearch } from "@/components/chat/NewChatSearch";
import { NotificationsCenter } from "@/components/notifications/NotificationsCenter";
import { useAuth } from "@/hooks/useAuth";
import { useOnlineUsers } from "@/lib/chat/presence";
import {
  useChatListRealtime,
  useConversations,
  usePeerProfiles,
} from "@/lib/chat/useConversations";
import { useUnreadCount } from "@/lib/notifications/useNotifications";
import type { ChatLang } from "@/lib/chat/time";
import { cn } from "@/lib/utils";

type MessagesView = "chats" | "notifications";

interface MessagesSearch {
  c?: string;
  view?: MessagesView;
}

export const Route = createFileRoute("/messages")({
  component: MessagesPage,
  validateSearch: (search: Record<string, unknown>): MessagesSearch => {
    const c = typeof search.c === "string" && search.c.length > 0 ? search.c : undefined;
    const rawView = typeof search.view === "string" ? search.view : undefined;
    const view: MessagesView | undefined =
      rawView === "notifications" ? "notifications" : rawView === "chats" ? "chats" : undefined;
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
  const activeView: MessagesView = view === "notifications" ? "notifications" : "chats";
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
  const views = useMemo(() => conversationsQ.data ?? [], [conversationsQ.data]);
  const peerIds = useMemo(
    () => [...new Set(views.flatMap((v) => v.peers.map((p) => p.user_id)))],
    [views],
  );
  const peersQ = usePeerProfiles(peerIds);

  const [selected, setSelected] = useState<string | null>(c ?? null);
  const [mode, setMode] = useState<"list" | "new">("list");
  const [filter, setFilter] = useState("");

  // Deep link (?c=...) wins; afterwards default to the newest thread on desktop.
  useEffect(() => {
    if (c) setSelected(c);
  }, [c]);
  useEffect(() => {
    if (!selected && views.length > 0 && window.matchMedia("(min-width: 768px)").matches) {
      setSelected(views[0]?.conversation.id ?? null);
    }
  }, [views, selected]);

  const openConversation = (id: string) => {
    setSelected(id);
    setMode("list");
    void navigate({ search: { c: id }, replace: true });
  };

  const normalizedFilter = filter.trim().toLowerCase();
  const filtered = normalizedFilter
    ? views.filter((v) => {
        const name = peersQ.data?.get(v.peers[0]?.user_id ?? "")?.display_name ?? "";
        return name.toLowerCase().includes(normalizedFilter);
      })
    : views;

  if (!user) return null;

  return (
    <div className="container mx-auto max-w-6xl px-2 py-4 sm:px-4 sm:py-6">
      <div
        role="tablist"
        aria-label={t("chat.messages")}
        className="mb-3 inline-flex items-center gap-1 rounded-[6px] border border-border/60 bg-muted/40 p-1 text-sm"
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeView === "chats"}
          onClick={() => setActiveView("chats")}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-[6px] px-3 py-1.5 font-medium transition-colors",
            activeView === "chats"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <MessagesSquare className="h-3.5 w-3.5" aria-hidden />
          {t("chat.messages")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeView === "notifications"}
          onClick={() => setActiveView("notifications")}
          className={cn(
            "relative inline-flex items-center gap-1.5 rounded-[6px] px-3 py-1.5 font-medium transition-colors",
            activeView === "notifications"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Bell className="h-3.5 w-3.5" aria-hidden />
          {t("notifications.title", { defaultValue: "Powiadomienia" })}
          {unreadNotif > 0 && (
            <span
              className="ml-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-[6px] bg-primary px-1 text-[10px] font-semibold text-primary-foreground"
              aria-label={t("notifications.unread", { count: unreadNotif })}
            >
              {unreadNotif > 99 ? "99+" : unreadNotif}
            </span>
          )}
        </button>
      </div>
      <div className="flex h-[calc(100dvh-260px)] min-h-[480px] max-h-[860px] overflow-hidden rounded-[6px] border border-border/60 bg-card shadow-sm">
        {activeView === "notifications" ? (
          <div className="w-full min-w-0">
            <NotificationsCenter />
          </div>
        ) : (
          <>
            {/* Left pane: conversation list */}
            <aside
              className={cn(
                "flex w-full min-w-0 flex-col border-border/60 md:w-[320px] md:shrink-0 md:border-r",
                selected && "hidden md:flex",
              )}
            >
              <div className="flex items-center justify-between px-3 py-2.5">
                <h1 className="text-base font-bold">{t("chat.messages")}</h1>
                <button
                  type="button"
                  onClick={() => setMode(mode === "new" ? "list" : "new")}
                  className={cn(
                    "inline-flex h-8 w-8 items-center justify-center rounded-[6px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                    mode === "new" && "bg-muted text-foreground",
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

              {mode === "new" ? (
                <NewChatSearch onOpened={openConversation} />
              ) : (
                <>
                  <div className="px-2 pb-2">
                    <label className="relative block">
                      <Search
                        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                        aria-hidden
                      />
                      <input
                        type="text"
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                        placeholder={t("chat.searchConversations")}
                        aria-label={t("chat.searchConversations")}
                        className="h-10 w-full rounded-[6px] border border-input bg-muted/40 !pl-[42px] pr-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      />
                    </label>
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
                    {conversationsQ.isLoading ? (
                      <p className="p-6 text-center text-sm text-muted-foreground">
                        {t("common.loading", { defaultValue: "..." })}
                      </p>
                    ) : filtered.length === 0 ? (
                      <div className="flex flex-col items-center gap-2 p-6 text-center">
                        <MessagesSquare className="h-6 w-6 text-muted-foreground/50" aria-hidden />
                        <p className="text-sm text-muted-foreground">{t("chat.noConversations")}</p>
                        <button
                          type="button"
                          onClick={() => setMode("new")}
                          className="mt-1 rounded-[6px] bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground transition-opacity hover:opacity-90"
                        >
                          {t("chat.newMessage")}
                        </button>
                      </div>
                    ) : (
                      <ul className="flex flex-col gap-0.5">
                        {filtered.map((view) => {
                          const peerId = view.peers[0]?.user_id ?? "";
                          return (
                            <li key={view.conversation.id}>
                              <ConversationListItem
                                view={view}
                                peerProfile={peersQ.data?.get(peerId)}
                                online={online.has(peerId)}
                                myUserId={user.id}
                                lang={lang}
                                active={view.conversation.id === selected}
                                onOpen={() => openConversation(view.conversation.id)}
                              />
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                </>
              )}
            </aside>

            {/* Right pane: active thread */}
            <main className={cn("min-w-0 flex-1", !selected && "hidden md:block")}>
              {selected ? (
                <ChatWindow
                  key={selected}
                  conversationId={selected}
                  variant="page"
                  autoFocus={false}
                  onBack={() => {
                    setSelected(null);
                    void navigate({ search: {}, replace: true });
                  }}
                />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
                  <span className="flex h-14 w-14 items-center justify-center rounded-[6px] bg-muted">
                    <MessagesSquare className="h-6 w-6 text-muted-foreground" aria-hidden />
                  </span>
                  <p className="max-w-[260px] text-sm text-muted-foreground">
                    {t("chat.noConversations")}
                  </p>
                </div>
              )}
            </main>
          </>
        )}
      </div>
    </div>
  );
}
