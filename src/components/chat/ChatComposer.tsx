// Organism: message composer - auto-growing textarea, emoji picker,
// attachments (images + documents, 30 MB) with upload progress, WhatsApp-style
// voice notes (mic morphs into send as you type), reply bar, throttled typing
// broadcast. Enter sends, Shift+Enter breaks the line.
import { lazy, memo, Suspense, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Check,
  Mic,
  Paperclip,
  Pencil,
  SendHorizontal,
  Smile,
  Trash2,
  X,
  Image as ImageIcon,
  FileText,
} from "lucide-react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { useAuth } from "@/hooks/useAuth";
import {
  ATTACHMENT_ACCEPT,
  MAX_ATTACHMENT_BYTES,
  attachmentKindForMime,
  formatBytes,
  uploadChatAttachment,
  validateAttachment,
} from "@/lib/chat/attachments";
import { formatVoiceDuration, useVoiceRecorder, type RecordedVoice } from "@/lib/chat/voice";
import type { SendMessageInput } from "@/lib/chat/useMessages";
import type { ChatMessage } from "@/lib/chat/types";
import type { ChatLang } from "@/lib/chat/time";
import { cn } from "@/lib/utils";
// Lazy: the emoji dataset (~20 KB) loads only when the picker first opens.
const EmojiPicker = lazy(() => import("./EmojiPicker").then((m) => ({ default: m.EmojiPicker })));

const TYPING_THROTTLE_MS = 2500;
const MAX_BODY_LENGTH = 8000;

export interface ChatComposerProps {
  conversationId: string;
  lang: ChatLang;
  replyTo: ChatMessage | null;
  replyToAuthor: string | null;
  /** Non-null while editing an own message (5-minute window). */
  editing: ChatMessage | null;
  onClearReply: () => void;
  onSend: (input: SendMessageInput) => void;
  onSaveEdit: (messageId: string, body: string) => void;
  onCancelEdit: () => void;
  onTyping: () => void;
  autoFocus?: boolean;
}

// Memoized: with stable callbacks from ChatWindow, keystrokes and typing
// broadcasts in the thread above never re-render the composer subtree.
export const ChatComposer = memo(function ChatComposer(props: ChatComposerProps) {
  const {
    conversationId,
    lang,
    replyTo,
    replyToAuthor,
    editing,
    onClearReply,
    onSend,
    onSaveEdit,
    onCancelEdit,
    onTyping,
    autoFocus,
  } = props;
  const { t } = useTranslation();
  const { user, tenantId } = useAuth();
  const [text, setText] = useState("");
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [uploading, setUploading] = useState<{ name: string; percent: number } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const lastTypingRef = useRef(0);

  const resize = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  };

  const emitTyping = () => {
    const now = Date.now();
    if (now - lastTypingRef.current > TYPING_THROTTLE_MS) {
      lastTypingRef.current = now;
      onTyping();
    }
  };

  // Entering/leaving edit mode swaps the draft for the message body.
  useEffect(() => {
    if (editing) {
      setText(editing.body ?? "");
      requestAnimationFrame(() => {
        resize();
        const el = textareaRef.current;
        if (el) {
          el.focus();
          el.setSelectionRange(el.value.length, el.value.length);
        }
      });
    } else {
      setText("");
      requestAnimationFrame(resize);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing?.id]);

  const sendText = () => {
    const body = text.trim();
    if (!body) return;
    if (editing) {
      if (body !== (editing.body ?? "").trim()) {
        onSaveEdit(editing.id, body.slice(0, MAX_BODY_LENGTH));
      }
      onCancelEdit();
      return;
    }
    onSend({
      conversationId,
      kind: "text",
      body: body.slice(0, MAX_BODY_LENGTH),
      replyToId: replyTo?.id ?? null,
    });
    setText("");
    onClearReply();
    requestAnimationFrame(() => {
      resize();
      textareaRef.current?.focus();
    });
  };

  const sendFile = async (file: File) => {
    if (!user || !tenantId) return;
    const invalid = validateAttachment(file);
    if (invalid === "size") {
      toast.error(t("chat.attachmentTooLarge"));
      return;
    }
    if (invalid === "type") {
      toast.error(t("chat.attachmentWrongType"));
      return;
    }
    const kind = attachmentKindForMime(file.type);
    if (!kind) return;
    setUploading({ name: file.name, percent: 0 });
    try {
      const uploaded = await uploadChatAttachment({
        file,
        tenantId,
        conversationId,
        userId: user.id,
        onProgress: (percent) => setUploading({ name: file.name, percent }),
      });
      onSend({
        conversationId,
        kind,
        attachment: uploaded,
        replyToId: replyTo?.id ?? null,
      });
      onClearReply();
    } catch {
      toast.error(t("chat.uploadFailed"));
    } finally {
      setUploading(null);
    }
  };

  // --- Voice notes ---------------------------------------------------------
  const sendVoice = async (voice: RecordedVoice | null) => {
    if (!voice || !user || !tenantId) return;
    if (voice.file.size > MAX_ATTACHMENT_BYTES) {
      toast.error(t("chat.attachmentTooLarge"));
      return;
    }
    setUploading({ name: t("chat.voice.message"), percent: 0 });
    try {
      const uploaded = await uploadChatAttachment({
        file: voice.file,
        tenantId,
        conversationId,
        userId: user.id,
        onProgress: (percent) => setUploading({ name: t("chat.voice.message"), percent }),
      });
      onSend({
        conversationId,
        kind: "audio",
        attachment: { ...uploaded, duration: voice.durationSeconds },
        replyToId: replyTo?.id ?? null,
      });
      onClearReply();
    } catch {
      toast.error(t("chat.uploadFailed"));
    } finally {
      setUploading(null);
    }
  };

  const recorder = useVoiceRecorder({
    onLimitReached: (voice) => void sendVoice(voice),
    onError: (kind) =>
      toast.error(kind === "denied" ? t("chat.voice.micDenied") : t("chat.voice.unsupported")),
  });
  const recording = recorder.state !== "idle";

  const insertEmoji = (emoji: string) => {
    const el = textareaRef.current;
    if (!el) {
      setText((v) => v + emoji);
      return;
    }
    const start = el.selectionStart ?? text.length;
    const end = el.selectionEnd ?? text.length;
    const next = text.slice(0, start) + emoji + text.slice(end);
    setText(next);
    requestAnimationFrame(() => {
      el.focus();
      const caret = start + emoji.length;
      el.setSelectionRange(caret, caret);
      resize();
    });
  };

  return (
    <div className="border-t border-border/60 bg-background/95 px-2 pb-2 pt-1.5">
      {editing && (
        <div className="mb-1.5 flex items-center justify-between gap-2 rounded-[6px] bg-muted/60 px-2.5 py-1.5">
          <div className="flex min-w-0 items-center gap-1.5 text-[11px]">
            <Pencil className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
            <span className="font-medium">{t("chat.editingMessage")}</span>
          </div>
          <button
            type="button"
            onClick={onCancelEdit}
            className="shrink-0 rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            aria-label={t("chat.cancelEdit")}
            title={t("chat.cancelEdit")}
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      )}

      {!editing && replyTo && (
        <div className="mb-1.5 flex items-start justify-between gap-2 rounded-[6px] bg-muted/60 px-2.5 py-1.5">
          <div className="min-w-0 text-[11px]">
            <span className="block font-medium text-foreground">
              {t("chat.replyingTo")}
              {replyToAuthor ? ` - ${replyToAuthor}` : ""}
            </span>
            <span className="block truncate text-muted-foreground">
              {replyTo.deleted_at
                ? t("chat.deletedMessage")
                : (replyTo.body ?? (replyTo.kind === "image" ? t("chat.photo") : t("chat.file")))}
            </span>
          </div>
          <button
            type="button"
            onClick={onClearReply}
            className="shrink-0 rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            aria-label={t("chat.close")}
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      )}

      {uploading && (
        <div className="mb-1.5 rounded-[6px] bg-muted/60 px-2.5 py-1.5">
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            {/\.(jpe?g|png|gif|svg|webp)$/i.test(uploading.name) ? (
              <ImageIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />
            ) : (
              <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden />
            )}
            <span className="min-w-0 flex-1 truncate">{uploading.name}</span>
            <span className="shrink-0 tabular-nums">{uploading.percent}%</span>
          </div>
          <Progress value={uploading.percent} className="mt-1 h-1" />
        </div>
      )}

      {recording ? (
        <div
          className="flex h-10 items-center gap-2 rounded-[6px] border border-destructive/30 bg-destructive/5 px-2"
          role="status"
          aria-label={t("chat.voice.recording")}
        >
          <span
            className="ml-1 h-2.5 w-2.5 shrink-0 rounded-full bg-destructive motion-safe:animate-pulse"
            aria-hidden
          />
          <span className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">
            {t("chat.voice.recording")}
          </span>
          <span className="shrink-0 text-[12px] font-medium tabular-nums">
            {formatVoiceDuration(recorder.elapsed)}
          </span>
          <button
            type="button"
            onClick={() => recorder.cancel()}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
            aria-label={t("chat.voice.cancel")}
            title={t("chat.voice.cancel")}
          >
            <Trash2 className="h-4 w-4" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => void recorder.finish().then(sendVoice)}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--brand)] text-white transition-opacity hover:opacity-90"
            aria-label={t("chat.voice.send")}
            title={t("chat.voice.send")}
          >
            <SendHorizontal className="h-4 w-4" aria-hidden />
          </button>
        </div>
      ) : (
        <div className="flex items-end gap-1">
          <input
            ref={fileInputRef}
            type="file"
            accept={ATTACHMENT_ACCEPT}
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void sendFile(file);
              e.target.value = "";
            }}
          />
          {!editing && (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={!!uploading}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-40"
              aria-label={t("chat.attach")}
              title={`${t("chat.attach")} (max ${formatBytes(30 * 1024 * 1024, lang)})`}
            >
              <Paperclip className="h-4 w-4" aria-hidden />
            </button>
          )}

          <div className="relative min-w-0 flex-1">
            <textarea
              ref={textareaRef}
              value={text}
              rows={1}
              autoFocus={autoFocus}
              maxLength={MAX_BODY_LENGTH}
              onChange={(e) => {
                setText(e.target.value);
                resize();
                emitTyping();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendText();
                } else if (e.key === "Escape" && editing) {
                  // Cancel the edit only - do not bubble up to the dock
                  // window's Escape-to-close handler.
                  e.preventDefault();
                  e.stopPropagation();
                  onCancelEdit();
                }
              }}
              placeholder={t("chat.inputPlaceholder")}
              aria-label={t("chat.inputPlaceholder")}
              className="max-h-[120px] w-full resize-none rounded-[6px] border border-input bg-muted/40 py-1.5 pl-3 pr-9 text-[13px] leading-relaxed placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    "absolute bottom-[7px] right-2 flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                    emojiOpen && "text-foreground",
                  )}
                  aria-label={t("chat.emoji")}
                  title={t("chat.emoji")}
                >
                  <Smile className="h-4 w-4" aria-hidden />
                </button>
              </PopoverTrigger>
              <PopoverContent
                side="top"
                align="end"
                sideOffset={8}
                className="w-auto overflow-hidden border-border/60 bg-popover p-0 shadow-xl"
              >
                <Suspense
                  fallback={<div className="h-[264px] w-[288px] animate-pulse bg-muted/40" />}
                >
                  <EmojiPicker
                    onPick={(emoji) => {
                      insertEmoji(emoji);
                    }}
                  />
                </Suspense>
              </PopoverContent>
            </Popover>
          </div>

          {!editing && !text.trim() && recorder.supported ? (
            // WhatsApp morph: empty input shows the mic, typing swaps it for send.
            <button
              type="button"
              onClick={() => void recorder.start()}
              disabled={!!uploading}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--brand)] transition-all hover:bg-muted disabled:opacity-35"
              aria-label={t("chat.voice.record")}
              title={t("chat.voice.record")}
            >
              <Mic className="h-4.5 w-4.5" aria-hidden />
            </button>
          ) : (
            <button
              type="button"
              onClick={sendText}
              disabled={!text.trim()}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--brand)] transition-all hover:bg-muted disabled:opacity-35"
              aria-label={editing ? t("chat.saveEdit") : t("chat.send")}
              title={editing ? t("chat.saveEdit") : t("chat.send")}
            >
              {editing ? (
                <Check className="h-4.5 w-4.5" aria-hidden />
              ) : (
                <SendHorizontal className="h-4.5 w-4.5" aria-hidden />
              )}
            </button>
          )}
        </div>
      )}
    </div>
  );
});
