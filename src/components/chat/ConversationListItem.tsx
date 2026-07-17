// Molecule: one conversation row (header droplist + /messages left pane).
// WhatsApp affordances: pin/mute badges, ✓/✓✓ ticks for the own last message,
// a voice-note preview label and an in-progress draft preview. Group rows show
// the circle title and prefix the preview with the last sender's name;
// per-conversation nicknames win over profile names everywhere.
import { useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { BellOff, Check, CheckCheck, Pin } from "lucide-react";
import { aggregatePeerReadState, conversationDisplay } from "@/lib/chat/display";
import { draftSnapshot, subscribeDrafts } from "@/lib/chat/drafts";
import { computeReceipt } from "@/lib/chat/receipts";
import { isMuted } from "@/lib/chat/useConversations";
import { relTime, type ChatLang } from "@/lib/chat/time";
import type { ConversationView, PeerProfile } from "@/lib/chat/types";
import { cn } from "@/lib/utils";
import { ChatAvatar } from "./ChatAvatar";

const getServerDraft = () => "";

export interface ConversationListItemProps {
  view: ConversationView;
  /** Member profile cards (direct: the peer; groups: every member). */
  profiles: ReadonlyMap<string, PeerProfile> | undefined;
  /** This conversation's nicknames (user id -> nickname). */
  nicknames?: ReadonlyMap<string, string>;
  /** Online user ids (presence dot; groups show none on the avatar). */
  onlineUsers: ReadonlySet<string>;
  myUserId: string;
  lang: ChatLang;
  active?: boolean;
  onOpen: () => void;
}

export function ConversationListItem(props: ConversationListItemProps) {
  const { view, profiles, nicknames, onlineUsers, myUserId, lang, active = false, onOpen } = props;
  const { t } = useTranslation();
  const display = conversationDisplay(view, profiles, t("chat.group.circle"), nicknames);
  const name = display.name;
  const online = !!display.peerId && onlineUsers.has(display.peerId);
  const unread = view.me.unread_count;
  const c = view.conversation;
  const pinned = !!view.me.pinned_at;
  const muted = isMuted(view);

  // Live draft preview (updates while typing in another pane of this tab).
  const draft = useSyncExternalStore(
    subscribeDrafts,
    () => draftSnapshot(myUserId, c.id),
    getServerDraft,
  );

  let preview = "";
  if (c.last_message_kind === "text" && c.last_message_preview) preview = c.last_message_preview;
  else if (c.last_message_kind === "image") preview = t("chat.photo");
  else if (c.last_message_kind === "file") preview = t("chat.file");
  else if (c.last_message_kind === "audio") preview = t("chat.voice.message");
  else if (c.last_message_kind === "deleted") preview = t("chat.deletedMessage");
  const mineLast = !!preview && c.last_message_sender === myUserId;
  if (mineLast) {
    preview = `${t("chat.you")}: ${preview}`;
  } else if (display.isGroup && preview && c.last_message_sender) {
    const senderName =
      nicknames?.get(c.last_message_sender) ?? profiles?.get(c.last_message_sender)?.display_name;
    if (senderName) preview = `${senderName}: ${preview}`;
  }
  // A draft in progress beats the last-message preview (WhatsApp semantics) -
  // except in the currently open thread, where the composer already shows it.
  const showDraft = !active && draft.trim().length > 0;

  // List ticks: own last message vs the other side's delivery/read state.
  // Groups aggregate across members (read only when ALL read); an absent row
  // (hidden receipts) caps at a single grey tick, same as bubbles.
  const readState = aggregatePeerReadState(view);
  const listReceipt =
    mineLast && c.last_message_at && c.last_message_kind !== "deleted"
      ? computeReceipt(
          { created_at: c.last_message_at },
          readState.lastReadAt,
          readState.lastDeliveredAt,
        )
      : null;

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-[6px] px-2 py-2 text-left transition-colors",
        active ? "bg-muted" : "hover:bg-muted/60",
      )}
    >
      <ChatAvatar name={name} avatarUrl={display.avatarUrl} online={online} size="md" />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span
            className={cn(
              "flex min-w-0 items-center gap-1 truncate text-[13px]",
              unread > 0 ? "font-semibold" : "font-medium",
            )}
          >
            <span className="truncate">{name}</span>
            {muted && (
              <BellOff
                className="h-3 w-3 shrink-0 text-muted-foreground"
                aria-label={t("chat.menu.mutedBadge")}
              />
            )}
          </span>
          <span className="flex shrink-0 items-center gap-1">
            {pinned && (
              <Pin
                className="h-3 w-3 text-muted-foreground"
                aria-label={t("chat.menu.pinnedBadge")}
              />
            )}
            {c.last_message_at && (
              <span className="text-[10px] text-muted-foreground">
                {relTime(c.last_message_at, lang)}
              </span>
            )}
          </span>
        </span>
        <span className="mt-0.5 flex items-center justify-between gap-2">
          <span
            className={cn(
              "flex min-w-0 items-center gap-1 truncate text-[11.5px]",
              unread > 0 ? "font-medium text-foreground" : "text-muted-foreground",
            )}
          >
            {showDraft ? (
              <span className="truncate">
                <span className="font-medium italic text-brand-ink">{t("chat.draftLabel")}</span>{" "}
                <span className="italic">{draft}</span>
              </span>
            ) : (
              <>
                {listReceipt === "read" ? (
                  <CheckCheck
                    className="h-3 w-3 shrink-0"
                    style={{ color: "var(--chat-user-tick-read)" }}
                    aria-label={t("chat.receipt.read")}
                  />
                ) : listReceipt === "delivered" ? (
                  <CheckCheck
                    className="h-3 w-3 shrink-0 text-muted-foreground"
                    aria-label={t("chat.receipt.delivered")}
                  />
                ) : listReceipt === "sent" ? (
                  <Check
                    className="h-3 w-3 shrink-0 text-muted-foreground"
                    aria-label={t("chat.receipt.sent")}
                  />
                ) : null}
                <span className="truncate">{preview || t("chat.conversationEmpty")}</span>
              </>
            )}
          </span>
          {unread > 0 && (
            <span
              className="inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-[6px] bg-[var(--brand)] px-1 text-[10px] font-semibold leading-none text-white"
              aria-label={t("chat.unread", { count: unread })}
            >
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </span>
      </span>
    </button>
  );
}
