// Organism: a single conversation surface. Two variants:
//  - "dock": floating Messenger-style popup window (bottom-right)
//  - "page": fills the right pane of the /messages route
// Owns the realtime channel, read receipts, typing state and mutations.
// Registers the chat i18n bundle for every surface that renders messages
// (the /messages route must NOT import it at module top level - that would
// pull the strings into the eager entry graph).
import "@/lib/i18n-chat";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Ban,
  BellOff,
  Check,
  Eraser,
  Images,
  Minus,
  MoreVertical,
  Pin,
  PinOff,
  Timer,
  X,
} from "lucide-react";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAuth } from "@/hooks/useAuth";
import {
  isMuted as isConversationMuted,
  useClearConversationHistory,
  useConversations,
  useMarkConversationRead,
  usePeerProfiles,
  useSetConversationArchived,
  useSetConversationMuted,
  useSetConversationPinned,
  useSetMessageTtl,
} from "@/lib/chat/useConversations";
import { isExpired, MESSAGE_TTL_OPTIONS } from "@/lib/chat/receipts";
import { useStarredIds, useToggleStar } from "@/lib/chat/stars";
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
  type SendMessageInput,
} from "@/lib/chat/useMessages";
import { toast } from "sonner";
import { useBlockUser, useMyBlocks, useUnblockUser } from "@/lib/chat/useBlocks";
import { useNotificationPreferences } from "@/lib/notifications/useNotifications";
import { useOnlineUsers } from "@/lib/chat/presence";
import { usePrefetchAttachmentUrls } from "@/lib/chat/attachments";
import type { ChatLang } from "@/lib/chat/time";
import type { ChatMessage } from "@/lib/chat/types";
import { cn } from "@/lib/utils";
import { ChatAvatar } from "./ChatAvatar";
import { ChatComposer } from "./ChatComposer";
import { ChatMediaPanel } from "./ChatMediaPanel";
import { MessageList } from "./MessageList";

const TYPING_VISIBLE_MS = 4000;
const EMPTY_REACTIONS_MAP: ReadonlyMap<string, never[]> = new Map();

// Reactive tab visibility - the read-receipt effect must re-run when the user
// returns to the tab, not only when a dependency happens to change.
function subscribeVisibility(callback: () => void) {
  document.addEventListener("visibilitychange", callback);
  return () => document.removeEventListener("visibilitychange", callback);
}
const getDocumentVisible = () => document.visibilityState === "visible";
const getDocumentVisibleServer = () => false;

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
  const peerLastDeliveredAt = view?.peers[0]?.last_delivered_at ?? null;
  const pinned = !!view?.me.pinned_at;
  const archived = !!view?.me.archived_at;
  const muted = view ? isConversationMuted(view) : false;
  const ttlSeconds = view?.conversation.message_ttl_seconds ?? null;

  const messagesQ = useMessages(conversationId, true);
  const reactionsQ = useReactions(conversationId, true);
  const sendMessage = useSendMessage();
  const editMessage = useEditMessage(conversationId);
  const deleteMessage = useDeleteMessage(conversationId);
  const discardFailed = useDiscardFailedMessage(conversationId);
  const toggleReaction = useToggleReaction(conversationId);
  const markRead = useMarkConversationRead();
  const starredIdsQ = useStarredIds(conversationId, true);
  const toggleStar = useToggleStar(conversationId);
  const setPinned = useSetConversationPinned();
  const setArchived = useSetConversationArchived();
  const setMuted = useSetConversationMuted();
  const clearHistory = useClearConversationHistory();
  const setMessageTtl = useSetMessageTtl();

  // Block state: RLS only exposes MY blocks, so this covers "I blocked the
  // peer"; the reverse direction is enforced server-side ("chat: blocked").
  const blocksQ = useMyBlocks();
  const blockUser = useBlockUser();
  const unblockUser = useUnblockUser();
  const peerBlocked = !!peerId && !!blocksQ.data?.has(peerId);

  // Privacy preference: with typing indicators off we never broadcast our own
  // "typing..." pings (receiving the peer's stays unaffected).
  const prefsQ = useNotificationPreferences();
  const typingEnabled = prefsQ.data?.typing_indicators_enabled ?? true;

  const [peerTyping, setPeerTyping] = useState(false);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { sendTyping } = useConversationChannel(conversationId, true, (event) => {
    if (event.typing === false) {
      // Explicit stop (the peer just sent a message) - clear immediately
      // instead of letting the 4s timeout linger under the fresh bubble.
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
      setPeerTyping(false);
      return;
    }
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

  // Minute tick: the 5-minute edit window must close visually even when
  // nothing else re-renders, and disappearing messages must vanish live
  // between refetches. Only the list shell re-renders on a tick - memoized
  // bubbles re-render solely when their own `editable` flips.
  const [editTick, setEditTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setEditTick((n) => n + 1), 60_000);
    return () => clearInterval(timer);
  }, []);

  const messages: ChatMessage[] = useMemo(() => {
    // editTick keeps the expiry cutoff fresh: disappearing messages vanish on
    // the minute tick instead of waiting for the next refetch (RLS is the
    // authority; this mirrors it client-side).
    const nowMs = editTick >= 0 ? Date.now() : 0;
    const pages = messagesQ.data?.pages ?? [];
    const flat = pages.flatMap((page) => page.rows).filter((m) => !isExpired(m, nowMs));
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
    // ISO-8601 sorts lexicographically; plain compare beats localeCompare.
    // Id tiebreaker keeps equal-timestamp rows (optimistic vs server clock)
    // in a stable order across re-renders.
    return ordered.sort((a, b) =>
      a.created_at < b.created_at
        ? -1
        : a.created_at > b.created_at
          ? 1
          : a.id < b.id
            ? -1
            : a.id > b.id
              ? 1
              : 0,
    );
  }, [messagesQ.data, editTick]);

  // One batched storage call signs every attachment in the loaded history.
  const attachmentPaths = useMemo(
    () =>
      messages
        .filter((m) => !!m.attachment_path && !m.deleted_at && !m.pending)
        .map((m) => m.attachment_path as string),
    [messages],
  );
  usePrefetchAttachmentUrls(attachmentPaths);

  // Read receipt: whenever the newest message is from the peer and the tab is
  // visible, mark the thread read (clears the badge + shows "seen" to them).
  // Coalesced client-side per message id (the RPC also no-ops server-side when
  // there is nothing new, so no realtime fanout happens for repeats). The
  // visibility flag is reactive, so returning to a hidden tab marks pending
  // unreads immediately.
  const visible = useSyncExternalStore(
    subscribeVisibility,
    getDocumentVisible,
    getDocumentVisibleServer,
  );
  const lastMessage = messages[messages.length - 1];
  const unread = view?.me.unread_count ?? 0;
  const lastMarkedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!user || !lastMessage || !visible) return;
    if (lastMessage.sender_id !== user.id && unread > 0) {
      if (lastMarkedRef.current === lastMessage.id) return;
      lastMarkedRef.current = lastMessage.id;
      markRead.mutate(conversationId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastMessage?.id, unread, conversationId, user?.id, visible]);

  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [editTarget, setEditTarget] = useState<ChatMessage | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ChatMessage | null>(null);
  const [mediaOpen, setMediaOpen] = useState(false);
  const [blockDialogOpen, setBlockDialogOpen] = useState(false);

  useEffect(() => {
    setReplyTo(null);
    setEditTarget(null);
    setDeleteTarget(null);
    setBlockDialogOpen(false);
  }, [conversationId]);

  // Stable handlers: MessageBubble is memoized, so these references must not
  // change per render or the memo is defeated for the whole thread.
  const uid = user?.id;
  const { mutate: mutateReaction } = toggleReaction;
  const handleReact = useCallback(
    (message: ChatMessage, emoji: string, current: string | null) =>
      mutateReaction({ messageId: message.id, emoji, current }),
    [mutateReaction],
  );
  const handleReply = useCallback((message: ChatMessage) => {
    setEditTarget(null);
    setReplyTo(message);
  }, []);
  const handleEdit = useCallback((message: ChatMessage) => {
    setReplyTo(null);
    setEditTarget(message);
  }, []);
  const handleDelete = useCallback((message: ChatMessage) => setDeleteTarget(message), []);
  const handleDiscardFailed = useCallback(
    (message: ChatMessage) => discardFailed(message.id),
    [discardFailed],
  );
  const canEdit = useCallback(
    (message: ChatMessage) => (uid ? canEditMessage(message, uid) : false),
    [uid],
  );
  const { fetchNextPage } = messagesQ;
  const handleLoadOlder = useCallback(() => void fetchNextPage(), [fetchNextPage]);
  const handleClearReply = useCallback(() => setReplyTo(null), []);
  const handleCancelEdit = useCallback(() => setEditTarget(null), []);
  const handleTyping = useCallback(
    (typing?: boolean) => {
      if (typingEnabled) sendTyping(typing);
    },
    [typingEnabled, sendTyping],
  );
  const { mutate: mutateSend } = sendMessage;
  const handleSend = useCallback(
    (input: SendMessageInput) => {
      // The outgoing message supersedes the typing state on the peer's side -
      // broadcast an explicit stop so their indicator clears instantly.
      handleTyping(false);
      mutateSend(input, {
        onError: (err) => {
          // The mutation's own onError already flipped the optimistic row to
          // its failed state; here we only translate the server verdict.
          if (err.message.includes("chat: blocked")) toast.error(t("chat.block.sendBlocked"));
          else if (err.message.includes("recipient unavailable"))
            toast.error(t("chat.recipientUnavailable"));
          else if (err.message.includes("rate limited")) toast.error(t("chat.rateLimited"));
        },
      });
    },
    [mutateSend, handleTyping, t],
  );
  const { mutate: mutateBlock } = blockUser;
  const { mutate: mutateUnblock } = unblockUser;
  const handleUnblock = useCallback(() => {
    if (peerId) mutateUnblock(peerId, { onError: () => toast.error(t("chat.block.error")) });
  }, [peerId, mutateUnblock, t]);
  const handleConfirmBlockToggle = useCallback(() => {
    if (!peerId) return;
    if (peerBlocked) mutateUnblock(peerId, { onError: () => toast.error(t("chat.block.error")) });
    else mutateBlock(peerId, { onError: () => toast.error(t("chat.block.error")) });
  }, [peerId, peerBlocked, mutateBlock, mutateUnblock, t]);
  const { mutate: mutateEdit } = editMessage;
  const handleSaveEdit = useCallback(
    (messageId: string, body: string) =>
      mutateEdit({ messageId, body }, { onError: () => toast.error(t("chat.editExpired")) }),
    [mutateEdit, t],
  );
  const { mutate: mutateToggleStar } = toggleStar;
  const handleToggleStar = useCallback(
    (message: ChatMessage, starred: boolean) => {
      if (message.pending || message.failed || message.deleted_at) return;
      mutateToggleStar(
        { messageId: message.id, starred },
        { onError: () => toast.error(t("chat.star.error")) },
      );
    },
    [mutateToggleStar, t],
  );

  // Conversation menu state + actions (pin / archive / mute / clear / ttl).
  const [menuOpen, setMenuOpen] = useState(false);
  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const settingErr = () => toast.error(t("chat.menu.error"));
  const handlePinToggle = () => {
    setMenuOpen(false);
    setPinned.mutate(
      { conversationId, pinned: !pinned },
      {
        onError: (err) =>
          err.message.includes("pin limit") ? toast.error(t("chat.menu.pinLimit")) : settingErr(),
      },
    );
  };
  const handleArchiveToggle = () => {
    setMenuOpen(false);
    setArchived.mutate(
      { conversationId, archived: !archived },
      {
        onSuccess: () =>
          toast.success(archived ? t("chat.menu.unarchived") : t("chat.menu.archived")),
        onError: settingErr,
      },
    );
  };
  const handleMute = (seconds: number | null) => {
    setMenuOpen(false);
    setMuted.mutate({ conversationId, seconds }, { onError: settingErr });
  };
  const handleTtl = (seconds: number | null) => {
    setMenuOpen(false);
    setMessageTtl.mutate(
      { conversationId, ttlSeconds: seconds },
      {
        onSuccess: () => toast.success(t("chat.disappearing.saved")),
        onError: settingErr,
      },
    );
  };
  const handleClearHistory = () => {
    setClearDialogOpen(false);
    clearHistory.mutate(
      { conversationId },
      {
        onSuccess: () => toast.success(t("chat.menu.cleared")),
        onError: settingErr,
      },
    );
  };

  if (!user) return null;

  const peerTypingSafe = peerTyping && !!peerId;

  const mediaToggle = (
    <button
      type="button"
      onClick={() => setMediaOpen((v) => !v)}
      className={cn(
        "flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
        mediaOpen && "bg-muted text-foreground",
      )}
      aria-label={mediaOpen ? t("chat.mediaPanel.close") : t("chat.mediaPanel.open")}
      aria-pressed={mediaOpen}
      title={mediaOpen ? t("chat.mediaPanel.close") : t("chat.mediaPanel.open")}
    >
      <Images className="h-4 w-4" aria-hidden />
    </button>
  );

  const blockToggle = peerId ? (
    <button
      type="button"
      onClick={() => setBlockDialogOpen(true)}
      className={cn(
        "flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
        peerBlocked && "text-destructive hover:text-destructive",
      )}
      aria-label={peerBlocked ? t("chat.block.unblock") : t("chat.block.block")}
      aria-haspopup="dialog"
      title={peerBlocked ? t("chat.block.unblock") : t("chat.block.block")}
    >
      <Ban className="h-4 w-4" aria-hidden />
    </button>
  ) : null;

  const menuItemClass =
    "flex w-full items-center gap-2 rounded-[6px] px-2 py-1.5 text-left text-[12px] transition-colors hover:bg-muted";
  const menuHeadingClass =
    "px-2 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground";
  const conversationMenu = (
    <Popover open={menuOpen} onOpenChange={setMenuOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
            menuOpen && "bg-muted text-foreground",
          )}
          aria-label={t("chat.menu.title")}
          aria-haspopup="menu"
          title={t("chat.menu.title")}
        >
          <MoreVertical className="h-4 w-4" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="end"
        sideOffset={4}
        className="w-60 rounded-[6px] border-border/60 bg-popover p-1.5 shadow-xl"
      >
        <div role="menu" aria-label={t("chat.menu.title")} className="flex flex-col">
          <button type="button" role="menuitem" onClick={handlePinToggle} className={menuItemClass}>
            {pinned ? (
              <PinOff className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            ) : (
              <Pin className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            )}
            {pinned ? t("chat.menu.unpin") : t("chat.menu.pin")}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={handleArchiveToggle}
            className={menuItemClass}
          >
            {archived ? (
              <ArchiveRestore className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            ) : (
              <Archive className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            )}
            {archived ? t("chat.menu.unarchive") : t("chat.menu.archive")}
          </button>

          <p className={menuHeadingClass}>{t("chat.menu.muteSection")}</p>
          {muted ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => handleMute(null)}
              className={menuItemClass}
            >
              <BellOff className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
              {t("chat.menu.unmute")}
            </button>
          ) : (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={() => handleMute(8 * 3600)}
                className={menuItemClass}
              >
                <BellOff className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                {t("chat.menu.mute8h")}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => handleMute(7 * 86400)}
                className={menuItemClass}
              >
                <BellOff className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                {t("chat.menu.muteWeek")}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => handleMute(-1)}
                className={menuItemClass}
              >
                <BellOff className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                {t("chat.menu.muteAlways")}
              </button>
            </>
          )}

          <p className={menuHeadingClass}>{t("chat.disappearing.title")}</p>
          {[null, ...MESSAGE_TTL_OPTIONS].map((option) => {
            const active = (ttlSeconds ?? null) === option;
            const label =
              option === null
                ? t("chat.disappearing.off")
                : option === 86400
                  ? t("chat.disappearing.day")
                  : option === 604800
                    ? t("chat.disappearing.week")
                    : t("chat.disappearing.quarter");
            return (
              <button
                key={option ?? "off"}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => handleTtl(option)}
                className={cn(menuItemClass, active && "bg-muted font-medium")}
              >
                <Timer className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                <span className="flex-1">{label}</span>
                {active && <Check className="h-3.5 w-3.5 text-[var(--brand)]" aria-hidden />}
              </button>
            );
          })}

          <div className="my-1 h-px bg-border/60" aria-hidden />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenuOpen(false);
              setClearDialogOpen(true);
            }}
            className={cn(menuItemClass, "text-destructive hover:text-destructive")}
          >
            <Eraser className="h-3.5 w-3.5" aria-hidden />
            {t("chat.menu.clear")}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );

  const mainCol = (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <MessageList
        lang={lang}
        myUserId={user.id}
        messages={messages}
        reactions={reactionsQ.data ?? EMPTY_REACTIONS_MAP}
        peerName={peerName}
        peerAvatarUrl={peerAvatar}
        peerLastReadAt={peerLastReadAt}
        peerLastDeliveredAt={peerLastDeliveredAt}
        peerTyping={peerTypingSafe}
        ttlSeconds={ttlSeconds}
        starredIds={starredIdsQ.data}
        hasOlder={!!messagesQ.hasNextPage}
        loadingOlder={messagesQ.isFetchingNextPage || messagesQ.isLoading}
        onLoadOlder={handleLoadOlder}
        onReact={handleReact}
        onReply={handleReply}
        onEdit={handleEdit}
        onDelete={handleDelete}
        onDiscardFailed={handleDiscardFailed}
        onToggleStar={handleToggleStar}
        canEdit={canEdit}
      />
      {peerBlocked ? (
        <div className="border-t border-border/60 bg-background/95 px-3 py-2.5 text-center">
          <p className="text-[12px] text-muted-foreground">{t("chat.block.composerNotice")}</p>
          <button
            type="button"
            onClick={handleUnblock}
            disabled={unblockUser.isPending}
            className="mt-1.5 rounded-[6px] border border-border/60 px-3 py-1 text-[12px] font-medium transition-colors hover:bg-muted disabled:opacity-50"
          >
            {t("chat.block.unblock")}
          </button>
        </div>
      ) : (
        <ChatComposer
          conversationId={conversationId}
          lang={lang}
          replyTo={replyTo}
          replyToAuthor={
            replyTo ? (replyTo.sender_id === user.id ? t("chat.you") : peerName) : null
          }
          editing={editTarget}
          onClearReply={handleClearReply}
          onSend={handleSend}
          onSaveEdit={handleSaveEdit}
          onCancelEdit={handleCancelEdit}
          onTyping={handleTyping}
          autoFocus={autoFocus}
        />
      )}
    </div>
  );

  const panel = mediaOpen ? (
    <ChatMediaPanel
      conversationId={conversationId}
      enabled={mediaOpen}
      onClose={() => setMediaOpen(false)}
      className={variant === "dock" ? "w-[180px] shrink-0" : "w-[260px] shrink-0 md:w-[300px]"}
    />
  ) : null;

  const body = (
    <>
      <div className="flex min-h-0 flex-1 flex-row">
        {mainCol}
        {panel}
      </div>
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
      <AlertDialog open={clearDialogOpen} onOpenChange={setClearDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("chat.menu.clear")}</AlertDialogTitle>
            <AlertDialogDescription>{t("chat.menu.clearConfirm")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("chat.close")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleClearHistory}>
              {t("chat.menu.clear")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={blockDialogOpen} onOpenChange={setBlockDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {peerBlocked
                ? t("chat.block.unblockTitle", { name: peerName })
                : t("chat.block.blockTitle", { name: peerName })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {peerBlocked ? t("chat.block.unblockConfirm") : t("chat.block.blockConfirm")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("chat.close")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmBlockToggle}>
              {peerBlocked ? t("chat.block.unblock") : t("chat.block.block")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );

  if (variant === "page") {
    return (
      <div
        className={cn("flex h-full min-h-0 flex-col", className)}
        data-active-conversation={conversationId}
      >
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
            <div className="flex items-center gap-1.5 truncate text-sm font-semibold">
              <span className="truncate">{peerName}</span>
              {muted && (
                <BellOff
                  className="h-3 w-3 shrink-0 text-muted-foreground"
                  aria-label={t("chat.menu.mutedBadge")}
                />
              )}
              {pinned && (
                <Pin
                  className="h-3 w-3 shrink-0 text-muted-foreground"
                  aria-label={t("chat.menu.pinnedBadge")}
                />
              )}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {peerOnline ? t("chat.online") : t("chat.offline")}
            </div>
          </div>
          {blockToggle}
          {mediaToggle}
          {conversationMenu}
        </div>
        {body}
      </div>
    );
  }

  return (
    <section
      className={cn(
        "pointer-events-auto flex w-[320px] max-w-[calc(100vw-16px)] flex-col overflow-hidden",
        "h-[430px] max-h-[min(70vh,430px)] rounded-t-[6px] border border-b-0 border-border/60 bg-background shadow-2xl",
        "motion-safe:animate-in motion-safe:slide-in-from-bottom-4 motion-safe:fade-in-0 motion-safe:duration-200",
        className,
      )}
      role="dialog"
      aria-label={`${t("chat.title")}: ${peerName}`}
      data-active-conversation={conversationId}
      onKeyDown={(e) => {
        // Messenger behavior: Escape closes the dock window. The composer
        // stops propagation when Escape means "cancel editing", and Radix
        // portals (emoji picker, delete dialog) live outside this subtree.
        if (e.key === "Escape" && onClose) {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <header className="flex items-center gap-2 border-b border-border/60 bg-background px-2 py-1.5 shadow-sm">
        <ChatAvatar name={peerName} avatarUrl={peerAvatar} online={peerOnline} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1 truncate text-[13px] font-semibold leading-tight">
            <span className="truncate">{peerName}</span>
            {muted && (
              <BellOff
                className="h-3 w-3 shrink-0 text-muted-foreground"
                aria-label={t("chat.menu.mutedBadge")}
              />
            )}
          </div>
          <div className="text-[10px] leading-tight text-muted-foreground">
            {peerOnline ? t("chat.online") : t("chat.offline")}
          </div>
        </div>
        {blockToggle}
        {mediaToggle}
        {conversationMenu}
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
