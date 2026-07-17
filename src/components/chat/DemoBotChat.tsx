// Lokalny demo-podgląd czatu (bez DB, bez realtime, bez Supabase).
//
// Zamiast własnej, uproszczonej listy renderujemy PRAWDZIWY `MessageList` -
// ten sam organizm co realny ChatWindow. Dzięki temu podgląd pokazuje 1:1:
// dymki obu stron (gradient nadawcy / muted rozmówcy), separatory dni,
// godziny wysłania, pełny cykl potwierdzeń (zegar -> pojedynczy tick ->
// podwójny -> podwójny kolorowy po odczycie, z opisem w podpowiedzi),
// reakcje emoji na dymkach, odpowiadanie na konkretny dymek z cytatem i
// skokiem do oryginału, tombstone usunięcia, wskaźnik "pisze..." i animacje
// wejścia. Stan żyje wyłącznie w pamięci komponentu; bot odpowiada echem po
// krótkim "pisze...".
//
// Nie zapisujemy nic w Supabase i nie mieszamy się z realnymi wątkami -
// wątek "bot" istnieje tylko po stronie klienta (id: DEMO_BOT_ID).
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Bot, SendHorizontal, X } from "lucide-react";
import type { ChatLang } from "@/lib/chat/time";
import type { ChatMessage, ReactionRow } from "@/lib/chat/types";
import { ChatAvatar } from "./ChatAvatar";
import { MessageList } from "./MessageList";

export const DEMO_BOT_ID = "__demo_bot__" as const;
const BOT_NAME_KEY = "chat.demoBot.name" as const;

/** Lokalne tożsamości wątku demo (nigdy nie trafiają do bazy). */
const ME_ID = "__demo_me__";
const BOT_USER_ID = "__demo_bot_user__";
const DEMO_TENANT = "__demo_tenant__";

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

/** Pełny wiersz wiadomości w kształcie realnego MessageRow. */
function demoMessage(
  id: string,
  senderId: string,
  body: string | null,
  createdAt: string,
  extra: Partial<ChatMessage> = {},
): ChatMessage {
  return {
    id,
    conversation_id: DEMO_BOT_ID,
    tenant_id: DEMO_TENANT,
    sender_id: senderId,
    kind: "text",
    body,
    attachment_path: null,
    attachment_name: null,
    attachment_mime: null,
    attachment_size: null,
    attachment_duration: null,
    reply_to_id: null,
    forwarded: false,
    edited_at: null,
    deleted_at: null,
    expires_at: null,
    created_at: createdAt,
    ...extra,
  };
}

function demoReaction(messageId: string, userId: string, emoji: string): ReactionRow {
  return {
    id: `demo-react-${messageId}-${userId}`,
    message_id: messageId,
    conversation_id: DEMO_BOT_ID,
    tenant_id: DEMO_TENANT,
    user_id: userId,
    emoji,
    created_at: new Date().toISOString(),
  };
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

  // Powitanie datowane na wczoraj: od pierwszego otwarcia widać separatory
  // dni ("Wczoraj" nad powitaniem, "Dzisiaj" nad pierwszą nową wiadomością).
  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    demoMessage(
      "demo-welcome",
      BOT_USER_ID,
      t("chat.demoBot.welcome"),
      new Date(Date.now() - 26 * 3600 * 1000).toISOString(),
    ),
  ]);
  const [reactions, setReactions] = useState<ReadonlyMap<string, ReactionRow[]>>(new Map());
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [botTyping, setBotTyping] = useState(false);
  // Znaczniki "drugiej strony" - dokładnie te, z których realny czat liczy
  // ticki: dostarczenie i odczyt jako timestampy, nie flagi.
  const [peerDeliveredAt, setPeerDeliveredAt] = useState<string | null>(null);
  const [peerReadAt, setPeerReadAt] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const timersRef = useRef<number[]>([]);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const id of timers) window.clearTimeout(id);
      timers.length = 0;
    };
  }, []);
  const later = useCallback((ms: number, fn: () => void) => {
    timersRef.current.push(window.setTimeout(fn, ms));
  }, []);

  // Focus po zamontowaniu (parity z ChatWindow.autoFocus).
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Reakcje: semantyka Messengera - ten sam emoji zdejmuje, inny podmienia.
  const handleReact = useCallback((message: ChatMessage, emoji: string, current: string | null) => {
    setReactions((prev) => {
      const next = new Map(prev);
      const list = (next.get(message.id) ?? []).filter((r) => r.user_id !== ME_ID);
      if (current !== emoji) list.push(demoReaction(message.id, ME_ID, emoji));
      if (list.length === 0) next.delete(message.id);
      else next.set(message.id, list);
      return next;
    });
  }, []);

  const handleReply = useCallback((message: ChatMessage) => {
    setReplyTo(message);
    textareaRef.current?.focus();
  }, []);

  // Usunięcie własnej wiadomości: tombstone jak w realnym wątku.
  const handleDelete = useCallback((message: ChatMessage) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === message.id ? { ...m, deleted_at: new Date().toISOString(), body: null } : m,
      ),
    );
    setReactions((prev) => {
      if (!prev.has(message.id)) return prev;
      const next = new Map(prev);
      next.delete(message.id);
      return next;
    });
  }, []);

  const noop = useCallback(() => undefined, []);
  const never = useCallback(() => false, []);

  const send = useCallback(() => {
    const body = input.trim();
    if (body.length === 0 || botTyping) return;
    const myId = nextId();
    const replyToId = replyTo?.id ?? null;
    setMessages((prev) => [
      ...prev,
      demoMessage(myId, ME_ID, body, new Date().toISOString(), {
        pending: true,
        reply_to_id: replyToId,
      }),
    ]);
    setInput("");
    setReplyTo(null);

    // Pełny cykl potwierdzeń na timestampach, jak w realnym czacie:
    // zegar (pending) -> tick wysłano -> podwójny dostarczono -> kolorowy
    // podwójny po odczycie.
    later(250, () => {
      setMessages((prev) => prev.map((m) => (m.id === myId ? { ...m, pending: false } : m)));
    });
    later(650, () => {
      setPeerDeliveredAt(new Date().toISOString());
      setBotTyping(true);
    });

    const reply = botReply(body, t);
    const typingMs = Math.min(1400, 700 + reply.length * 12);
    later(650 + typingMs, () => {
      const now = new Date().toISOString();
      setPeerReadAt(now);
      // Bot odbija cytat tylko, gdy użytkownik sam odpowiadał na dymek -
      // pokazuje obie strony funkcji bez zaśmiecania każdego echa.
      setMessages((prev) => [
        ...prev,
        demoMessage(nextId(), BOT_USER_ID, reply, now, {
          reply_to_id: replyToId ? myId : null,
        }),
      ]);
      setBotTyping(false);
      // Dłuższa wiadomość dostaje od bota reakcję - widać chip na dymku.
      if (body.length > 20) {
        setReactions((prev) => {
          const next = new Map(prev);
          next.set(myId, [
            ...(next.get(myId) ?? []).filter((r) => r.user_id !== BOT_USER_ID),
            demoReaction(myId, BOT_USER_ID, "👍"),
          ]);
          return next;
        });
      }
    });
  }, [input, botTyping, replyTo, nextId, later, t]);

  const replyAuthor = replyTo ? (replyTo.sender_id === ME_ID ? t("chat.you") : botName) : null;

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-background">
      {/* Header: 1:1 z nagłówkiem realnego ChatWindow (paddingi, rozmiary,
          typografia), plus jasny "Demo" badge przy nazwie. */}
      <header className="flex items-center gap-2.5 border-b border-border/60 px-3 py-2">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:hidden"
            aria-label={t("chat.back", { defaultValue: "Wróć" })}
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
          </button>
        )}
        <span className="relative inline-block shrink-0">
          <ChatAvatar name={botName} online size="sm" />
          <span
            className="absolute -right-1 -top-1 inline-flex h-4 w-4 items-center justify-center rounded-[6px] bg-[var(--brand)] text-white shadow-sm ring-2 ring-background"
            aria-hidden
          >
            <Bot className="h-2.5 w-2.5" />
          </span>
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 truncate text-sm font-semibold">
            <span className="truncate">{botName}</span>
            <span
              className="inline-flex shrink-0 items-center rounded-[6px] border border-border/60 bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
              aria-label={t("chat.demoBot.badge")}
            >
              {t("chat.demoBot.badge")}
            </span>
          </div>
          <div className="truncate text-[11px] text-muted-foreground">
            {botTyping ? t("chat.typing") : t("chat.demoBot.subtitle")}
          </div>
        </div>
      </header>

      {/* Realny MessageList: separatory dni, godziny, ticki, reakcje,
          odpowiedzi z cytatem, tombstone, typing - wszystko jak na żywo. */}
      <MessageList
        lang={lang}
        myUserId={ME_ID}
        messages={messages}
        reactions={reactions}
        peerName={botName}
        peerAvatarUrl={null}
        typingNames={[botName]}
        typingAvatarUrl={null}
        peerLastReadAt={peerReadAt}
        peerLastDeliveredAt={peerDeliveredAt}
        peerTyping={botTyping}
        hasOlder={false}
        loadingOlder={false}
        onLoadOlder={noop}
        onReact={handleReact}
        onReply={handleReply}
        onEdit={noop}
        onDelete={handleDelete}
        onDiscardFailed={noop}
        canEdit={never}
      />

      {/* Kompozytor: minimalny (bez załączników/emoji), ale z paskiem
          odpowiedzi - to jest podgląd interakcji, nie pełny composer. */}
      <div className="border-t border-border/60 bg-background/95 px-2 pb-2 pt-1.5">
        {replyTo && (
          <div className="mb-1.5 flex items-start justify-between gap-2 rounded-[6px] bg-muted/60 px-2.5 py-1.5">
            <div className="min-w-0 text-[11px]">
              <span className="block font-medium text-foreground">
                {t("chat.replyingTo")}
                {replyAuthor ? ` - ${replyAuthor}` : ""}
              </span>
              <span className="block truncate text-muted-foreground">
                {replyTo.deleted_at ? t("chat.deletedMessage") : replyTo.body}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setReplyTo(null)}
              className="shrink-0 rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label={t("chat.close")}
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
        )}
        {/* Te same klasy co realny ChatComposer: textarea na bg-muted/40 z
            radiusem 6px i okrągły przycisk wysyłki w kolorze tokenu czatu. */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
          className="flex items-end gap-1"
        >
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              } else if (e.key === "Escape" && replyTo) {
                e.preventDefault();
                setReplyTo(null);
              }
            }}
            rows={1}
            placeholder={t("chat.inputPlaceholder")}
            aria-label={t("chat.inputPlaceholder")}
            className="max-h-[120px] min-h-[36px] w-full min-w-0 flex-1 resize-none rounded-[6px] border border-input bg-muted/40 px-3 py-1.5 text-[13px] leading-relaxed placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            maxLength={500}
          />
          <button
            type="submit"
            disabled={input.trim().length === 0 || botTyping}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--chat-user-to)] transition-all hover:bg-muted disabled:opacity-35"
            aria-label={t("chat.send")}
            title={t("chat.send")}
          >
            <SendHorizontal className="h-4.5 w-4.5" aria-hidden />
          </button>
        </form>
      </div>
    </div>
  );
}
