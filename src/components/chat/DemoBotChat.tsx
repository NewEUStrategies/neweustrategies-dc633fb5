// Lokalny demo-podgląd czatu (bez DB, bez realtime, bez Supabase).
//
// Cel: pokazać jak wyglądają wiadomości, dymki, typing indicator, seen i
// meta-linia z zegarem/tickami - dokładnie w tym samym języku wizualnym co
// realny `ChatWindow` (gradient nadawcy, muted dla peera, 6px radius,
// grupowanie rogów). Wszystko trzymamy w pamięci komponentu; interakcja jest
// ograniczona do echo-bota z krótkim "pisze..." przed odpowiedzią.
//
// Nie zapisujemy nic w Supabase i nie mieszamy się z realnymi wątkami -
// wątek "bot" istnieje tylko po stronie klienta (id: DEMO_BOT_ID).
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Bot, Check, CheckCheck, Send } from "lucide-react";
import { clockTime, type ChatLang } from "@/lib/chat/time";
import { cn } from "@/lib/utils";
import { ChatAvatar } from "./ChatAvatar";

export const DEMO_BOT_ID = "__demo_bot__" as const;
const BOT_NAME_KEY = "chat.demoBot.name" as const;

type Role = "me" | "bot";
type Status = "sending" | "sent" | "delivered" | "read";

interface DemoMessage {
  id: string;
  role: Role;
  body: string;
  createdAt: string;
  status: Status; // dotyczy tylko `role === "me"`; dla bota traktujemy jak "read"
}

export interface DemoBotChatProps {
  lang: ChatLang;
  onBack?: () => void;
}

function useNextId() {
  const counter = useRef(0);
  return useCallback(() => {
    counter.current += 1;
    return `demo-${Date.now().toString(36)}-${counter.current}`;
  }, []);
}

function bubbleRadius(mine: boolean, groupStart: boolean, groupEnd: boolean): string {
  const base = "rounded-[6px]";
  if (mine) {
    return cn(base, !groupStart && "rounded-tr-[3px]", !groupEnd && "rounded-br-[3px]");
  }
  return cn(base, !groupStart && "rounded-tl-[3px]", !groupEnd && "rounded-bl-[3px]");
}

// Ograniczona interakcja: proste, zdeterminowane echo z niewielkim wariantem.
// Nie udajemy AI - to ma być podgląd wizualny wątku, nie asystent.
function botReply(input: string, t: (k: string) => string): string {
  const trimmed = input.trim();
  if (trimmed.length === 0) return t("chat.demoBot.replies.empty");
  if (/^(cześć|hej|hello|hi|witaj)\b/i.test(trimmed)) return t("chat.demoBot.replies.greeting");
  if (/\?\s*$/.test(trimmed)) return t("chat.demoBot.replies.question");
  return t("chat.demoBot.replies.echo").replace("{{msg}}", trimmed.slice(0, 240));
}

export function DemoBotChat({ lang, onBack }: DemoBotChatProps) {
  const { t } = useTranslation();
  const nextId = useNextId();
  const botName = t(BOT_NAME_KEY);

  const [messages, setMessages] = useState<DemoMessage[]>(() => [
    {
      id: "demo-welcome",
      role: "bot",
      body: t("chat.demoBot.welcome"),
      createdAt: new Date().toISOString(),
      status: "read",
    },
  ]);
  const [input, setInput] = useState("");
  const [botTyping, setBotTyping] = useState(false);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Auto-scroll do dołu jak w realnym oknie.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, botTyping]);

  // Focus po zamontowaniu (parity z ChatWindow.autoFocus).
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const send = useCallback(() => {
    const body = input.trim();
    if (body.length === 0 || botTyping) return;
    const myId = nextId();
    const nowIso = new Date().toISOString();
    setMessages((prev) => [
      ...prev,
      { id: myId, role: "me", body, createdAt: nowIso, status: "sending" },
    ]);
    setInput("");

    // Symulacja cyklu: sending → sent → delivered → read + bot typing → reply.
    window.setTimeout(() => {
      setMessages((prev) => prev.map((m) => (m.id === myId ? { ...m, status: "sent" } : m)));
    }, 180);
    window.setTimeout(() => {
      setMessages((prev) => prev.map((m) => (m.id === myId ? { ...m, status: "delivered" } : m)));
      setBotTyping(true);
    }, 480);

    const reply = botReply(body, t);
    // Typing 800-1400 ms w zależności od długości odpowiedzi.
    const typingMs = Math.min(1400, 700 + reply.length * 12);
    window.setTimeout(() => {
      setMessages((prev) => [
        ...prev.map((m) => (m.id === myId ? { ...m, status: "read" as const } : m)),
        {
          id: nextId(),
          role: "bot",
          body: reply,
          createdAt: new Date().toISOString(),
          status: "read",
        },
      ]);
      setBotTyping(false);
    }, 480 + typingMs);
  }, [input, botTyping, nextId, t]);

  const grouped = useMemo(() => {
    // Grupowanie sąsiednich wiadomości tego samego autora (rogi 3px).
    return messages.map((m, i) => {
      const prev = messages[i - 1];
      const next = messages[i + 1];
      return {
        ...m,
        groupStart: !prev || prev.role !== m.role,
        groupEnd: !next || next.role !== m.role,
      };
    });
  }, [messages]);

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-background">
      {/* Header: parity z realnym ChatWindow, tylko z jasnym "Demo" badge. */}
      <header className="flex items-center gap-2.5 border-b border-border/60 bg-card px-3.5 py-2.5">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground md:hidden"
            aria-label={t("chat.back", { defaultValue: "Wróć" })}
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
          </button>
        )}
        <span className="relative inline-block shrink-0">
          <ChatAvatar name={botName} online size="md" />
          <span
            className="absolute -right-1 -top-1 inline-flex h-4 w-4 items-center justify-center rounded-md bg-[var(--brand)] text-white shadow-sm ring-2 ring-card"
            aria-hidden
          >
            <Bot className="h-2.5 w-2.5" />
          </span>
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-1.5 truncate text-sm font-semibold">
            {botName}
            <span
              className="inline-flex items-center rounded-md border border-border/60 bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
              aria-label={t("chat.demoBot.badge")}
            >
              {t("chat.demoBot.badge")}
            </span>
          </h2>
          <p className="truncate text-[11px] text-muted-foreground">
            {botTyping ? t("chat.typing") : t("chat.demoBot.subtitle")}
          </p>
        </div>
      </header>

      {/* Lista wiadomości: własna wersja, tokenami spójna z MessageBubble. */}
      <div
        ref={scrollerRef}
        className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 py-3"
        aria-live="polite"
      >
        <div className="mx-auto mb-3 max-w-[260px] rounded-md border border-dashed border-border/60 bg-muted/40 px-3 py-1.5 text-center text-[11px] text-muted-foreground">
          {t("chat.demoBot.notice")}
        </div>

        {grouped.map((m) => {
          const mine = m.role === "me";
          const bubbleStyle: CSSProperties = mine
            ? {
                background: "linear-gradient(135deg, var(--chat-user-from), var(--chat-user-to))",
                color: "var(--chat-user-foreground)",
                boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
              }
            : {};
          const receipt: Status = m.status;
          return (
            <div
              key={m.id}
              className={cn(
                "flex w-full items-end gap-1.5",
                mine ? "flex-row-reverse" : "flex-row",
                m.status === "sending" && "opacity-60",
              )}
            >
              <div className={cn("flex max-w-[78%] flex-col", mine ? "items-end" : "items-start")}>
                <div
                  className={cn(
                    "max-w-full whitespace-pre-wrap break-words px-3 py-1.5 text-[13px] leading-snug",
                    bubbleRadius(mine, m.groupStart, m.groupEnd),
                    !mine && "bg-muted text-foreground",
                  )}
                  style={bubbleStyle}
                >
                  <p style={mine ? { color: "var(--chat-user-foreground)" } : undefined}>
                    {m.body}
                  </p>
                  <p
                    className={cn(
                      "mt-0.5 flex items-center gap-1 text-[10px] tabular-nums leading-snug",
                      mine ? "justify-end opacity-90" : "text-muted-foreground/70",
                    )}
                  >
                    <span>{clockTime(m.createdAt, lang)}</span>
                    {mine && (
                      <span className="ml-0.5 inline-flex items-center">
                        {receipt === "sending" || receipt === "sent" ? (
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
              </div>
            </div>
          );
        })}

        {botTyping && (
          <div className="flex w-full items-end gap-1.5">
            <div
              className="inline-flex items-center gap-1 rounded-[6px] bg-muted px-3 py-2 text-muted-foreground"
              aria-label={t("chat.typing")}
            >
              <span className="chat-typing-dot h-1.5 w-1.5 rounded-full bg-current" />
              <span
                className="chat-typing-dot h-1.5 w-1.5 rounded-full bg-current"
                style={{ animationDelay: "0.15s" } as CSSProperties}
              />
              <span
                className="chat-typing-dot h-1.5 w-1.5 rounded-full bg-current"
                style={{ animationDelay: "0.3s" } as CSSProperties}
              />
            </div>
          </div>
        )}
      </div>

      {/* Kompozytor: minimalny (bez załączników/emoji) - to jest podgląd. */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className="flex items-end gap-2 border-t border-border/60 bg-card px-3 py-2.5"
      >
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          rows={1}
          placeholder={t("chat.inputPlaceholder")}
          aria-label={t("chat.inputPlaceholder")}
          className="max-h-32 min-h-[40px] flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          maxLength={500}
        />
        <button
          type="submit"
          disabled={input.trim().length === 0 || botTyping}
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[var(--brand)] text-white shadow-sm transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          aria-label={t("chat.send")}
          title={t("chat.send")}
        >
          <Send className="h-4 w-4" aria-hidden />
        </button>
      </form>
    </div>
  );
}
