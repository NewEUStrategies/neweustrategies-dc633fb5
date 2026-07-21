// Molecule: header chat entry - Messenger-style droplist with recent
// conversations, in-list search, "new message" people search and unread badge.
// Rendered only for signed-in users; realtime keeps the badge live.
// i18n PL/EN, semantic tokens only, popover chrome matches NotificationsBell.
import "@/lib/i18n-chat";
import { useMemo, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { MessagesSquare, Search, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { AppLink } from "@/components/atoms/AppLink";
import { UnreadBadge } from "@/components/atoms/UnreadBadge";
import { useAuth } from "@/hooks/useAuth";
import { openChatWindow } from "@/lib/chat/chatDockBus";
import { conversationDisplay } from "@/lib/chat/display";
import { useNicknames } from "@/lib/chat/nicknames";
import { useOnlineUsers } from "@/lib/chat/presence";
import {
  useChatListRealtime,
  useChatUnreadTotal,
  useConversations,
  usePeerProfiles,
} from "@/lib/chat/useConversations";
import { useIncomingChatToasts } from "@/lib/chat/useIncomingChatToasts";
import { useNotificationPreferences } from "@/lib/notifications/useNotifications";
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
  useIncomingChatToasts();
  const online = useOnlineUsers();
  const conversationsQ = useConversations();
  const unread = useChatUnreadTotal();
  const prefsQ = useNotificationPreferences();

  // The bell droplist mirrors WhatsApp: archived conversations stay out of
  // sight (they live under the /messages archive section).
  const views = useMemo(
    () => (conversationsQ.data ?? []).filter((v) => !v.me.archived_at),
    [conversationsQ.data],
  );
  const peerIds = useMemo(
    () => [...new Set(views.flatMap((v) => v.peers.map((p) => p.user_id)))],
    [views],
  );
  const peersQ = usePeerProfiles(peerIds);
  const nicknamesQ = useNicknames();

  if (!user) return null;
  // Preferencja per tenant: użytkownik może ukryć ikonę czatu w nagłówku.
  // Dopóki preferencje się ładują, domyślnie true - nie migamy dzwonkiem.
  if (prefsQ.data && prefsQ.data.chat_bell_enabled === false) return null;

  const peers = peersQ.data;
  const nicknames = nicknamesQ.data;
  const normalizedFilter = filter.trim().toLowerCase();
  const filtered = normalizedFilter
    ? views.filter((v) =>
        conversationDisplay(v, peers, undefined, nicknames?.get(v.conversation.id))
          .name.toLowerCase()
          .includes(normalizedFilter),
      )
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
          className={cn(
            "relative inline-flex h-8 w-8 items-center justify-center rounded-[6px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            unread > 0 ? "text-primary hover:bg-primary/10" : "hover:bg-muted/60",
          )}
          aria-label={
            unread > 0
              ? `${t("chat.messages")} - ${t("chat.unread", { count: unread })}`
              : t("chat.messages")
          }
          aria-haspopup="dialog"
          aria-expanded={open}
        >
          <MessagesSquare className="h-4 w-4" aria-hidden />
          <UnreadBadge
            count={unread}
            className="absolute -top-0.5 -right-0.5"
            labelKey="chat.unread"
          />
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
          "p-0 overflow-hidden rounded-md border border-border/60 bg-card text-popover-foreground shadow-md",
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
        {/* Nagłówek: tytuł + licznik brand + akcja "nowa" - stylistyka /messages. */}
        <div className="flex items-center justify-between border-b border-border/60 bg-muted/20 px-3.5 pb-2 pt-3">
          <h2 className="flex items-center gap-2 text-base font-bold tracking-tight">
            {t("chat.messages")}
            {unread > 0 && (
              <UnreadBadge count={unread} size="lg" className="static" labelKey="chat.unread" />
            )}
          </h2>
          <button
            type="button"
            onClick={() => setMode(mode === "new" ? "list" : "new")}
            className={cn(
              "inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors motion-safe:transition-transform motion-safe:hover:scale-105",
              mode === "new"
                ? "bg-[var(--brand)] text-white hover:opacity-90"
                : "bg-background text-foreground shadow-sm hover:bg-muted",
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
          <div className="bg-muted/20">
            {views.length > 3 && (
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
            )}
            <div className="max-h-[340px] overflow-y-auto px-1.5 pb-2">
              {conversationsQ.isLoading ? (
                <ul className="flex flex-col gap-0.5" aria-hidden>
                  {[0, 1, 2].map((i) => (
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
                  <p className="text-sm text-muted-foreground">{t("chat.noConversations")}</p>
                  <button
                    type="button"
                    onClick={() => setMode("new")}
                    className="mt-1 rounded-md bg-[var(--brand)] px-3 py-1.5 text-[11px] font-medium text-white transition-opacity hover:opacity-90"
                  >
                    {t("chat.newMessage")}
                  </button>
                </div>
              ) : (
                <ul className="flex flex-col gap-0.5">
                  {filtered.map((view) => (
                    <li key={view.conversation.id}>
                      <ConversationListItem
                        view={view}
                        profiles={peers}
                        nicknames={nicknames?.get(view.conversation.id)}
                        onlineUsers={online}
                        myUserId={user.id}
                        lang={lang}
                        onOpen={() => openConversation(view.conversation.id)}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        <div className="border-t border-border/60 bg-card p-2">
          <AppLink
            href="/messages"
            onClick={() => setOpen(false)}
            className="flex h-9 items-center justify-center gap-1.5 rounded-md text-sm font-medium text-foreground transition-colors hover:bg-muted"
          >
            {t("chat.seeAll")}
          </AppLink>
        </div>
      </PopoverContent>
    </Popover>
  );
}
