// Organism: scrollable message history - day separators, message grouping,
// infinite upward pagination with scroll anchoring, delivery/read receipts,
// disappearing-messages notice, scroll-to-bottom pill and the animated typing
// indicator. Pure presentation: data arrives via props.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, Timer } from "lucide-react";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { crossesDay, dayLabel, sameGroup, type ChatLang } from "@/lib/chat/time";
import type { ChatMessage, ReactionRow } from "@/lib/chat/types";
import { cn } from "@/lib/utils";
import { ChatAvatar } from "./ChatAvatar";
import { MessageBubble } from "./MessageBubble";

// Stable empty-array identity so memoized bubbles without reactions never
// see a "new" prop on unrelated updates.
const NO_REACTIONS: ReactionRow[] = [];
const NO_STARS: ReadonlySet<string> = new Set<string>();

export interface MessageListProps {
  lang: ChatLang;
  myUserId: string;
  /** Chronological (oldest -> newest). */
  messages: ChatMessage[];
  reactions: ReadonlyMap<string, ReactionRow[]>;
  peerName: string;
  peerAvatarUrl: string | null;
  peerLastReadAt: string | null;
  peerLastDeliveredAt?: string | null;
  peerTyping: boolean;
  /** Active disappearing-messages window of this conversation (null = off). */
  ttlSeconds?: number | null;
  /** Caller's starred message ids (bubble star state). */
  starredIds?: ReadonlySet<string>;
  hasOlder: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => void;
  onReact: (message: ChatMessage, emoji: string, current: string | null) => void;
  onReply: (message: ChatMessage) => void;
  onEdit: (message: ChatMessage) => void;
  onDelete: (message: ChatMessage) => void;
  onDiscardFailed: (message: ChatMessage) => void;
  onToggleStar?: (message: ChatMessage, starred: boolean) => void;
  canEdit: (message: ChatMessage) => boolean;
  className?: string;
}

/** i18n label for the disappearing-messages chip. */
function ttlLabelKey(ttlSeconds: number): string {
  if (ttlSeconds === 86400) return "chat.disappearing.day";
  if (ttlSeconds === 604800) return "chat.disappearing.week";
  return "chat.disappearing.quarter";
}

function TypingIndicator({ name, avatarUrl }: { name: string; avatarUrl: string | null }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-end gap-1.5" aria-label={`${name} ${t("chat.typing")}`}>
      <ChatAvatar name={name} avatarUrl={avatarUrl} size="xs" />
      <div className="flex items-center gap-1 rounded-[6px] bg-muted px-3 py-2.5">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60 motion-safe:animate-bounce"
            style={{ animationDelay: `${i * 150}ms`, animationDuration: "900ms" }}
            aria-hidden
          />
        ))}
      </div>
    </div>
  );
}

export function MessageList(props: MessageListProps) {
  const {
    lang,
    myUserId,
    messages,
    reactions,
    peerName,
    peerAvatarUrl,
    peerLastReadAt,
    peerLastDeliveredAt,
    peerTyping,
    ttlSeconds,
    starredIds = NO_STARS,
    hasOlder,
    loadingOlder,
    onLoadOlder,
    onReact,
    onReply,
    onEdit,
    onDelete,
    onDiscardFailed,
    onToggleStar,
    canEdit,
    className,
  } = props;
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Scroll-to-bottom pill visibility mirrors the stick-to-bottom heuristic.
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);
  const prevHeightRef = useRef<number | null>(null);
  const prevCountRef = useRef(messages.length);
  // Enter-animation bookkeeping: only messages that arrive AFTER the initial
  // history render animate in - opening a thread must not animate 40 rows.
  const seenIdsRef = useRef<Set<string> | null>(null);
  // While a smooth scroll runs, the ResizeObserver must not snap-jump over it.
  const smoothUntilRef = useRef(0);
  const reducedMotion = usePrefersReducedMotion();

  const dayWords = { today: t("chat.today"), yesterday: t("chat.yesterday") };
  const byId = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);

  // Day separators + Messenger-style grouping, derived once per messages
  // change (crossesDay/sameGroup parse dates - keep them out of hot renders).
  const rows = useMemo(
    () =>
      messages.map((message, index) => {
        const prev = messages[index - 1];
        const next = messages[index + 1];
        const newDay = crossesDay(prev?.created_at, message.created_at);
        const groupStart =
          newDay ||
          !prev ||
          prev.sender_id !== message.sender_id ||
          !sameGroup(prev.created_at, message.created_at);
        const groupEnd =
          !next ||
          next.sender_id !== message.sender_id ||
          crossesDay(message.created_at, next.created_at) ||
          !sameGroup(message.created_at, next.created_at);
        return { message, newDay, groupStart, groupEnd };
      }),
    [messages],
  );

  // Scroll a message into view and briefly highlight it. Called from the
  // reply-quote button on any bubble; noop if the target row has scrolled
  // out of the loaded window (older pages will fetch on their own).
  const jumpToMessage = useCallback((messageId: string) => {
    const container = scrollRef.current;
    if (!container) return;
    const row = container.querySelector<HTMLElement>(
      `[data-message-id="${CSS.escape(messageId)}"]`,
    );
    if (!row) return;
    stickToBottomRef.current = false;
    row.scrollIntoView({ behavior: "smooth", block: "center" });
    row.classList.add("chat-jump-flash");
    window.setTimeout(() => row.classList.remove("chat-jump-flash"), 1600);
  }, []);

  // Newest own message that the peer has already read -> "seen" receipt.
  const lastMine = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m && m.sender_id === myUserId && !m.pending) return m;
    }
    return undefined;
  }, [messages, myUserId]);
  const seen =
    !!lastMine &&
    !!peerLastReadAt &&
    new Date(peerLastReadAt).getTime() >= new Date(lastMine.created_at).getTime();

  const topSentinelRef = useRef<HTMLDivElement | null>(null);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distance < 80;
    // Pill threshold is looser than the stick threshold so it never flickers
    // while smooth-scrolling the last few pixels.
    setAwayFromBottom(distance > 240);
  };

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottomRef.current = true;
    setAwayFromBottom(false);
    if (!reducedMotion) smoothUntilRef.current = Date.now() + 400;
    el.scrollTo({ top: el.scrollHeight, behavior: reducedMotion ? "auto" : "smooth" });
  }, [reducedMotion]);

  // Auto-load older pages when the top sentinel enters the viewport. Beats a
  // scrollTop threshold because it also fires for short histories that never
  // reach the trigger distance and it keeps firing while the sentinel stays
  // visible (fills tall viewports with successive pages).
  useEffect(() => {
    const el = scrollRef.current;
    const sentinel = topSentinelRef.current;
    if (!el || !sentinel || !hasOlder) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && hasOlder && !loadingOlder) {
            prevHeightRef.current = el.scrollHeight;
            onLoadOlder();
            break;
          }
        }
      },
      { root: el, rootMargin: "120px 0px 0px 0px", threshold: 0 },
    );
    io.observe(sentinel);
    return () => io.disconnect();
  }, [hasOlder, loadingOlder, onLoadOlder]);

  // Scroll orchestration, all before paint so nothing flashes:
  //  - first non-empty render lands at the bottom INSTANTLY (no animation),
  //  - older pages prepending above keep the viewport anchored,
  //  - fresh messages scroll down smoothly while the user is pinned to the
  //    bottom (instant under prefers-reduced-motion).
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (seenIdsRef.current === null) {
      if (messages.length > 0) {
        seenIdsRef.current = new Set(messages.map((m) => m.id));
        el.scrollTop = el.scrollHeight;
        prevCountRef.current = messages.length;
      }
      return;
    }
    if (prevHeightRef.current !== null && messages.length > prevCountRef.current) {
      el.scrollTop += el.scrollHeight - prevHeightRef.current;
      prevHeightRef.current = null;
    } else if (messages.length !== prevCountRef.current && stickToBottomRef.current) {
      if (!reducedMotion) smoothUntilRef.current = Date.now() + 400;
      el.scrollTo({ top: el.scrollHeight, behavior: reducedMotion ? "auto" : "smooth" });
    }
    prevCountRef.current = messages.length;
    for (const m of messages) seenIdsRef.current.add(m.id);
  }, [messages, reducedMotion]);

  // Typing bubble appearing/disappearing keeps the pin too.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !stickToBottomRef.current) return;
    if (!reducedMotion) smoothUntilRef.current = Date.now() + 400;
    el.scrollTo({ top: el.scrollHeight, behavior: reducedMotion ? "auto" : "smooth" });
  }, [peerTyping, reducedMotion]);

  // Attachments (images) load asynchronously and grow the content AFTER the
  // scroll effects ran - a ResizeObserver keeps the bottom pin honest. It
  // yields while a smooth scroll is animating (the animation ends at the
  // new scrollHeight anyway).
  useEffect(() => {
    const el = scrollRef.current;
    const content = contentRef.current;
    if (!el || !content || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (stickToBottomRef.current && Date.now() >= smoothUntilRef.current) {
        el.scrollTop = el.scrollHeight;
      }
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  return (
    <div className={cn("relative flex min-h-0 flex-1 flex-col", className)}>
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="chat-wallpaper h-full flex-1 overflow-y-auto overscroll-contain px-3 py-2"
        role="log"
        aria-live="polite"
        aria-label={t("chat.messages")}
      >
        {/* Inner wrapper measured by the ResizeObserver (async image growth). */}
        <div ref={contentRef} className="flex min-h-full flex-col">
          <div ref={topSentinelRef} aria-hidden />

          {ttlSeconds ? (
            <div className="flex items-center justify-center py-1.5">
              <span
                className="inline-flex items-center gap-1 rounded-[6px] bg-muted/70 px-2.5 py-1 text-[10px] text-muted-foreground"
                title={t("chat.disappearing.hint")}
              >
                <Timer className="h-3 w-3" aria-hidden />
                {t("chat.disappearing.active", { window: t(ttlLabelKey(ttlSeconds)) })}
              </span>
            </div>
          ) : null}

          {hasOlder && (
            <div className="flex justify-center py-1.5">
              <span
                className="rounded-[6px] bg-muted px-3 py-1 text-[11px] text-muted-foreground"
                aria-live="polite"
              >
                {loadingOlder ? t("common.loading", { defaultValue: "..." }) : t("chat.loadOlder")}
              </span>
            </div>
          )}

          {messages.length === 0 && !loadingOlder && (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 py-8 text-center">
              <ChatAvatar name={peerName} avatarUrl={peerAvatarUrl} size="lg" />
              <p className="max-w-[220px] text-xs text-muted-foreground">
                {t("chat.conversationEmpty")}
              </p>
            </div>
          )}

          <div className="flex flex-col gap-0.5">
            {rows.map(({ message, newDay, groupStart, groupEnd }, index) => {
              const replied = message.reply_to_id ? byId.get(message.reply_to_id) : undefined;
              // Animate only rows that appeared after the initial history render.
              const isFresh = seenIdsRef.current !== null && !seenIdsRef.current.has(message.id);
              return (
                <div
                  key={message.id}
                  data-message-id={message.id}
                  className={cn(
                    "rounded-[6px] transition-colors duration-500",
                    groupStart && index > 0 && "mt-2",
                    isFresh &&
                      "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 motion-safe:duration-200",
                  )}
                >
                  {newDay && (
                    <div className="flex items-center justify-center py-2.5">
                      <span className="rounded-[6px] bg-muted/70 px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        {dayLabel(message.created_at, lang, dayWords)}
                      </span>
                    </div>
                  )}
                  <MessageBubble
                    message={message}
                    mine={message.sender_id === myUserId}
                    lang={lang}
                    groupStart={groupStart}
                    groupEnd={groupEnd}
                    reactions={reactions.get(message.id) ?? NO_REACTIONS}
                    myUserId={myUserId}
                    repliedMessage={replied}
                    repliedAuthorName={
                      replied
                        ? replied.sender_id === myUserId
                          ? t("chat.you")
                          : peerName
                        : undefined
                    }
                    editable={canEdit(message)}
                    peerLastReadAt={peerLastReadAt}
                    peerLastDeliveredAt={peerLastDeliveredAt}
                    starred={starredIds.has(message.id)}
                    onReact={onReact}
                    onReply={onReply}
                    onEdit={onEdit}
                    onDelete={onDelete}
                    onDiscardFailed={onDiscardFailed}
                    onToggleStar={onToggleStar}
                    onJumpToReply={jumpToMessage}
                  />
                </div>
              );
            })}
          </div>

          <div className="mt-1 flex min-h-[18px] items-center justify-end pr-0.5">
            {lastMine?.pending ? (
              <span className="text-[10px] text-muted-foreground">{t("chat.sending")}</span>
            ) : seen ? (
              <span className="inline-flex items-center gap-1" title={t("chat.seen")}>
                <span className="sr-only">{t("chat.seen")}</span>
                <ChatAvatar name={peerName} avatarUrl={peerAvatarUrl} size="xs" />
              </span>
            ) : null}
          </div>

          {peerTyping && (
            <div className="pb-1 pt-0.5 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:duration-150">
              <TypingIndicator name={peerName} avatarUrl={peerAvatarUrl} />
            </div>
          )}
        </div>
      </div>

      {awayFromBottom && (
        <button
          type="button"
          onClick={scrollToBottom}
          className={cn(
            "absolute bottom-3 right-3 z-[1] flex h-8 w-8 items-center justify-center rounded-full",
            "border border-border/60 bg-background/95 text-muted-foreground shadow-md backdrop-blur",
            "transition-colors hover:bg-muted hover:text-foreground",
            "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-90 motion-safe:duration-150",
          )}
          aria-label={t("chat.scrollToBottom")}
          title={t("chat.scrollToBottom")}
        >
          <ChevronDown className="h-4 w-4" aria-hidden />
        </button>
      )}
    </div>
  );
}
