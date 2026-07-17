// Molecule: single message bubble - Messenger-grade behaviors:
// grouped corners, emoji-only enlargement, reply quoting, reactions with a
// quick-reaction hover bar, unsend tombstone, pending/failed states.
// Memoized: callbacks are message-scoped and passed down UNBOUND (the bubble
// supplies its own `message`), so long threads re-render only touched rows.
import { memo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Check,
  CheckCheck,
  Clock,
  Forward,
  Pencil,
  Reply,
  SmilePlus,
  Star,
  Trash2,
  Copy,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { QUICK_REACTIONS, isEmojiOnly } from "@/lib/chat/emojiQuick";
import { computeReceipt, type ReceiptState } from "@/lib/chat/receipts";
import { clockTime, type ChatLang } from "@/lib/chat/time";
import type { ChatMessage, ReactionRow } from "@/lib/chat/types";
import { cn } from "@/lib/utils";
import { AttachmentAudio, AttachmentFile, AttachmentImage } from "./AttachmentContent";

export interface MessageBubbleProps {
  message: ChatMessage;
  mine: boolean;
  lang: ChatLang;
  groupStart: boolean;
  groupEnd: boolean;
  reactions: ReadonlyArray<ReactionRow>;
  myUserId: string;
  repliedMessage?: ChatMessage;
  repliedAuthorName?: string;
  /** Own text message within the 5-minute edit window. */
  editable: boolean;
  /** Peer's last_read_at - used for per-message read receipts (mine only). */
  peerLastReadAt?: string | null;
  /** Peer's last_delivered_at - powers the double grey tick. */
  peerLastDeliveredAt?: string | null;
  /** Caller starred this message (filled star + inverse action label). */
  starred?: boolean;
  onReact: (message: ChatMessage, emoji: string, current: string | null) => void;
  onReply: (message: ChatMessage) => void;
  onEdit: (message: ChatMessage) => void;
  onDelete: (message: ChatMessage) => void;
  onDiscardFailed: (message: ChatMessage) => void;
  /** Re-send a failed message as-is (attachment already uploaded). */
  onRetryFailed?: (message: ChatMessage) => void;
  onToggleStar?: (message: ChatMessage, starred: boolean) => void;
  onForward?: (message: ChatMessage) => void;
  /** Scroll/jump to the quoted original message (if still in the loaded window). */
  onJumpToReply?: (messageId: string) => void;
}

// Design standard: every label/image/box in chat uses a 6px corner radius
// (matching the 6px avatars); grouped bubbles tighten the shared edge to 3px.
function bubbleRadius(mine: boolean, groupStart: boolean, groupEnd: boolean): string {
  const base = "rounded-[6px]";
  if (mine) {
    return cn(base, !groupStart && "rounded-tr-[3px]", !groupEnd && "rounded-br-[3px]");
  }
  return cn(base, !groupStart && "rounded-tl-[3px]", !groupEnd && "rounded-bl-[3px]");
}

function ReactionChips({
  reactions,
  myUserId,
  onReact,
  mine,
}: {
  reactions: ReadonlyArray<ReactionRow>;
  myUserId: string;
  onReact: (emoji: string, current: string | null) => void;
  mine: boolean;
}) {
  if (reactions.length === 0) return null;
  const grouped = new Map<string, ReactionRow[]>();
  for (const r of reactions) {
    const list = grouped.get(r.emoji);
    if (list) list.push(r);
    else grouped.set(r.emoji, [r]);
  }
  const myReaction = reactions.find((r) => r.user_id === myUserId)?.emoji ?? null;
  return (
    <div
      className={cn(
        "-mt-2 flex flex-wrap gap-0.5 px-1 relative z-[1]",
        mine ? "justify-end" : "justify-start",
      )}
    >
      {[...grouped.entries()].map(([emoji, rows]) => {
        const isMine = rows.some((r) => r.user_id === myUserId);
        return (
          <button
            key={emoji}
            type="button"
            onClick={() => onReact(emoji, myReaction)}
            className={cn(
              "chat-reaction-pop inline-flex items-center gap-0.5 rounded-[6px] border bg-background px-1.5 py-0.5 text-[11px] shadow-sm transition-colors",
              isMine ? "border-primary/50" : "border-border/60 hover:border-border",
            )}
          >
            <span aria-hidden>{emoji}</span>
            {rows.length > 1 && <span className="text-[10px] font-medium">{rows.length}</span>}
          </button>
        );
      })}
    </div>
  );
}

export const MessageBubble = memo(function MessageBubble(props: MessageBubbleProps) {
  const {
    message,
    mine,
    lang,
    groupStart,
    groupEnd,
    reactions,
    myUserId,
    repliedMessage,
    repliedAuthorName,
    editable,
    peerLastReadAt,
    peerLastDeliveredAt,
    starred = false,
    onReact,
    onReply,
    onEdit,
    onDelete,
    onDiscardFailed,
    onRetryFailed,
    onToggleStar,
    onForward,
    onJumpToReply,
  } = props;
  const { t } = useTranslation();
  const [reactOpen, setReactOpen] = useState(false);

  const deleted = !!message.deleted_at;
  const emojiOnly =
    !deleted && message.kind === "text" && !!message.body && isEmojiOnly(message.body);
  const myReaction = reactions.find((r) => r.user_id === myUserId)?.emoji ?? null;
  const timeTitle = clockTime(message.created_at, lang);
  const receipt: ReceiptState | null =
    mine && !deleted ? computeReceipt(message, peerLastReadAt, peerLastDeliveredAt) : null;

  const actions = !deleted && !message.pending && !message.failed && (
    <div
      className={cn(
        "flex items-center gap-0.5 self-center opacity-0 transition-opacity duration-150",
        "group-hover/msg:opacity-100 group-focus-within/msg:opacity-100",
        reactOpen && "opacity-100",
      )}
    >
      <Popover open={reactOpen} onOpenChange={setReactOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            aria-label={t("chat.react")}
            title={t("chat.react")}
          >
            <SmilePlus className="h-3.5 w-3.5" aria-hidden />
          </button>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="center"
          sideOffset={4}
          className="w-auto rounded-full border-border/60 bg-popover p-1 shadow-xl"
        >
          <div className="flex items-center gap-0.5">
            {QUICK_REACTIONS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => {
                  onReact(message, emoji, myReaction);
                  setReactOpen(false);
                }}
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-full text-lg leading-none",
                  "motion-safe:transition-transform motion-safe:hover:scale-125",
                  myReaction === emoji && "bg-muted",
                )}
                aria-label={emoji}
              >
                {emoji}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
      <button
        type="button"
        onClick={() => onReply(message)}
        className="flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        aria-label={t("chat.reply")}
        title={t("chat.reply")}
      >
        <Reply className="h-3.5 w-3.5" aria-hidden />
      </button>
      {onToggleStar && (
        <button
          type="button"
          onClick={() => onToggleStar(message, starred)}
          className={cn(
            "flex h-6 w-6 items-center justify-center rounded-full transition-colors hover:bg-muted",
            starred
              ? "text-amber-500 hover:text-amber-600"
              : "text-muted-foreground hover:text-foreground",
          )}
          aria-label={starred ? t("chat.star.remove") : t("chat.star.add")}
          title={starred ? t("chat.star.remove") : t("chat.star.add")}
          aria-pressed={starred}
        >
          <Star className={cn("h-3.5 w-3.5", starred && "fill-current")} aria-hidden />
        </button>
      )}
      {onForward && message.kind === "text" && (
        <button
          type="button"
          onClick={() => onForward(message)}
          className="flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          aria-label={t("chat.forward.action")}
          title={t("chat.forward.action")}
        >
          <Forward className="h-3.5 w-3.5" aria-hidden />
        </button>
      )}
      {editable && (
        <button
          type="button"
          onClick={() => onEdit(message)}
          className="flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          aria-label={t("chat.editMessage")}
          title={t("chat.editMessage")}
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden />
        </button>
      )}
      {mine && (
        <button
          type="button"
          onClick={() => onDelete(message)}
          className="flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
          aria-label={t("chat.deleteMessage")}
          title={t("chat.deleteMessage")}
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
        </button>
      )}
    </div>
  );

  // Shared footer (time · edited · star · receipt). `onGradient` tunes contrast
  // for the sender's brand-gradient bubble vs a neutral surface.
  const metaLine = (onGradient: boolean) => (
    <p
      className={cn(
        "mt-0.5 flex items-center gap-1 text-[10px] font-normal leading-snug tabular-nums",
        mine ? "justify-end" : "",
        onGradient ? "opacity-90" : "text-muted-foreground/70",
      )}
    >
      <span>{timeTitle}</span>
      {message.edited_at && <span aria-hidden>·</span>}
      {message.edited_at && <span>{t("chat.edited")}</span>}
      {starred && (
        <Star className="h-2.5 w-2.5 fill-current opacity-80" aria-label={t("chat.star.starred")} />
      )}
      {receipt && (
        <span
          className="ml-0.5 inline-flex items-center"
          title={t(`chat.receipt.${receipt}`)}
          aria-label={t(`chat.receipt.${receipt}`)}
        >
          {receipt === "pending" ? (
            <Clock className="h-3 w-3" aria-hidden />
          ) : receipt === "sent" ? (
            <Check className="h-3 w-3" aria-hidden />
          ) : receipt === "delivered" ? (
            <CheckCheck className="h-3 w-3" aria-hidden />
          ) : (
            <CheckCheck
              className="h-3 w-3"
              style={{ color: "var(--chat-user-tick-read)" }}
              aria-hidden
            />
          )}
        </span>
      )}
    </p>
  );

  // "Forwarded" marker (WhatsApp shows it above the content, italic + arrow).
  const forwardedTag = message.forwarded ? (
    <p
      className={cn(
        "mb-0.5 flex items-center gap-1 text-[10px] italic",
        mine ? "justify-end text-muted-foreground/70" : "text-muted-foreground/70",
      )}
    >
      <Forward className="h-3 w-3" aria-hidden />
      {t("chat.forward.tag")}
    </p>
  ) : null;

  const caption = message.body?.trim() ? message.body : null;

  let content: React.ReactNode;
  if (deleted) {
    content = (
      <div
        className={cn(
          "border border-dashed border-border/70 bg-transparent px-3 py-1.5 text-xs italic text-muted-foreground",
          bubbleRadius(mine, groupStart, groupEnd),
        )}
      >
        {t("chat.deletedMessage")}
      </div>
    );
  } else if (message.kind === "image" || message.kind === "audio" || message.kind === "file") {
    const media =
      message.kind === "image" && message.attachment_path ? (
        <AttachmentImage
          path={message.attachment_path}
          name={message.attachment_name}
          mine={mine}
        />
      ) : message.kind === "audio" && message.attachment_path ? (
        <AttachmentAudio
          path={message.attachment_path}
          duration={message.attachment_duration}
          mine={mine}
        />
      ) : message.kind === "file" && message.attachment_path ? (
        <AttachmentFile
          path={message.attachment_path}
          name={message.attachment_name}
          mime={message.attachment_mime}
          size={message.attachment_size}
          mine={mine}
          lang={lang}
        />
      ) : null;
    content = (
      <div className={cn("flex flex-col", mine ? "items-end" : "items-start")}>
        {forwardedTag}
        {media}
        {caption ? (
          <div
            className={cn(
              "mt-0.5 max-w-full whitespace-pre-wrap break-words px-3 py-1.5 text-[13px] leading-snug",
              bubbleRadius(mine, groupStart, groupEnd),
              !mine &&
                "border border-border/60 bg-card text-foreground shadow-sm dark:bg-secondary",
            )}
            style={
              mine
                ? {
                    background:
                      "linear-gradient(135deg, var(--chat-user-from), var(--chat-user-to))",
                    color: "var(--chat-user-foreground)",
                  }
                : undefined
            }
          >
            <p style={mine ? { color: "var(--chat-user-foreground)" } : undefined}>{caption}</p>
            {metaLine(mine)}
          </div>
        ) : (
          <div className={cn("px-0.5", mine ? "self-end" : "self-start")}>{metaLine(false)}</div>
        )}
      </div>
    );
  } else if (emojiOnly) {
    content = (
      <div className={cn("flex flex-col", mine ? "items-end" : "items-start")}>
        {forwardedTag}
        <div className="px-1 py-0.5 text-[2rem] leading-tight" title={timeTitle}>
          {message.body}
        </div>
        <div className={cn("px-0.5", mine ? "self-end" : "self-start")}>{metaLine(false)}</div>
      </div>
    );
  } else {
    const bubbleStyle: React.CSSProperties = mine
      ? {
          background: "linear-gradient(135deg, var(--chat-user-from), var(--chat-user-to))",
          color: "var(--chat-user-foreground)",
          boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
        }
      : {};
    content = (
      <div
        className={cn(
          "max-w-full whitespace-pre-wrap break-words px-3 py-1.5 text-[13px] font-normal leading-snug tracking-normal",
          bubbleRadius(mine, groupStart, groupEnd),
          !mine && "border border-border/60 bg-card text-foreground shadow-sm dark:bg-secondary",
        )}
        style={bubbleStyle}
      >
        {forwardedTag}
        <p
          className="whitespace-pre-wrap break-words text-[13px] font-normal leading-snug tracking-normal"
          style={mine ? { color: "var(--chat-user-foreground)" } : undefined}
        >
          {message.body}
        </p>
        {metaLine(mine)}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "group/msg flex w-full items-end gap-1.5",
        mine ? "flex-row-reverse" : "flex-row",
        message.pending && "opacity-60",
      )}
    >
      <div className={cn("flex max-w-[78%] flex-col", mine ? "items-end" : "items-start")}>
        {repliedMessage && (
          <button
            type="button"
            onClick={() => onJumpToReply?.(repliedMessage.id)}
            className={cn(
              "mb-0.5 max-w-full truncate rounded-[6px] bg-muted/50 px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              mine ? "text-right self-end" : "text-left self-start",
            )}
            aria-label={t("chat.jumpToReplied", {
              defaultValue: "Przejdź do oryginalnej wiadomości",
            })}
            title={t("chat.jumpToReplied", { defaultValue: "Przejdź do oryginalnej wiadomości" })}
          >
            <span className="font-medium">
              {t("chat.replyToMessage")} {repliedAuthorName ?? ""}
            </span>{" "}
            <span className="italic">
              {repliedMessage.deleted_at
                ? t("chat.deletedMessage")
                : (repliedMessage.body ??
                  (repliedMessage.kind === "image" ? t("chat.photo") : t("chat.file")))}
            </span>
          </button>
        )}
        {!deleted && !message.pending && !message.failed ? (
          <ContextMenu>
            <ContextMenuTrigger asChild>
              <div className={cn("max-w-full", mine ? "self-end" : "self-start")}>
                {content}
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent className={cn(mine ? "" : "")}>
              <ContextMenuItem onSelect={() => onReply(message)}>
                <Reply className="h-3.5 w-3.5" aria-hidden />
                {t("chat.reply")}
              </ContextMenuItem>
              <ContextMenuItem
                onSelect={() => {
                  const text = message.body ?? "";
                  if (text) void navigator.clipboard?.writeText(text);
                }}
                disabled={!message.body}
              >
                <Copy className="h-3.5 w-3.5" aria-hidden />
                {t("chat.copyMessage", { defaultValue: "Kopiuj tekst" })}
              </ContextMenuItem>
              {onToggleStar && (
                <ContextMenuItem onSelect={() => onToggleStar(message, starred)}>
                  <Star
                    className={cn("h-3.5 w-3.5", starred && "fill-current text-amber-500")}
                    aria-hidden
                  />
                  {starred ? t("chat.star.remove") : t("chat.star.add")}
                </ContextMenuItem>
              )}
              {onForward && message.kind === "text" && (
                <ContextMenuItem onSelect={() => onForward(message)}>
                  <Forward className="h-3.5 w-3.5" aria-hidden />
                  {t("chat.forward.action")}
                </ContextMenuItem>
              )}
              <ContextMenuSeparator />
              <ContextMenuItem
                onSelect={() => setReactOpen(true)}
                aria-label={t("chat.react")}
              >
                <SmilePlus className="h-3.5 w-3.5" aria-hidden />
                {t("chat.react")}
              </ContextMenuItem>
              {editable && (
                <>
                  <ContextMenuSeparator />
                  <ContextMenuItem onSelect={() => onEdit(message)}>
                    <Pencil className="h-3.5 w-3.5" aria-hidden />
                    {t("chat.editMessage")}
                  </ContextMenuItem>
                </>
              )}
              {mine && (
                <ContextMenuItem
                  variant="destructive"
                  onSelect={() => onDelete(message)}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  {t("chat.deleteMessage")}
                </ContextMenuItem>
              )}
            </ContextMenuContent>
          </ContextMenu>
        ) : (
          content
        )}
        <ReactionChips
          reactions={reactions}
          myUserId={myUserId}
          onReact={(emoji, current) => onReact(message, emoji, current)}
          mine={mine}
        />
        {message.failed && (
          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-destructive">
            {t("chat.sendFailed")}
            {onRetryFailed && (
              <button
                type="button"
                onClick={() => onRetryFailed(message)}
                className="font-medium underline underline-offset-2"
              >
                {t("chat.retry")}
              </button>
            )}
            <button
              type="button"
              onClick={() => onDiscardFailed(message)}
              className="underline underline-offset-2"
            >
              {t("chat.discard")}
            </button>
          </div>
        )}
      </div>
      {actions}
    </div>
  );
});
