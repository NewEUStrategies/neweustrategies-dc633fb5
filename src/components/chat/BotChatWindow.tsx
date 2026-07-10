// Local-only conversation simulator. No Supabase writes, no realtime -
// messages live in component state and vanish on unmount / clear.
// Two response modes:
//   - "echo"     : bot repeats the user's text verbatim
//   - "variants" : bot picks one of 3 canned replies at random
// Supports quick reactions (Messenger-style) and reply-to-message quoting,
// all client-side.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  Bot,
  Check,
  CheckCheck,
  Images,
  Reply,
  SendHorizontal,
  SmilePlus,
  Trash2,
  X,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { QUICK_REACTIONS } from "@/lib/chat/emojiQuick";
import { ChatMediaPanel } from "./ChatMediaPanel";
import { cn } from "@/lib/utils";

type BotMode = "echo" | "variants";

interface BotMessage {
  readonly id: string;
  readonly role: "user" | "bot";
  readonly body: string;
  readonly ts: number;
  readonly replyToId?: string;
}

interface Props {
  readonly onBack?: () => void;
}

function pickVariant(variants: readonly string[], last?: string): string {
  if (variants.length === 0) return "";
  if (variants.length === 1) return variants[0] ?? "";
  let idx = Math.floor(Math.random() * variants.length);
  if (last && variants[idx] === last) idx = (idx + 1) % variants.length;
  return variants[idx] ?? "";
}

function formatTime(ts: number, lang: string): string {
  try {
    return new Date(ts).toLocaleTimeString(lang === "en" ? "en-US" : "pl-PL", {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export const BotChatWindow = memo(function BotChatWindow({ onBack }: Props) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "pl";
  const [mode, setMode] = useState<BotMode>("variants");
  const [messages, setMessages] = useState<readonly BotMessage[]>([]);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const [reactions, setReactions] = useState<Readonly<Record<string, string>>>({});
  const [replyingTo, setReplyingTo] = useState<BotMessage | null>(null);
  const [reactOpenId, setReactOpenId] = useState<string | null>(null);
  const [mediaOpen, setMediaOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const lastBotReplyRef = useRef<string | undefined>(undefined);

  const variants = useMemo<readonly string[]>(() => {
    const v = t("chat.bot.variants", { returnObjects: true });
    return Array.isArray(v) ? (v as string[]) : [];
  }, [t]);

  const messagesById = useMemo(() => {
    const map = new Map<string, BotMessage>();
    for (const m of messages) map.set(m.id, m);
    return map;
  }, [messages]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, typing]);

  const send = useCallback(() => {
    const body = input.trim();
    if (!body) return;
    const now = Date.now();
    const replyToId = replyingTo?.id;
    const userMsg: BotMessage = {
      id: `u-${now}-${Math.random().toString(36).slice(2, 8)}`,
      role: "user",
      body,
      ts: now,
      ...(replyToId ? { replyToId } : {}),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setReplyingTo(null);
    setTyping(true);
    const reply = mode === "echo" ? body : pickVariant(variants, lastBotReplyRef.current);
    lastBotReplyRef.current = reply;
    const delay = 350 + Math.min(900, Math.max(200, body.length * 25));
    window.setTimeout(() => {
      const ts = Date.now();
      setMessages((prev) => [
        ...prev,
        {
          id: `b-${ts}-${Math.random().toString(36).slice(2, 8)}`,
          role: "bot",
          body: reply,
          ts,
        },
      ]);
      setTyping(false);
    }, delay);
  }, [input, mode, replyingTo, variants]);

  const clear = useCallback(() => {
    setMessages([]);
    setTyping(false);
    setReactions({});
    setReplyingTo(null);
    lastBotReplyRef.current = undefined;
  }, []);

  const toggleReaction = useCallback((messageId: string, emoji: string) => {
    setReactions((prev) => {
      const next = { ...prev };
      if (next[messageId] === emoji) delete next[messageId];
      else next[messageId] = emoji;
      return next;
    });
    setReactOpenId(null);
  }, []);

  const startReply = useCallback((m: BotMessage) => {
    setReplyingTo(m);
    // Defer focus so state has committed.
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  }, []);

  const jumpToMessage = useCallback((messageId: string) => {
    const container = scrollRef.current;
    if (!container) return;
    const row = container.querySelector<HTMLElement>(
      `[data-message-id="${CSS.escape(messageId)}"]`,
    );
    if (!row) return;
    row.scrollIntoView({ behavior: "smooth", block: "center" });
    row.classList.add("chat-jump-flash");
    window.setTimeout(() => row.classList.remove("chat-jump-flash"), 1600);
  }, []);

  return (
    <TooltipProvider delayDuration={150}>
      <div className="flex h-full flex-col">
        {/* Header */}
        <header className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="inline-flex h-8 w-8 items-center justify-center rounded-[6px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:hidden"
              aria-label={t("chat.close")}
            >
              <ArrowLeft className="h-4 w-4" aria-hidden />
            </button>
          )}
          <span
            className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary"
            aria-hidden
          >
            <Bot className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{t("chat.bot.name")}</p>
            <p className="truncate text-[11px] text-muted-foreground">
              {t("chat.bot.subtitle")}
            </p>
          </div>
          <div
            role="tablist"
            aria-label={t("chat.bot.name")}
            className="inline-flex items-center gap-0.5 rounded-[6px] border border-border/60 bg-muted/40 p-0.5"
          >
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === "variants"}
                  onClick={() => setMode("variants")}
                  className={cn(
                    "rounded-[4px] px-2 py-1 text-[11px] font-medium transition-colors",
                    mode === "variants"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t("chat.bot.modeVariants")}
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-[240px] text-[11px] leading-snug">
                {t("chat.bot.modeVariantsHint")}
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === "echo"}
                  onClick={() => setMode("echo")}
                  className={cn(
                    "rounded-[4px] px-2 py-1 text-[11px] font-medium transition-colors",
                    mode === "echo"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t("chat.bot.modeEcho")}
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-[240px] text-[11px] leading-snug">
                {t("chat.bot.modeEchoHint")}
              </TooltipContent>
            </Tooltip>
          </div>
          <button
            type="button"
            onClick={() => setMediaOpen((v) => !v)}
            className={cn(
              "inline-flex h-8 w-8 items-center justify-center rounded-[6px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
              mediaOpen && "bg-muted text-foreground",
            )}
            aria-label={mediaOpen ? t("chat.mediaPanel.close") : t("chat.mediaPanel.open")}
            aria-pressed={mediaOpen}
            title={mediaOpen ? t("chat.mediaPanel.close") : t("chat.mediaPanel.open")}
          >
            <Images className="h-4 w-4" aria-hidden />
          </button>
          <button
            type="button"
            onClick={clear}
            disabled={messages.length === 0 && !typing}
            className="inline-flex h-8 w-8 items-center justify-center rounded-[6px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
            aria-label={t("chat.bot.clear")}
            title={t("chat.bot.clear")}
          >
            <Trash2 className="h-4 w-4" aria-hidden />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-row">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">

        {/* Messages */}
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
              <span
                className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary"
                aria-hidden
              >
                <Bot className="h-5 w-5" />
              </span>
              <p className="max-w-[280px] text-xs text-muted-foreground">
                {t("chat.bot.intro")}
              </p>
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {messages.map((m, idx) => {
                const mine = m.role === "user";
                const reaction = reactions[m.id];
                const replied = m.replyToId ? messagesById.get(m.replyToId) : undefined;
                const reactOpen = reactOpenId === m.id;
                // Simulated receipt for user messages: read once bot replied
                // to it (any later bot msg exists), delivered while typing,
                // sent otherwise.
                const hasLaterBot =
                  mine && messages.slice(idx + 1).some((x) => x.role === "bot");
                const receipt: "sent" | "delivered" | "read" | null = !mine
                  ? null
                  : hasLaterBot
                    ? "read"
                    : typing
                      ? "delivered"
                      : "sent";
                return (
                  <li
                    key={m.id}
                    data-message-id={m.id}
                    className={cn(
                      "group/msg flex w-full items-end gap-1.5 rounded-xl",
                      mine ? "flex-row-reverse" : "flex-row",
                    )}
                  >
                    <div
                      className={cn("flex max-w-[78%] flex-col", mine ? "items-end" : "items-start")}
                    >
                      {replied && (
                        <button
                          type="button"
                          onClick={() => jumpToMessage(replied.id)}
                          className={cn(
                            "mb-0.5 max-w-full truncate rounded-[8px] bg-muted/60 px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            mine ? "text-right self-end" : "text-left self-start",
                          )}
                          aria-label={t("chat.jumpToReplied")}
                          title={t("chat.jumpToReplied")}
                        >
                          <span className="font-medium">
                            {t("chat.replyToMessage")}{" "}
                            {replied.role === "user" ? t("chat.you") : t("chat.bot.name")}
                          </span>{" "}
                          <span className="italic">{replied.body}</span>
                        </button>
                      )}
                      <div
                        className={cn(
                          "max-w-full rounded-[10px] px-3 py-1.5",
                          !mine && "bg-muted text-foreground",
                        )}
                        style={
                          mine
                            ? {
                                background:
                                  "linear-gradient(135deg, var(--chat-user-from), var(--chat-user-to))",
                                color: "var(--chat-user-foreground)",
                                boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
                              }
                            : undefined
                        }
                      >
                        <p className="whitespace-pre-wrap break-words text-[13px] font-normal leading-snug tracking-normal">
                          {m.body}
                        </p>
                        <p
                          className={cn(
                            "mt-0.5 flex items-center gap-1 text-[10px] font-normal leading-snug tabular-nums",
                            mine ? "opacity-90 justify-end" : "text-muted-foreground/70",
                          )}
                        >
                          <span>{formatTime(m.ts, lang)}</span>
                          {receipt && (
                            <span
                              className="ml-0.5 inline-flex items-center"
                              title={t(`chat.receipt.${receipt}`)}
                              aria-label={t(`chat.receipt.${receipt}`)}
                            >
                              {receipt === "sent" ? (
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
                      </div>
                      {reaction && (
                        <div
                          className={cn(
                            "-mt-2 flex px-1 relative z-[1]",
                            mine ? "justify-end" : "justify-start",
                          )}
                        >
                          <button
                            type="button"
                            onClick={() => toggleReaction(m.id, reaction)}
                            className="inline-flex items-center rounded-full border border-primary/50 bg-background px-1.5 py-0.5 text-[11px] shadow-sm"
                            aria-label={t("chat.react")}
                          >
                            <span aria-hidden>{reaction}</span>
                          </button>
                        </div>
                      )}
                    </div>
                    <div
                      className={cn(
                        "flex items-center gap-0.5 self-center opacity-0 transition-opacity duration-150",
                        "group-hover/msg:opacity-100 group-focus-within/msg:opacity-100",
                        reactOpen && "opacity-100",
                      )}
                    >
                      <Popover
                        open={reactOpen}
                        onOpenChange={(o) => setReactOpenId(o ? m.id : null)}
                      >
                        <PopoverTrigger asChild>
                          <button
                            type="button"
                            className="flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
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
                                onClick={() => toggleReaction(m.id, emoji)}
                                className={cn(
                                  "flex h-8 w-8 items-center justify-center rounded-full text-lg leading-none transition-transform hover:scale-125",
                                  reaction === emoji && "bg-muted",
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
                        onClick={() => startReply(m)}
                        className="flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        aria-label={t("chat.reply")}
                        title={t("chat.reply")}
                      >
                        <Reply className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    </div>
                  </li>
                );
              })}
              {typing && (
                <li className="flex justify-start">
                  <div className="inline-flex items-center gap-1 rounded-[10px] bg-muted px-3 py-2">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground/70" />
                    <span
                      className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground/70"
                      style={{ animationDelay: "120ms" }}
                    />
                    <span
                      className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground/70"
                      style={{ animationDelay: "240ms" }}
                    />
                  </div>
                </li>
              )}
            </ul>
          )}
        </div>

        {/* Reply preview */}
        {replyingTo && (
          <div className="flex items-start gap-2 border-t border-border/60 bg-muted/30 px-3 py-1.5 text-[11px]">
            <div className="min-w-0 flex-1">
              <p className="font-medium text-muted-foreground">
                {t("chat.replyToMessage")}{" "}
                {replyingTo.role === "user" ? t("chat.you") : t("chat.bot.name")}
              </p>
              <p className="truncate italic text-muted-foreground/80">{replyingTo.body}</p>
            </div>
            <button
              type="button"
              onClick={() => setReplyingTo(null)}
              className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label={t("chat.cancelReply", { defaultValue: "Anuluj odpowiedź" })}
            >
              <X className="h-3 w-3" aria-hidden />
            </button>
          </div>
        )}

        {/* Composer */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
          className="flex items-end gap-2 border-t border-border/60 px-3 py-2"
        >
          <label className="relative block flex-1">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                } else if (e.key === "Escape" && replyingTo) {
                  e.preventDefault();
                  setReplyingTo(null);
                }
              }}
              placeholder={t("chat.inputPlaceholder")}
              aria-label={t("chat.inputPlaceholder")}
              rows={1}
              className="block w-full resize-none rounded-[6px] border border-input bg-muted/40 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
          <button
            type="submit"
            disabled={!input.trim()}
            aria-label={t("chat.send")}
            title={t("chat.send")}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[6px] bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            <SendHorizontal className="h-4 w-4" aria-hidden />
          </button>
        </form>
          </div>
          {mediaOpen && (
            <ChatMediaPanel
              conversationId="bot-local"
              enabled={false}
              onClose={() => setMediaOpen(false)}
              className="w-[220px] shrink-0"
              localRows={[]}
            />
          )}
        </div>
      </div>
    </TooltipProvider>
  );
});
