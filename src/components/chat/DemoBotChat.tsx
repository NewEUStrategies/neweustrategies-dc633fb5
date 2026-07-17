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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Bot, Images, Paperclip, SendHorizontal, X } from "lucide-react";
import { toast } from "sonner";
import type { ChatLang } from "@/lib/chat/time";
import type { ChatMessage, PeerProfile, ReactionRow } from "@/lib/chat/types";
import {
  ATTACHMENT_ACCEPT,
  attachmentKindForMime,
  validateAttachment,
  formatBytes,
  MAX_ATTACHMENT_BYTES,
  type AttachmentKind,
} from "@/lib/chat/attachments";
import { usePeerProfiles } from "@/lib/chat/useConversations";
import { useAuth } from "@/hooks/useAuth";
import { ChatAvatar } from "./ChatAvatar";
import { MessageList } from "./MessageList";
import { MediaHistoryDialog } from "./MediaHistoryDialog";
import botAvatarUrl from "@/assets/chat-bot-avatar.jpg";

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
  const { user } = useAuth();

  // Pobierz własny awatar, żeby demo pokazywało realne zdjęcie nadawcy.
  const peersQ = usePeerProfiles(user?.id ? [user.id] : []);
  const myAvatarUrl = user ? (peersQ.data?.get(user.id)?.avatar_url ?? null) : null;

  // Bot ma dedykowany awatar zamiast inicjału; własne demo-wiadomości
  // dostają realne zdjęcie profilowe po prawej stronie dymka.
  const senderProfiles = useMemo((): ReadonlyMap<string, PeerProfile> => {
    const map = new Map<string, PeerProfile>();
    map.set(BOT_USER_ID, {
      id: BOT_USER_ID,
      display_name: botName,
      avatar_url: botAvatarUrl,
      job_title: "",
      current_company: "",
      specialization: "",
    });
    if (user && myAvatarUrl) {
      map.set(ME_ID, {
        id: ME_ID,
        display_name: t("chat.you"),
        avatar_url: myAvatarUrl,
        job_title: "",
        current_company: "",
        specialization: "",
      });
    }
    return map;
  }, [botName, myAvatarUrl, t, user]);

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
  const [mediaHistoryOpen, setMediaHistoryOpen] = useState(false);
  // Staged local attachment - trzymamy `blob:` URL zamiast bucketu; podgląd
  // demo nie dotyka Storage. `useAttachmentUrl` przepuszcza blob:/data: URL
  // bez pytania Supabase, więc dymki renderują się identycznie jak realne.
  const [staged, setStaged] = useState<{
    file: File;
    kind: AttachmentKind;
    previewUrl: string;
  } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const timersRef = useRef<number[]>([]);
  const blobsRef = useRef<string[]>([]);

  useEffect(() => {
    const timers = timersRef.current;
    const blobs = blobsRef.current;
    return () => {
      for (const id of timers) window.clearTimeout(id);
      timers.length = 0;
      // Zwolnij wszystkie zarezerwowane URL-e - unikamy wycieku pamięci
      // w długiej sesji z wieloma podglądami.
      for (const u of blobs) URL.revokeObjectURL(u);
      blobs.length = 0;
    };
  }, []);
  const later = useCallback((ms: number, fn: () => void) => {
    timersRef.current.push(window.setTimeout(fn, ms));
  }, []);

  // Focus po zamontowaniu (parity z ChatWindow.autoFocus).
  useEffect(() => {
    textareaRef.current?.focus({ preventScroll: true });
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
    textareaRef.current?.focus({ preventScroll: true });
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

  // Pick + walidacja pliku (te same reguły co realny composer: MAX 30 MB,
  // ta sama allowlista MIME). Podgląd trzymamy tylko lokalnie.
  const handlePickFile = useCallback(
    (file: File | null | undefined) => {
      if (!file) return;
      const invalid = validateAttachment(file);
      if (invalid === "size") {
        toast.error(
          t("chat.attachmentTooLarge", {
            defaultValue: `Plik jest za duży (max ${formatBytes(MAX_ATTACHMENT_BYTES, lang)}).`,
          }),
        );
        return;
      }
      if (invalid === "type") {
        toast.error(
          t("chat.attachmentWrongType", {
            defaultValue: "Ten typ pliku nie jest obsługiwany.",
          }),
        );
        return;
      }
      const kind = attachmentKindForMime(file.type);
      if (!kind) return;
      // Zwolnij poprzedni podgląd, jeśli użytkownik podmienia załącznik.
      if (staged?.previewUrl) URL.revokeObjectURL(staged.previewUrl);
      const previewUrl = URL.createObjectURL(file);
      blobsRef.current.push(previewUrl);
      setStaged({ file, kind, previewUrl });
      textareaRef.current?.focus({ preventScroll: true });
    },
    [staged, t, lang],
  );

  const clearStaged = useCallback(() => {
    setStaged((prev) => {
      if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
      return null;
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const send = useCallback(() => {
    const body = input.trim();
    const hasAttachment = !!staged;
    if ((body.length === 0 && !hasAttachment) || botTyping) return;
    const myId = nextId();
    const replyToId = replyTo?.id ?? null;
    const attachmentExtra: Partial<ChatMessage> = staged
      ? {
          kind: staged.kind,
          attachment_path: staged.previewUrl,
          attachment_name: staged.file.name,
          attachment_mime: staged.file.type,
          attachment_size: staged.file.size,
        }
      : {};
    setMessages((prev) => [
      ...prev,
      demoMessage(myId, ME_ID, body.length > 0 ? body : null, new Date().toISOString(), {
        pending: true,
        reply_to_id: replyToId,
        ...attachmentExtra,
      }),
    ]);
    setInput("");
    setReplyTo(null);
    // Nie zwalniamy blob URL - dymek nadal go używa; zwolnimy przy unmount.
    setStaged(null);
    if (fileInputRef.current) fileInputRef.current.value = "";

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

    const reply = hasAttachment
      ? t(staged.kind === "image" ? "chat.demoBot.replies.image" : "chat.demoBot.replies.file", {
          defaultValue:
            staged.kind === "image"
              ? "Ładne zdjęcie! (podgląd demo - plik nie jest wysyłany)"
              : `Otrzymałem plik: ${staged.file.name} (podgląd demo).`,
          name: staged.file.name,
        })
      : botReply(body, t);
    const typingMs = Math.min(1400, 700 + reply.length * 12);
    later(650 + typingMs, () => {
      const now = new Date().toISOString();
      setPeerReadAt(now);
      setMessages((prev) => [
        ...prev,
        demoMessage(nextId(), BOT_USER_ID, reply, now, {
          reply_to_id: replyToId ? myId : null,
        }),
      ]);
      setBotTyping(false);
      if (body.length > 20 || hasAttachment) {
        setReactions((prev) => {
          const next = new Map(prev);
          next.set(myId, [
            ...(next.get(myId) ?? []).filter((r) => r.user_id !== BOT_USER_ID),
            demoReaction(myId, BOT_USER_ID, hasAttachment ? "🎉" : "👍"),
          ]);
          return next;
        });
      }
    });
  }, [input, staged, botTyping, replyTo, nextId, later, t]);

  const replyAuthor = replyTo ? (replyTo.sender_id === ME_ID ? t("chat.you") : botName) : null;

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-background">
      {/* Header: 1:1 z nagłówkiem realnego ChatWindow (paddingi, rozmiary,
          typografia), plus jasny "Demo" badge przy nazwie. */}
      <header className="flex items-center gap-2.5 border-b border-border/60 bg-card/80 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-card/70">
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
          <ChatAvatar name={botName} avatarUrl={botAvatarUrl} online size="sm" />
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
        <button
          type="button"
          onClick={() => setMediaHistoryOpen(true)}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label={t("chat.mediaHistory.open", { defaultValue: "Multimedia i pliki" })}
          title={t("chat.mediaHistory.open", { defaultValue: "Multimedia i pliki" })}
        >
          <Images className="h-4 w-4" aria-hidden />
        </button>
      </header>

      <MediaHistoryDialog
        open={mediaHistoryOpen}
        onOpenChange={setMediaHistoryOpen}
        messages={messages}
        lang={lang}
      />

      {/* Realny MessageList: separatory dni, godziny, ticki, reakcje,
          odpowiedzi z cytatem, tombstone, typing - wszystko jak na żywo. */}
      <MessageList
        lang={lang}
        myUserId={ME_ID}
        messages={messages}
        reactions={reactions}
        peerName={botName}
        peerAvatarUrl={botAvatarUrl}
        typingNames={[botName]}
        typingAvatarUrl={botAvatarUrl}
        myAvatarUrl={myAvatarUrl}
        senderProfiles={senderProfiles}
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

      {/* Kompozytor: pasek odpowiedzi, staged załącznik i wejście z załącznikiem. */}
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
        {staged && (
          <div className="mb-1.5 flex items-center gap-2 rounded-[6px] border border-border/60 bg-muted/40 px-2 py-1.5">
            {staged.kind === "image" ? (
              <img
                src={staged.previewUrl}
                alt={staged.file.name}
                className="h-10 w-10 shrink-0 rounded-[4px] object-cover"
              />
            ) : (
              <span
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[4px] bg-background text-muted-foreground"
                aria-hidden
              >
                <Paperclip className="h-4 w-4" />
              </span>
            )}
            <div className="min-w-0 flex-1 text-[11px]">
              <span className="block truncate font-medium text-foreground">{staged.file.name}</span>
              <span className="block text-muted-foreground">
                {formatBytes(staged.file.size, lang)}
              </span>
            </div>
            <button
              type="button"
              onClick={clearStaged}
              className="shrink-0 rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label={t("chat.close")}
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
          className="group/composer relative flex min-h-12 w-full items-end gap-1.5 rounded-2xl border border-input/70 bg-background/80 px-2 py-1.5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.12)] backdrop-blur-sm transition-all focus-within:border-ring focus-within:shadow-[0_1px_2px_rgba(0,0,0,0.04),0_10px_28px_-12px_color-mix(in_oklab,var(--ring)_45%,transparent)]"
        >
          <input
            ref={fileInputRef}
            type="file"
            accept={ATTACHMENT_ACCEPT}
            className="hidden"
            onChange={(e) => {
              handlePickFile(e.target.files?.[0]);
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={botTyping}
            className="group/attach relative mb-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-all hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
            aria-label={t("chat.attach", { defaultValue: "Załącz plik" })}
          >
            <Paperclip className="h-[18px] w-[18px]" aria-hidden />
            <span className="pointer-events-none absolute -top-9 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-[10px] font-medium text-popover-foreground shadow-md group-hover/attach:block">
              {t("chat.attach", { defaultValue: "Załącz plik" })}
            </span>
          </button>
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
              } else if (e.key === "Escape" && staged) {
                e.preventDefault();
                clearStaged();
              }
            }}
            rows={1}
            placeholder={
              staged
                ? t("chat.attachmentCaptionPlaceholder", {
                    defaultValue: "Dodaj opis (opcjonalnie)...",
                  })
                : t("chat.inputPlaceholder")
            }
            aria-label={t("chat.inputPlaceholder")}
            className="max-h-[140px] min-h-[36px] w-full min-w-0 flex-1 resize-none self-center border-0 bg-transparent px-1 py-1.5 text-[14px] leading-relaxed text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:outline-none focus-visible:ring-0"
            maxLength={500}
          />
          <button
            type="submit"
            disabled={(input.trim().length === 0 && !staged) || botTyping}
            className="mb-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm transition-all hover:brightness-110 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none"
            aria-label={t("chat.send")}
            title={t("chat.send")}
          >
            <SendHorizontal className="h-[18px] w-[18px]" aria-hidden />
          </button>
        </form>

      </div>
    </div>
  );
}
