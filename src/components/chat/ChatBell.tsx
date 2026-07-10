// Molecule: header chat entry - Messenger-style droplist with recent
// conversations, in-list search, "new message" people search and unread badge.
// Rendered only for signed-in users; realtime keeps the badge live.
// i18n PL/EN, semantic tokens only, popover chrome matches NotificationsBell.
import "@/lib/i18n-chat";
import { useMemo, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { MessagesSquare, Search, SquarePen, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AppLink } from "@/components/atoms/AppLink";
import { useAuth } from "@/hooks/useAuth";
import { openChatWindow } from "@/lib/chat/chatDockBus";
import { useOnlineUsers } from "@/lib/chat/presence";
import {
  useChatListRealtime,
  useChatUnreadTotal,
  useConversations,
  usePeerProfiles,
} from "@/lib/chat/useConversations";
import type { ChatLang } from "@/lib/chat/time";
import { cn } from "@/lib/utils";
import { ConversationListItem } from "./ConversationListItem";
import { NewChatSearch } from "./NewChatSearch";

export interface ChatBellProps {
  panelWidth?: number;
}

export function ChatBell({ panelWidth = 340 }: ChatBellProps) {
  const { user } = useAuth();
  const { t, i18n } = useTranslation();
  const lang: ChatLang = i18n.language === "en" ? "en" : "pl";
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"list" | "new">("list");
  const [filter, setFilter] = useState("");

  // Hooks must run unconditionally; they no-op while signed out.
  useChatListRealtime();
  const online = useOnlineUsers();
  const conversationsQ = useConversations();
  const unread = useChatUnreadTotal();

  const views = useMemo(() => conversationsQ.data ?? [], [conversationsQ.data]);
  const peerIds = useMemo(
    () => [...new Set(views.flatMap((v) => v.peers.map((p) => p.user_id)))],
    [views],
  );
  const peersQ = usePeerProfiles(peerIds);

  if (!user) return null;

  const peers = peersQ.data;
  const normalizedFilter = filter.trim().toLowerCase();
  const filtered = normalizedFilter
    ? views.filter((v) => {
        const name = peers?.get(v.peers[0]?.user_id ?? "")?.display_name ?? "";
        return name.toLowerCase().includes(normalizedFilter);
      })
    : views;

  const openConversation = (conversationId: string) => {
    openChatWindow({ conversationId });
    setOpen(false);
    setMode("list");
    setFilter("");
  };

  const panelStyle: CSSProperties = { width: panelWidth, maxWidth: "calc(100vw - 24px)" };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setMode("list");
          setFilter("");
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className="relative inline-flex h-8 w-8 items-center justify-center rounded-[6px] hover:bg-muted/60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={t("chat.messages")}
          aria-haspopup="dialog"
          aria-expanded={open}
        >
          <MessagesSquare className="h-4 w-4" aria-hidden />
          {unread > 0 && (
            <span
              className="absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] px-1 rounded-[6px] bg-primary text-primary-foreground text-[9px] font-semibold leading-none inline-flex items-center justify-center shadow-sm ring-2 ring-background motion-safe:animate-in motion-safe:zoom-in-50 motion-safe:duration-200"
              aria-label={t("chat.unread", { count: unread })}
            >
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        collisionPadding={12}
        sticky="always"
        hideWhenDetached={false}
        avoidCollisions
        className={[
          "p-0 overflow-hidden shadow-xl border-border/60 backdrop-blur-md bg-popover text-popover-foreground",
          "data-[state=open]:animate-in data-[state=closed]:animate-out",
          "data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0",
          "data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95",
          "data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2",
          "duration-220 ease-[cubic-bezier(0.22,0.61,0.36,1)]",
          "will-change-[transform,opacity]",
          "origin-(--radix-popover-content-transform-origin)",
        ].join(" ")}
        style={panelStyle}
      >
        <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
          <div className="text-xs font-semibold uppercase tracking-wide">{t("chat.title")}</div>
          <button
            type="button"
            onClick={() => setMode(mode === "new" ? "list" : "new")}
            className={cn(
              "inline-flex h-7 w-7 items-center justify-center rounded-[6px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
              mode === "new" && "bg-muted text-foreground",
            )}
            aria-label={t("chat.newMessage")}
            title={t("chat.newMessage")}
          >
            {mode === "new" ? (
              <X className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <SquarePen className="h-3.5 w-3.5" aria-hidden />
            )}
          </button>
        </div>

        {mode === "new" ? (
          <NewChatSearch onOpened={openConversation} />
        ) : (
          <>
            {views.length > 3 && (
              <div className="relative px-2 pt-2">
                <Search
                  className="pointer-events-none absolute left-4 top-1/2 mt-1 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <input
                  type="text"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder={t("chat.searchConversations")}
                  aria-label={t("chat.searchConversations")}
                  className="h-8 w-full rounded-[6px] border border-input bg-muted/40 pl-8 pr-3 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
            )}
            <div className="max-h-[340px] overflow-y-auto p-1.5">
              {conversationsQ.isLoading ? (
                <p className="p-4 text-center text-xs text-muted-foreground">
                  {t("common.loading", { defaultValue: "..." })}
                </p>
              ) : filtered.length === 0 ? (
                <div className="flex flex-col items-center gap-2.5 px-4 py-6 text-center">
                  <span
                    className="inline-flex h-9 w-9 items-center justify-center rounded-[6px] bg-muted/60 text-muted-foreground"
                    aria-hidden
                  >
                    <MessagesSquare className="h-4 w-4" />
                  </span>
                  <p className="text-[11px] leading-snug text-muted-foreground">
                    {t("chat.noConversations")}
                  </p>
                  <button
                    type="button"
                    onClick={() => setMode("new")}
                    className="inline-flex items-center gap-1 rounded-[6px] bg-primary px-1.5 py-0.5 text-[9px] font-medium leading-none text-primary-foreground transition-opacity hover:opacity-90"
                  >
                    <SquarePen className="h-2.5 w-2.5" aria-hidden />
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
                          peerProfile={peers?.get(peerId)}
                          online={online.has(peerId)}
                          myUserId={user.id}
                          lang={lang}
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

        <div className="border-t border-border/60 p-2">
          <AppLink
            href="/messages"
            onClick={() => setOpen(false)}
            className="flex h-8 items-center justify-center gap-1.5 rounded-[6px] text-xs font-medium hover:bg-muted/60 transition-colors"
          >
            {t("chat.seeAll")}
          </AppLink>
        </div>
      </PopoverContent>
    </Popover>
  );
}
