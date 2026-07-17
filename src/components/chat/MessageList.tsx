// Organism: scrollable message history - day separators, message grouping,
// infinite upward pagination with scroll anchoring, delivery/read receipts,
// disappearing-messages notice, scroll-to-bottom pill and the animated typing
// indicator. Pure presentation: data arrives via props.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, Timer } from "lucide-react";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { wallpaperClass, type ChatWallpaperId } from "@/lib/chat/themes";
import { crossesDay, dayLabel, sameGroup, type ChatLang } from "@/lib/chat/time";
import type { ChatMessage, PeerProfile, ReactionRow } from "@/lib/chat/types";
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
  /** Group thread ("krąg"): label inbound bubbles with the sender's name. */
  isGroup?: boolean;
  /** Member profiles for sender attribution in group threads. */
  senderProfiles?: ReadonlyMap<string, PeerProfile>;
  /** This conversation's nicknames (user id -> nickname); wins over profiles. */
  senderNicknames?: ReadonlyMap<string, string>;
  /** Everyone currently typing (groups may have several at once). */
  typingNames?: string[];
  typingAvatarUrl?: string | null;
  /** Optional own avatar shown on the right side of own messages (demo / custom layouts). */
  myAvatarUrl?: string | null;
  peerLastReadAt: string | null;
  peerLastDeliveredAt?: string | null;
  peerTyping: boolean;
  /** Active disappearing-messages window of this conversation (null = off). */
  ttlSeconds?: number | null;
  /** Personalized thread background (shared per conversation). */
  wallpaper?: ChatWallpaperId;
  /** Caller's starred message ids (bubble star state). */
  starredIds?: ReadonlySet<string>;
  /** Oldest unread message id at open (renders the "unread" divider before it). */
  firstUnreadId?: string | null;
  /** Unread count snapshot at open (drives the divider label + initial jump). */
  unreadCount?: number;
  hasOlder: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => void;
  onReact: (message: ChatMessage, emoji: string, current: string | null) => void;
  onReply: (message: ChatMessage) => void;
  onEdit: (message: ChatMessage) => void;
  onDelete: (message: ChatMessage) => void;
  onDiscardFailed: (message: ChatMessage) => void;
  onRetryFailed?: (message: ChatMessage) => void;
  onToggleStar?: (message: ChatMessage, starred: boolean) => void;
  onForward?: (message: ChatMessage) => void;
  canEdit: (message: ChatMessage) => boolean;
  className?: string;
}

/** i18n label for the disappearing-messages chip. */
function ttlLabelKey(ttlSeconds: number): string {
  if (ttlSeconds === 86400) return "chat.disappearing.day";
  if (ttlSeconds === 604800) return "chat.disappearing.week";
  return "chat.disappearing.quarter";
}

/**
 * Animated "is typing" bubble. Groups can have several simultaneous typists:
 * one name, two names or a "several people" fallback; direct threads show
 * only the peer's avatar + dots (their name is already in the header).
 */
function TypingIndicator({
  names,
  isGroup,
  avatarUrl,
}: {
  names: string[];
  isGroup: boolean;
  avatarUrl: string | null;
}) {
  const { t } = useTranslation();
  const first = names[0] ?? "";
  const label =
    names.length >= 3
      ? t("chat.typingMany")
      : names.length === 2
        ? t("chat.typingTwo", { a: names[0], b: names[1] })
        : isGroup
          ? t("chat.group.typing", { name: first })
          : `${first} ${t("chat.typing")}`;
  return (
    <div className="flex items-end gap-1.5" aria-label={label}>
      <ChatAvatar name={first || "?"} avatarUrl={avatarUrl} size="xs" />
      <div className="flex flex-col items-start gap-0.5">
        {isGroup && (
          <span className="max-w-[240px] truncate px-1 text-[10.5px] text-muted-foreground">
            {label}
          </span>
        )}
        <div className="flex items-center gap-1 rounded-[6px] border border-border/60 bg-card text-foreground shadow-sm dark:bg-secondary px-3 py-2.5">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="chat-typing-dot h-1.5 w-1.5 rounded-full bg-muted-foreground/70"
              style={{ animationDelay: `${i * 160}ms` }}
              aria-hidden
            />
          ))}
        </div>
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
    isGroup = false,
    senderProfiles,
    senderNicknames,
    typingNames,
    typingAvatarUrl,
    myAvatarUrl,
    peerLastReadAt,
    peerLastDeliveredAt,
    peerTyping,
    ttlSeconds,
    wallpaper = "dots",
    starredIds = NO_STARS,
    firstUnreadId,
    unreadCount = 0,
    hasOlder,
    loadingOlder,
    onLoadOlder,
    onReact,
    onReply,
    onEdit,
    onDelete,
    onDiscardFailed,
    onRetryFailed,
    onToggleStar,
    onForward,
    canEdit,
    className,
  } = props;
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Scroll-to-bottom pill visibility mirrors the stick-to-bottom heuristic.
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  // New messages that arrived while the user was scrolled up (pill badge).
  const [newCount, setNewCount] = useState(0);
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

  // Group sender attribution: per-conversation nickname wins over the
  // profile display name (both are visible to every member).
  const senderName = (senderId: string): string =>
    senderNicknames?.get(senderId) ?? senderProfiles?.get(senderId)?.display_name ?? "...";

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
    // Scroll only the chat container, never the outer page. scrollIntoView
    // walks up all scrollable ancestors and would jump the whole document.
    const containerRect = container.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const offset = rowRect.top - containerRect.top - (container.clientHeight - row.clientHeight) / 2;
    container.scrollTo({
      top: container.scrollTop + offset,
      behavior: reducedMotion ? "auto" : "smooth",
    });
    row.classList.add("chat-jump-flash");
    window.setTimeout(() => row.classList.remove("chat-jump-flash"), 1600);
  }, [reducedMotion]);

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
    if (distance < 80) setNewCount(0);
  };

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottomRef.current = true;
    setAwayFromBottom(false);
    setNewCount(0);
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
        // Open at the first unread message (WhatsApp) when there are unreads
        // and the divider is in the loaded window; otherwise at the bottom.
        const divider =
          firstUnreadId && unreadCount > 0
            ? el.querySelector<HTMLElement>(`[data-unread-divider="1"]`)
            : null;
        if (divider) {
          divider.scrollIntoView({ block: "start" });
          stickToBottomRef.current = false;
        } else {
          el.scrollTop = el.scrollHeight;
        }
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
    } else if (messages.length > prevCountRef.current && !stickToBottomRef.current) {
      // New arrivals while scrolled up feed the pill badge.
      setNewCount((n) => n + (messages.length - prevCountRef.current));
    }
    prevCountRef.current = messages.length;
    for (const m of messages) seenIdsRef.current.add(m.id);
  }, [messages, reducedMotion, firstUnreadId, unreadCount]);

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
        className={cn(
          "h-full flex-1 overflow-y-auto overscroll-contain px-3 py-2",
          wallpaperClass(wallpaper),
        )}
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
                {isGroup ? t("chat.group.emptyConversation") : t("chat.conversationEmpty")}
              </p>
            </div>
          )}

          <div className="flex flex-col gap-0.5">
            {rows.map(({ message, newDay, groupStart, groupEnd }, index) => {
              const replied = message.reply_to_id ? byId.get(message.reply_to_id) : undefined;
              const mine = message.sender_id === myUserId;
              // Animate only rows that appeared after the initial history
              // render, sliding in from the sender's side (CSS classes carry
              // their own prefers-reduced-motion kill switch).
              const isFresh = seenIdsRef.current !== null && !seenIdsRef.current.has(message.id);
              const inboundGroupRow = isGroup && !mine;
              const bubble = (
                <MessageBubble
                  message={message}
                  mine={mine}
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
                        : isGroup
                          ? senderName(replied.sender_id)
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
                  onRetryFailed={onRetryFailed}
                  onToggleStar={onToggleStar}
                  onForward={onForward}
                  onJumpToReply={jumpToMessage}
                />
              );
              return (
                <div
                  key={message.id}
                  data-message-id={message.id}
                  className={cn(
                    "rounded-[6px] transition-colors duration-500",
                    groupStart && index > 0 && "mt-2",
                    isFresh && (mine ? "chat-msg-enter-mine" : "chat-msg-enter-theirs"),
                  )}
                >
                  {newDay && (
                    <div className="flex items-center justify-center py-2.5">
                      <span className="rounded-[6px] bg-muted/70 px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        {dayLabel(message.created_at, lang, dayWords)}
                      </span>
                    </div>
                  )}
                  {firstUnreadId === message.id && unreadCount > 0 && (
                    <div
                      className="flex items-center justify-center py-1.5"
                      data-unread-divider="1"
                    >
                      <span className="rounded-[6px] bg-[var(--brand)]/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--brand)]">
                        {t("chat.unreadDivider", { count: unreadCount })}
                      </span>
                    </div>
                  )}
                  {inboundGroupRow && groupStart && (
                    <p className="mb-0.5 pl-8 text-[10.5px] font-semibold text-muted-foreground">
                      {senderName(message.sender_id)}
                    </p>
                  )}
                  {inboundGroupRow ? (
                    // Messenger convention: the sender's avatar anchors the
                    // LAST bubble of their group; earlier rows keep a spacer
                    // so the whole group stays aligned.
                    <div className="flex items-end gap-1.5">
                      {groupEnd ? (
                        <ChatAvatar
                          name={senderName(message.sender_id)}
                          avatarUrl={senderProfiles?.get(message.sender_id)?.avatar_url}
                          size="xs"
                          className="mb-0.5"
                        />
                      ) : (
                        <span className="w-5 shrink-0" aria-hidden />
                      )}
                      <div className="min-w-0 flex-1">{bubble}</div>
                    </div>
                  ) : mine && myAvatarUrl && groupEnd ? (
                    <div className="flex flex-row-reverse items-end gap-1.5">
                      <ChatAvatar
                        name={t("chat.you")}
                        avatarUrl={myAvatarUrl}
                        size="xs"
                        className="mb-0.5"
                      />
                      <div className="min-w-0 flex-1">{bubble}</div>
                    </div>
                  ) : (
                    bubble
                  )}
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
              <TypingIndicator
                names={typingNames && typingNames.length > 0 ? typingNames : [peerName]}
                isGroup={isGroup}
                avatarUrl={typingAvatarUrl !== undefined ? typingAvatarUrl : peerAvatarUrl}
              />
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
          {newCount > 0 && (
            <span
              className="absolute -top-1.5 -right-1.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[var(--brand)] px-1 text-[10px] font-semibold leading-none text-white"
              aria-label={t("chat.unread", { count: newCount })}
            >
              {newCount > 99 ? "99+" : newCount}
            </span>
          )}
        </button>
      )}
    </div>
  );
}
