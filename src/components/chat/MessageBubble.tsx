// Molecule: single message bubble - Messenger-grade behaviors:
// grouped corners, emoji-only enlargement, reply quoting, reactions with a
// quick-reaction hover bar, unsend tombstone, pending/failed states.
// Memoized: callbacks are message-scoped and passed down UNBOUND (the bubble
// supplies its own `message`), so long threads re-render only touched rows.
import { memo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, CheckCheck, Clock, Pencil, Reply, SmilePlus, Trash2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { QUICK_REACTIONS, isEmojiOnly } from "@/lib/chat/emojiQuick";
import { clockTime, type ChatLang } from "@/lib/chat/time";
import type { ChatMessage, ReactionRow } from "@/lib/chat/types";
import { cn } from "@/lib/utils";
import { AttachmentFile, AttachmentImage } from "./AttachmentContent";

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
  onReact: (message: ChatMessage, emoji: string, current: string | null) => void;
  onReply: (message: ChatMessage) => void;
  onEdit: (message: ChatMessage) => void;
  onDelete: (message: ChatMessage) => void;
  onDiscardFailed: (message: ChatMessage) => void;
}

function bubbleRadius(mine: boolean, groupStart: boolean, groupEnd: boolean): string {
  const base = "rounded-2xl";
  if (mine) {
    return cn(base, !groupStart && "rounded-tr-md", !groupEnd && "rounded-br-md");
  }
  return cn(base, !groupStart && "rounded-tl-md", !groupEnd && "rounded-bl-md");
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
              "inline-flex items-center gap-0.5 rounded-full border bg-background px-1.5 py-0.5 text-[11px] shadow-sm transition-colors",
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
    onReact,
    onReply,
    onEdit,
    onDelete,
    onDiscardFailed,
  } = props;
  const { t } = useTranslation();
  const [reactOpen, setReactOpen] = useState(false);

  const deleted = !!message.deleted_at;
  const emojiOnly =
    !deleted && message.kind === "text" && !!message.body && isEmojiOnly(message.body);
  const myReaction = reactions.find((r) => r.user_id === myUserId)?.emoji ?? null;
  const timeTitle = clockTime(message.created_at, lang);

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
                  "flex h-8 w-8 items-center justify-center rounded-full text-lg leading-none transition-transform hover:scale-125",
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
  } else if (message.kind === "image" && message.attachment_path) {
    content = (
      <AttachmentImage path={message.attachment_path} name={message.attachment_name} mine={mine} />
    );
  } else if (message.kind === "file" && message.attachment_path) {
    content = (
      <AttachmentFile
        path={message.attachment_path}
        name={message.attachment_name}
        mime={message.attachment_mime}
        size={message.attachment_size}
        mine={mine}
        lang={lang}
      />
    );
  } else if (emojiOnly) {
    content = (
      <div className="px-1 py-0.5 text-[2rem] leading-tight" title={timeTitle}>
        {message.body}
      </div>
    );
  } else {
    content = (
      <div
        className={cn(
          "max-w-full whitespace-pre-wrap break-words rounded-[10px] px-3 py-1.5 text-[13px] font-normal leading-snug tracking-normal",
          mine ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
        )}
      >
        <p className="whitespace-pre-wrap break-words text-[13px] font-normal leading-snug tracking-normal">
          {message.body}
        </p>
        <p
          className={cn(
            "mt-0.5 text-[10px] font-normal leading-snug tabular-nums",
            mine ? "text-primary-foreground/70" : "text-muted-foreground/70",
          )}
        >
          {timeTitle}
          {message.edited_at && <span className="ml-1"> · {t("chat.edited")}</span>}
        </p>
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
          <div
            className={cn(
              "mb-0.5 max-w-full truncate rounded-xl bg-muted/50 px-2.5 py-1 text-[11px] text-muted-foreground",
              mine ? "text-right" : "text-left",
            )}
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
          </div>
        )}
        {content}
        <ReactionChips
          reactions={reactions}
          myUserId={myUserId}
          onReact={(emoji, current) => onReact(message, emoji, current)}
          mine={mine}
        />
        {message.failed && (
          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-destructive">
            {t("chat.sendFailed")}
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
