// Local-only conversation simulator. No Supabase writes, no realtime -
// messages live in component state and vanish on unmount / clear.
// Two response modes:
//   - "echo"     : bot repeats the user's text verbatim
//   - "variants" : bot picks one of 3 canned replies at random
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Bot, SendHorizontal, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

type BotMode = "echo" | "variants";

interface BotMessage {
  readonly id: string;
  readonly role: "user" | "bot";
  readonly body: string;
  readonly ts: number;
}

interface Props {
  readonly onBack?: () => void;
}

function pickVariant(variants: readonly string[], last?: string): string {
  if (variants.length === 0) return "";
  if (variants.length === 1) return variants[0] ?? "";
  // Avoid repeating the same reply twice in a row.
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
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const lastBotReplyRef = useRef<string | undefined>(undefined);

  const variants = useMemo<readonly string[]>(() => {
    const v = t("chat.bot.variants", { returnObjects: true });
    return Array.isArray(v) ? (v as string[]) : [];
  }, [t]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, typing]);

  const send = useCallback(() => {
    const body = input.trim();
    if (!body) return;
    const now = Date.now();
    const userMsg: BotMessage = {
      id: `u-${now}-${Math.random().toString(36).slice(2, 8)}`,
      role: "user",
      body,
      ts: now,
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
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
  }, [input, mode, variants]);

  const clear = useCallback(() => {
    setMessages([]);
    setTyping(false);
    lastBotReplyRef.current = undefined;
  }, []);

  return (
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
          <p className="truncate text-[11px] text-muted-foreground">{t("chat.bot.subtitle")}</p>
        </div>
        <div
          role="tablist"
          aria-label={t("chat.bot.name")}
          className="inline-flex items-center gap-0.5 rounded-[6px] border border-border/60 bg-muted/40 p-0.5"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === "variants"}
            onClick={() => setMode("variants")}
            title={t("chat.bot.modeVariantsHint")}
            className={cn(
              "rounded-[4px] px-2 py-1 text-[11px] font-medium transition-colors",
              mode === "variants"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t("chat.bot.modeVariants")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "echo"}
            onClick={() => setMode("echo")}
            title={t("chat.bot.modeEchoHint")}
            className={cn(
              "rounded-[4px] px-2 py-1 text-[11px] font-medium transition-colors",
              mode === "echo"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t("chat.bot.modeEcho")}
          </button>
        </div>
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
            <p className="max-w-[280px] text-xs text-muted-foreground">{t("chat.bot.intro")}</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {messages.map((m) => (
              <li
                key={m.id}
                className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}
              >
                <div
                  className={cn(
                    "max-w-[75%] rounded-[10px] px-3 py-1.5 text-[13px] font-normal leading-snug tracking-normal",
                    m.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-foreground",
                  )}
                >
                  <p className="whitespace-pre-wrap break-words font-normal">{m.body}</p>
                  <p
                    className={cn(
                      "mt-0.5 text-[10px] font-normal tabular-nums",
                      m.role === "user"
                        ? "text-primary-foreground/70"
                        : "text-muted-foreground/70",
                    )}
                  >
                    {formatTime(m.ts, lang)}
                  </p>
                </div>
              </li>
            ))}
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
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
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
  );
});
