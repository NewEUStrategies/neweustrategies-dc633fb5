// Organizm: wysuwana skrzynka czatu z lewej krawędzi ekranu (jak na nagraniu).
// Lewa kolumna to lista rozmów (wyszukiwarka osób + nowa grupa), a po
// wybraniu rozmowy obok otwiera się pełne okno czatu. Reużywamy istniejących
// komponentów czatu - nie budujemy drugiej implementacji wiadomości.
import "@/lib/i18n-chat";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Minus, MessageCircle, Search, SquarePen, UsersRound, X } from "lucide-react";
import { Link } from "@tanstack/react-router";

import { ChatWindow } from "@/components/chat/ChatWindow";
import { ConversationListItem } from "@/components/chat/ConversationListItem";
import { GroupCreateDialog } from "@/components/chat/GroupCreateDialog";
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
import { minimizedChatsStore, useMinimizedChats } from "@/lib/chat/minimizedChats";
import type { ChatLang } from "@/lib/chat/time";
import { cn } from "@/lib/utils";

type Tab = "chats" | "new";

export interface ChatSideDrawerProps {
  onClose: () => void;
  /** Wysokość paska doku - panel nie może pod nim znikać. */
  bottomOffset: number;
}

export function ChatSideDrawer({ onClose, bottomOffset }: ChatSideDrawerProps) {
  const { t, i18n } = useTranslation();
  const lang: ChatLang = i18n.language?.startsWith("en") ? "en" : "pl";
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("chats");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [groupOpen, setGroupOpen] = useState(false);
  const [entered, setEntered] = useState(false);

  useChatListRealtime();
  const online = useOnlineUsers();
  const conversationsQ = useConversations();
  const nicknamesQ = useNicknames();

  // Wejście panelu: jedna transformacja GPU zamiast przeliczania layoutu.
  useEffect(() => {
    const frame = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  // Escape zamyka skrzynkę - bez dodatkowych zapytań do serwera.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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
        className={cn(
          "pointer-events-auto flex h-full w-[320px] max-w-[85vw] flex-col border-r border-border/70",
          "bg-card/95 shadow-xl backdrop-blur-md supports-[backdrop-filter]:bg-card/80",
          "will-change-transform transition-[transform,opacity] duration-300 ease-out motion-reduce:transition-none",
          entered ? "translate-x-0 opacity-100" : "-translate-x-3 opacity-0",
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
            onClick={onClose}
            aria-label={t("dock.close")}
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
            <button
              type="button"
              onClick={() => setGroupOpen(true)}
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted"
            >
              <UsersRound className="h-3.5 w-3.5" aria-hidden />
              {t("chat.group.create")}
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {tab === "new" ? (
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

      {selected ? (
        <div className="animate-fade-in pointer-events-auto hidden h-full w-[380px] max-w-[90vw] flex-col border-r border-border/70 bg-background/95 shadow-lg backdrop-blur-md supports-[backdrop-filter]:bg-background/85 sm:flex">
          <div className="flex items-center gap-1 border-b border-border/70 px-2 py-1">
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
              onClick={() => setSelected(null)}
              aria-label={t("dock.chat.closeConversation")}
              title={t("dock.chat.closeConversation")}
              className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
          <ChatWindow
            key={selected}
            conversationId={selected}
            variant="page"
            onBack={() => setSelected(null)}
            onClose={() => setSelected(null)}
            className="min-h-0 flex-1"
          />
        </div>
      ) : null}

      <GroupCreateDialog
        open={groupOpen}
        onClose={() => setGroupOpen(false)}
        onCreated={(conversationId) => {
          setGroupOpen(false);
          openConversation(conversationId);
        }}
      />
    </div>
  );
}
