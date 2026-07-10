// Organism: scrollable message history - day separators, message grouping,
// infinite upward pagination with scroll anchoring, seen receipt and the
// animated typing indicator. Pure presentation: data arrives via props.
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { crossesDay, dayLabel, sameGroup, type ChatLang } from "@/lib/chat/time";
import type { ChatMessage, ReactionRow } from "@/lib/chat/types";
import { cn } from "@/lib/utils";
import { ChatAvatar } from "./ChatAvatar";
import { MessageBubble } from "./MessageBubble";

// Stable empty-array identity so memoized bubbles without reactions never
// see a "new" prop on unrelated updates.
const NO_REACTIONS: ReactionRow[] = [];

export interface MessageListProps {
  lang: ChatLang;
  myUserId: string;
  /** Chronological (oldest -> newest). */
  messages: ChatMessage[];
  reactions: ReadonlyMap<string, ReactionRow[]>;
  peerName: string;
  peerAvatarUrl: string | null;
  peerLastReadAt: string | null;
  peerTyping: boolean;
  hasOlder: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => void;
  onReact: (message: ChatMessage, emoji: string, current: string | null) => void;
  onReply: (message: ChatMessage) => void;
  onEdit: (message: ChatMessage) => void;
  onDelete: (message: ChatMessage) => void;
  onDiscardFailed: (message: ChatMessage) => void;
  canEdit: (message: ChatMessage) => boolean;
  className?: string;
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
    peerTyping,
    hasOlder,
    loadingOlder,
    onLoadOlder,
    onReact,
    onReply,
    onEdit,
    onDelete,
    onDiscardFailed,
    canEdit,
    className,
  } = props;
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement | null>(null);
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

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (el.scrollTop < 48 && hasOlder && !loadingOlder) {
      prevHeightRef.current = el.scrollHeight;
      onLoadOlder();
    }
  };

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
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className={cn("flex-1 overflow-y-auto overscroll-contain px-3 py-2", className)}
      role="log"
      aria-live="polite"
      aria-label={t("chat.messages")}
    >
      {/* Inner wrapper measured by the ResizeObserver (async image growth). */}
      <div ref={contentRef}>
        {hasOlder && (
          <div className="flex justify-center py-1.5">
            <button
              type="button"
              onClick={() => {
                const el = scrollRef.current;
                if (el) prevHeightRef.current = el.scrollHeight;
                onLoadOlder();
              }}
              disabled={loadingOlder}
              className="rounded-[6px] bg-muted px-3 py-1 text-[11px] text-muted-foreground hover:bg-muted/70 transition-colors disabled:opacity-50"
            >
              {loadingOlder ? t("common.loading", { defaultValue: "..." }) : t("chat.loadOlder")}
            </button>
          </div>
        )}

        {messages.length === 0 && !loadingOlder && (
          <div className="flex h-full flex-col items-center justify-center gap-2 py-8 text-center">
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
                className={cn(
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
                  onReact={onReact}
                  onReply={onReply}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  onDiscardFailed={onDiscardFailed}
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
  );
}
