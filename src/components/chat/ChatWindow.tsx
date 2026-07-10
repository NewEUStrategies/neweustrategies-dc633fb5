// Organism: a single conversation surface. Two variants:
//  - "dock": floating Messenger-style popup window (bottom-right)
//  - "page": fills the right pane of the /messages route
// Owns the realtime channel, read receipts, typing state and mutations.
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Minus, X } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/hooks/useAuth";
import {
  useConversations,
  useMarkConversationRead,
  usePeerProfiles,
} from "@/lib/chat/useConversations";
import {
  canEditMessage,
  useConversationChannel,
  useDeleteMessage,
  useDiscardFailedMessage,
  useEditMessage,
  useMessages,
  useReactions,
  useSendMessage,
  useToggleReaction,
} from "@/lib/chat/useMessages";
import { toast } from "sonner";
import { useOnlineUsers } from "@/lib/chat/presence";
import type { ChatLang } from "@/lib/chat/time";
import type { ChatMessage } from "@/lib/chat/types";
import { cn } from "@/lib/utils";
import { ChatAvatar } from "./ChatAvatar";
import { ChatComposer } from "./ChatComposer";
import { MessageList } from "./MessageList";

const TYPING_VISIBLE_MS = 4000;

export interface ChatWindowProps {
  conversationId: string;
  variant: "dock" | "page";
  onClose?: () => void;
  onMinimize?: () => void;
  /** Page variant only: mobile back-to-list action. */
  onBack?: () => void;
  autoFocus?: boolean;
  className?: string;
}

export function ChatWindow(props: ChatWindowProps) {
  const {
    conversationId,
    variant,
    onClose,
    onMinimize,
    onBack,
    autoFocus = true,
    className,
  } = props;
  const { t, i18n } = useTranslation();
  const lang: ChatLang = i18n.language === "en" ? "en" : "pl";
  const { user } = useAuth();
  const online = useOnlineUsers();

  const conversationsQ = useConversations();
  const view = conversationsQ.data?.find((v) => v.conversation.id === conversationId);
  const peerIds = useMemo(() => (view ? view.peers.map((p) => p.user_id) : []), [view]);
  const peersQ = usePeerProfiles(peerIds);
  const peerId = peerIds[0] ?? null;
  const peerProfile = peerId ? peersQ.data?.get(peerId) : undefined;
  const peerName = peerProfile?.display_name ?? "...";
  const peerAvatar = peerProfile?.avatar_url ?? null;
  const peerOnline = !!peerId && online.has(peerId);
  const peerLastReadAt = view?.peers[0]?.last_read_at ?? null;

  const messagesQ = useMessages(conversationId, true);
  const reactionsQ = useReactions(conversationId, true);
  const sendMessage = useSendMessage();
  const editMessage = useEditMessage(conversationId);
  const deleteMessage = useDeleteMessage(conversationId);
  const discardFailed = useDiscardFailedMessage(conversationId);
  const toggleReaction = useToggleReaction(conversationId);
  const markRead = useMarkConversationRead();

  const [peerTyping, setPeerTyping] = useState(false);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { sendTyping } = useConversationChannel(conversationId, true, () => {
    setPeerTyping(true);
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => setPeerTyping(false), TYPING_VISIBLE_MS);
  });
  useEffect(
    () => () => {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    },
    [],
  );

  const messages: ChatMessage[] = useMemo(() => {
    const pages = messagesQ.data?.pages ?? [];
    const flat = pages.flat();
    // Pages are newest-first; render oldest -> newest and drop duplicates
    // (an optimistic row can coexist with its realtime twin for a frame).
    const seen = new Set<string>();
    const ordered: ChatMessage[] = [];
    for (let i = flat.length - 1; i >= 0; i--) {
      const m = flat[i];
      if (m && !seen.has(m.id)) {
        seen.add(m.id);
        ordered.push(m);
      }
    }
    return ordered.sort((a, b) => a.created_at.localeCompare(b.created_at));
  }, [messagesQ.data]);

  // Read receipt: whenever the newest message is from the peer and this window
  // is visible, mark the thread read (clears the badge + shows "seen" to them).
  const lastMessage = messages[messages.length - 1];
  const unread = view?.me.unread_count ?? 0;
  useEffect(() => {
    if (!user || !lastMessage) return;
    if (document.visibilityState !== "visible") return;
    if (lastMessage.sender_id !== user.id && unread > 0) {
      markRead.mutate(conversationId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastMessage?.id, unread, conversationId, user?.id]);

  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [editTarget, setEditTarget] = useState<ChatMessage | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ChatMessage | null>(null);

  useEffect(() => {
    setReplyTo(null);
    setEditTarget(null);
    setDeleteTarget(null);
  }, [conversationId]);

  if (!user) return null;

  const peerTypingSafe = peerTyping && !!peerId;

  const body = (
    <>
      <MessageList
        lang={lang}
        myUserId={user.id}
        messages={messages}
        reactions={reactionsQ.data ?? new Map<string, never[]>()}
        peerName={peerName}
        peerAvatarUrl={peerAvatar}
        peerLastReadAt={peerLastReadAt}
        peerTyping={peerTypingSafe}
        hasOlder={!!messagesQ.hasNextPage}
        loadingOlder={messagesQ.isFetchingNextPage || messagesQ.isLoading}
        onLoadOlder={() => void messagesQ.fetchNextPage()}
        onReact={(message, emoji, current) =>
          toggleReaction.mutate({ messageId: message.id, emoji, current })
        }
        onReply={(message) => {
          setEditTarget(null);
          setReplyTo(message);
        }}
        onEdit={(message) => {
          setReplyTo(null);
          setEditTarget(message);
        }}
        onDelete={(message) => setDeleteTarget(message)}
        onDiscardFailed={(message) => discardFailed(message.id)}
        canEdit={(message) => canEditMessage(message, user.id)}
      />
      <ChatComposer
        conversationId={conversationId}
        lang={lang}
        replyTo={replyTo}
        replyToAuthor={replyTo ? (replyTo.sender_id === user.id ? t("chat.you") : peerName) : null}
        editing={editTarget}
        onClearReply={() => setReplyTo(null)}
        onSend={(input) => sendMessage.mutate(input)}
        onSaveEdit={(messageId, body) =>
          editMessage.mutate(
            { messageId, body },
            { onError: () => toast.error(t("chat.editExpired")) },
          )
        }
        onCancelEdit={() => setEditTarget(null)}
        onTyping={sendTyping}
        autoFocus={autoFocus}
      />
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("chat.deleteMessage")}</AlertDialogTitle>
            <AlertDialogDescription>{t("chat.deleteConfirm")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("chat.close")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteTarget) deleteMessage.mutate(deleteTarget.id);
                setDeleteTarget(null);
              }}
            >
              {t("chat.deleteMessage")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );

  if (variant === "page") {
    return (
      <div className={cn("flex h-full min-h-0 flex-col", className)}>
        <div className="flex items-center gap-2.5 border-b border-border/60 px-3 py-2">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-colors md:hidden"
              aria-label={t("chat.messages")}
            >
              <ArrowLeft className="h-4 w-4" aria-hidden />
            </button>
          )}
          <ChatAvatar name={peerName} avatarUrl={peerAvatar} online={peerOnline} size="sm" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{peerName}</div>
            <div className="text-[11px] text-muted-foreground">
              {peerOnline ? t("chat.online") : t("chat.offline")}
            </div>
          </div>
        </div>
        {body}
      </div>
    );
  }

  return (
    <section
      className={cn(
        "pointer-events-auto flex w-[320px] max-w-[calc(100vw-16px)] flex-col overflow-hidden",
        "h-[430px] max-h-[min(70vh,430px)] rounded-t-lg border border-b-0 border-border/60 bg-background shadow-2xl",
        "motion-safe:animate-in motion-safe:slide-in-from-bottom-4 motion-safe:fade-in-0 motion-safe:duration-200",
        className,
      )}
      role="dialog"
      aria-label={`${t("chat.title")}: ${peerName}`}
    >
      <header className="flex items-center gap-2 border-b border-border/60 bg-background px-2 py-1.5 shadow-sm">
        <ChatAvatar name={peerName} avatarUrl={peerAvatar} online={peerOnline} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold leading-tight">{peerName}</div>
          <div className="text-[10px] leading-tight text-muted-foreground">
            {peerOnline ? t("chat.online") : t("chat.offline")}
          </div>
        </div>
        {onMinimize && (
          <button
            type="button"
            onClick={onMinimize}
            className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            aria-label={t("chat.minimize")}
            title={t("chat.minimize")}
          >
            <Minus className="h-4 w-4" aria-hidden />
          </button>
        )}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            aria-label={t("chat.close")}
            title={t("chat.close")}
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        )}
      </header>
      {body}
    </section>
  );
}
