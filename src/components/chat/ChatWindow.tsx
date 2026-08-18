// Organizm: powierzchnia JEDNEJ rozmowy. Dwa warianty:
//  - "dock" - pływające okno w stylu Messengera (prawy dolny róg),
//  - "page" - wypełnia prawy panel trasy /messages.
//
// Rejestruje pakiet i18n czatu dla każdej powierzchni renderującej wiadomości
// (trasa /messages NIE MOŻE importować go na poziomie modułu - wciągnęłoby to
// teksty do gorącego grafu wejściowego).
//
// ── CO TU ZOSTAŁO PO PODZIALE (audyt: 1212 linii, 0% pokrycia) ──────────────
// Ten plik jest teraz WYŁĄCZNIE kompozycją: spina warstwę danych z częściami
// prezentacyjnymi i przekazuje intencje. Wszystko, co dało się przetestować bez
// renderowania okna, wyszło do sąsiadów:
//
//   lib/chat/thread.ts          - kolejność wątku, separator nieprzeczytanych,
//                                 ścieżki załączników, deskryptor podtytułu,
//                                 nazwa autora, profile reagujących,
//   lib/chat/useTypingRegistry  - zbiór piszących + liczniki wygaszenia,
//   lib/chat/useThreadJump      - skok do trafienia z budżetem stron,
//   lib/chat/useAutoMarkRead    - oznaczanie przeczytania (widoczność karty),
//   ChatWindowHeader            - oba paski nagłówka,
//   ConversationMenu            - menu rozmowy,
//   ChatWindowDialogs           - wszystkie warstwy modalne,
//   ChatIconButton              - przycisk ikonowy rzędu akcji,
//   BlockedComposerNotice       - pasek zamiast kompozytora przy blokadzie.
//
// Efekt uboczny podziału jest ważniejszy niż liczba linii: reguły, które
// wcześniej dało się sprawdzić tylko w przeglądarce, mają dziś testy
// jednostkowe, a organizm ma test renderujący oba warianty.
import "@/lib/i18n-chat";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Images, Minus, Search, X } from "lucide-react";
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
import { aggregatePeerReadState, conversationDisplay, isGroupView } from "@/lib/chat/display";
import { useNicknames } from "@/lib/chat/nicknames";
import { useStarredIds, useToggleStar } from "@/lib/chat/stars";
import {
  normalizeQuickEmoji,
  normalizeTheme,
  normalizeWallpaper,
  themeClass,
} from "@/lib/chat/themes";
import {
  attachmentPathsOf,
  buildReactorProfiles,
  canShowTyping,
  firstUnreadMessageId,
  headerSubtitle,
  needsUnreadSnapshot,
  orderThreadMessages,
  resolveAuthorName as resolveAuthorNameFor,
  sendErrorMessageKey,
  typingDisplay,
  type UnreadSnapshot,
} from "@/lib/chat/thread";
import { useAutoMarkRead } from "@/lib/chat/useAutoMarkRead";
import { useThreadJump } from "@/lib/chat/useThreadJump";
import { useTypingRegistry } from "@/lib/chat/useTypingRegistry";
import {
  canEditMessage,
  retrySendInput,
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
import { TooltipProvider } from "@/components/ui/tooltip";
import { BlockedComposerNotice } from "./BlockedComposerNotice";
import { ChatComposer } from "./ChatComposer";
import { ChatIconButton } from "./ChatIconButton";
import { ChatMediaPanel } from "./ChatMediaPanel";
import { ChatSurfaceBoundary } from "./ChatSurfaceBoundary";
import { ChatWindowDialogs } from "./ChatWindowDialogs";
import { ChatWindowHeader } from "./ChatWindowHeader";
import { ConversationMenu } from "./ConversationMenu";
import { MessageList } from "./MessageList";
import { MessageSearchBar } from "./MessageSearchBar";

const EMPTY_REACTIONS_MAP: ReadonlyMap<string, never[]> = new Map();

/** Placeholder nagłówka, dopóki lista rozmów się nie wczyta. */
const PENDING_DISPLAY = {
  isGroup: false,
  name: "...",
  avatarUrl: null,
  peerId: null,
  slug: null,
} as const;

export interface ChatWindowProps {
  conversationId: string;
  variant: "dock" | "page";
  onClose?: () => void;
  onMinimize?: () => void;
  /** Tylko wariant page: powrót do listy na mobile. */
  onBack?: () => void;
  autoFocus?: boolean;
  /**
   * Zewnętrzne żądanie „przewiń do tej wiadomości" (wyszukiwarka skrzynki).
   * nonce przezbraja skok, gdy to samo trafienie kliknięto dwa razy pod rząd.
   */
  jumpRequest?: { id: string; nonce: number } | null;
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
    jumpRequest,
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
  const nicknamesQ = useNicknames();
  const conversationNicknames = nicknamesQ.data?.get(conversationId);
  const isGroup = !!view && isGroupView(view);
  const display = view
    ? conversationDisplay(view, peersQ.data, t("chat.group.circle"), conversationNicknames)
    : PENDING_DISPLAY;
  const { peerId, name: peerName, avatarUrl: peerAvatar, slug: peerSlug } = display;

  // Profile reagujących: rozmówcy z RPC + zsyntetyzowany wpis „ja" z sesji
  // (własny avatar stoi na chipie reakcji, a `get_chat_peers` zwraca wyłącznie
  // rozmówców).
  const reactorProfiles = useMemo(
    () =>
      buildReactorProfiles({
        peerProfiles: peersQ.data,
        me: user ? { id: user.id, email: user.email, metadata: user.user_metadata } : null,
        youLabel: t("chat.you"),
      }),
    [peersQ.data, user, t],
  );

  // Wspólna personalizacja rozmowy (semantyka Messengera): motyw przekolorowuje
  // wszystkie tokeny --chat-user-* poniżej tego korzenia, tapeta stylizuje
  // scroller wątku, szybka emotka napędza wysyłkę jednym dotknięciem.
  const theme = normalizeTheme(view?.conversation.theme);
  const wallpaper = normalizeWallpaper(view?.conversation.wallpaper);
  const quickEmoji = normalizeQuickEmoji(view?.conversation.quick_emoji);
  const subtitle = useMemo(
    () => headerSubtitle({ isGroup, peerIds, onlineIds: online, peerId }),
    [isGroup, peerIds, online, peerId],
  );
  const peerOnline = !!peerId && online.has(peerId);

  // Potwierdzenia w kręgu mają semantykę „wszyscy członkowie" (przeczytane /
  // doręczone tylko wtedy, gdy KAŻDY) - dla wątku bezpośredniego to dokładnie
  // wiersz jedynego rozmówcy.
  const { lastReadAt: peerLastReadAt, lastDeliveredAt: peerLastDeliveredAt } = view
    ? aggregatePeerReadState(view)
    : { lastReadAt: null, lastDeliveredAt: null };
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

  // Stan blokady: RLS pokazuje WYŁĄCZNIE własne blokady, więc to pokrywa
  // przypadek „ja zablokowałem rozmówcę"; kierunek odwrotny egzekwuje serwer
  // ("chat: blocked").
  const blocksQ = useMyBlocks();
  const blockUser = useBlockUser();
  const unblockUser = useUnblockUser();
  const peerBlocked = !!peerId && !!blocksQ.data?.has(peerId);

  // Preferencja prywatności: przy wyłączonych wskaźnikach pisania nie nadajemy
  // własnych pingów (odbiór pingów rozmówcy zostaje bez zmian).
  const prefsQ = useNotificationPreferences();
  const typingEnabled = prefsQ.data?.typing_indicators_enabled ?? true;
  const { typingUserIds, sendTyping } = useTypingRegistry(conversationId, true, typingEnabled);

  // Tyknięcie minuty: pięciominutowe okno edycji musi zamknąć się WIZUALNIE,
  // nawet gdy nic innego się nie przerenderowuje, a wiadomości znikające muszą
  // zniknąć na żywo między refetchami. Na tyknięciu przerenderowuje się tylko
  // powłoka listy - zmemoizowane dymki dopiero, gdy zmieni się ich `editable`.
  const [editTick, setEditTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setEditTick((n) => n + 1), 60_000);
    return () => clearInterval(timer);
  }, []);

  // Migawka stanu nieprzeczytanych z PIERWSZEGO zobaczenia wiersza tej rozmowy,
  // czyli PRZED oznaczeniem przeczytania - żeby separator „nieprzeczytane"
  // wylądował tam, gdzie użytkownik skończył, a nie zapadł się do zera w chwili
  // otwarcia wątku.
  const unreadSnapshotRef = useRef<UnreadSnapshot | null>(null);
  if (view && needsUnreadSnapshot(unreadSnapshotRef.current, conversationId)) {
    unreadSnapshotRef.current = {
      conversationId,
      count: view.me.unread_count,
      lastReadAt: view.me.last_read_at,
    };
  }
  const unreadSnapshot =
    unreadSnapshotRef.current?.conversationId === conversationId ? unreadSnapshotRef.current : null;

  const messages = useMemo(
    // editTick trzyma odcięcie wygaśnięcia świeże: wiadomości znikające
    // przepadają na tyknięciu minuty, nie przy najbliższym refetchu (RLS jest
    // autorytetem, to jest jego lustro po stronie klienta).
    () => orderThreadMessages(messagesQ.data?.pages, editTick >= 0 ? Date.now() : 0),
    [messagesQ.data, editTick],
  );

  const firstUnreadId = useMemo(
    () => firstUnreadMessageId(messages, user?.id, unreadSnapshot),
    // unreadSnapshot to migawka w refie per rozmowa; przeliczenie napędzają wiadomości.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [messages, conversationId, user?.id],
  );

  // Jedno wywołanie storage podpisuje każdy załącznik z wczytanej historii.
  const attachmentPaths = useMemo(() => attachmentPathsOf(messages), [messages]);
  usePrefetchAttachmentUrls(attachmentPaths);

  // Potwierdzenie odczytu - reguła i reaktywna widoczność karty żyją w hooku.
  const lastMessage = messages[messages.length - 1];
  const { mutate: mutateMarkRead } = markRead;
  useAutoMarkRead({
    conversationId,
    myUserId: user?.id,
    lastMessage,
    unreadCount: view?.me.unread_count ?? 0,
    enabled: prefsQ.data?.auto_mark_on_open ?? true,
    markRead: mutateMarkRead,
  });

  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [editTarget, setEditTarget] = useState<ChatMessage | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ChatMessage | null>(null);
  const [forwardTarget, setForwardTarget] = useState<ChatMessage | null>(null);
  const [mediaOpen, setMediaOpen] = useState(false);
  const [blockDialogOpen, setBlockDialogOpen] = useState(false);
  const [groupInfoOpen, setGroupInfoOpen] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [clearDialogOpen, setClearDialogOpen] = useState(false);

  useEffect(() => {
    setReplyTo(null);
    setEditTarget(null);
    setDeleteTarget(null);
    setForwardTarget(null);
    setBlockDialogOpen(false);
    setGroupInfoOpen(false);
    setAppearanceOpen(false);
  }, [conversationId]);

  // Skok do trafienia wyszukiwarki. Cel żyje w hooku (nie w MessageList), bo
  // dociąganie starszych stron aż do znalezienia wiadomości wymaga messagesQ;
  // MessageList tylko przewija, gdy id już jest w oknie.
  const { fetchNextPage } = messagesQ;
  const handleLoadOlder = useCallback(() => void fetchNextPage(), [fetchNextPage]);
  const fetchOlderPage = useCallback(() => void fetchNextPage(), [fetchNextPage]);
  const handleJumpExhausted = useCallback(() => toast.error(t("chat.search.jumpFailed")), [t]);
  const isMessageLoaded = useCallback(
    (messageId: string) => messages.some((m) => m.id === messageId),
    [messages],
  );
  const { jumpTarget, onJumpHandled, startJump } = useThreadJump({
    request: jumpRequest ?? null,
    isLoaded: isMessageLoaded,
    hasNextPage: !!messagesQ.hasNextPage,
    isFetchingNextPage: messagesQ.isFetchingNextPage,
    fetchNextPage: fetchOlderPage,
    onExhausted: handleJumpExhausted,
  });

  // Stabilne handlery: MessageBubble jest zmemoizowany, więc te referencje nie
  // mogą zmieniać się co render - inaczej memo jest zniesione dla całego wątku.
  const uid = user?.id;
  const { mutate: mutateReaction } = toggleReaction;
  const handleReact = useCallback(
    (message: ChatMessage, emoji: string, current: string | null) =>
      mutateReaction(
        { messageId: message.id, emoji, current },
        { onError: () => toast.error(t("chat.reactions.error")) },
      ),
    [mutateReaction, t],
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
  const handleForward = useCallback((message: ChatMessage) => setForwardTarget(message), []);
  const handleDiscardFailed = useCallback(
    (message: ChatMessage) => discardFailed(message.id),
    [discardFailed],
  );
  // Ponowienie = zdejmij nieudany wiersz optymistyczny i wyślij ten sam ładunek
  // jako świeżą mutację (obiekt załącznika jest już w storage, więc ponowienie
  // nigdy nie wysyła pliku drugi raz). Klasa światowa nie każe przepisywać.
  const { mutate: mutateSendForRetry } = sendMessage;
  const handleRetryFailed = useCallback(
    (message: ChatMessage) => {
      const input = retrySendInput(message);
      if (!input) return;
      discardFailed(message.id);
      mutateSendForRetry(input);
    },
    [discardFailed, mutateSendForRetry],
  );
  const canEdit = useCallback(
    (message: ChatMessage) => (uid ? canEditMessage(message, uid) : false),
    [uid],
  );
  const handleClearReply = useCallback(() => setReplyTo(null), []);
  const handleCancelEdit = useCallback(() => setEditTarget(null), []);
  const handleTyping = useCallback((typing?: boolean) => sendTyping(typing), [sendTyping]);
  const { mutate: mutateSend } = sendMessage;
  const handleSend = useCallback(
    (input: SendMessageInput) => {
      // Wysłana wiadomość zastępuje stan „pisze..." u rozmówcy - nadajemy jawne
      // zatrzymanie, żeby jego wskaźnik zgasł natychmiast.
      handleTyping(false);
      mutateSend(input, {
        onError: (err) => {
          // Mutacja w swoim onError już przełączyła wiersz optymistyczny w stan
          // nieudany; tutaj tylko tłumaczymy werdykt serwera (i milczymy, gdy
          // dymek mówi już wszystko - patrz `sendErrorMessageKey`).
          const key = sendErrorMessageKey(err.message);
          if (key) toast.error(t(key));
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
  const { mutate: mutateDeleteMessage } = deleteMessage;
  const handleConfirmDelete = useCallback(
    (message: ChatMessage) => mutateDeleteMessage(message.id),
    [mutateDeleteMessage],
  );

  // Akcje menu rozmowy (przypnij / archiwizuj / wycisz / wyczyść / TTL).
  const settingErr = useCallback(() => toast.error(t("chat.menu.error")), [t]);
  const handlePinToggle = useCallback(() => {
    setPinned.mutate(
      { conversationId, pinned: !pinned },
      {
        onError: (err) =>
          err.message.includes("pin limit") ? toast.error(t("chat.menu.pinLimit")) : settingErr(),
      },
    );
  }, [setPinned, conversationId, pinned, t, settingErr]);
  const handleArchiveToggle = useCallback(() => {
    setArchived.mutate(
      { conversationId, archived: !archived },
      {
        onSuccess: () =>
          toast.success(archived ? t("chat.menu.unarchived") : t("chat.menu.archived")),
        onError: settingErr,
      },
    );
  }, [setArchived, conversationId, archived, t, settingErr]);
  const handleMute = useCallback(
    (seconds: number | null) => {
      setMuted.mutate({ conversationId, seconds }, { onError: settingErr });
    },
    [setMuted, conversationId, settingErr],
  );
  const handleTtl = useCallback(
    (seconds: number | null) => {
      setMessageTtl.mutate(
        { conversationId, ttlSeconds: seconds },
        { onSuccess: () => toast.success(t("chat.disappearing.saved")), onError: settingErr },
      );
    },
    [setMessageTtl, conversationId, t, settingErr],
  );
  const handleClearHistory = useCallback(() => {
    setClearDialogOpen(false);
    clearHistory.mutate(
      { conversationId },
      { onSuccess: () => toast.success(t("chat.menu.cleared")), onError: settingErr },
    );
  }, [clearHistory, conversationId, t, settingErr]);

  if (!user) return null;

  const myUserId = user.id;
  const resolveAuthorName = (senderId: string): string =>
    resolveAuthorNameFor({
      senderId,
      myUserId,
      isGroup,
      peerName,
      youLabel: t("chat.you"),
      nickname: conversationNicknames?.get(senderId) ?? null,
      profileName: peersQ.data?.get(senderId)?.display_name ?? null,
    });

  const typing = typingDisplay({
    typingUserIds,
    isGroup,
    peerName,
    peerAvatarUrl: peerAvatar,
    resolveName: (id) =>
      conversationNicknames?.get(id) ?? peersQ.data?.get(id)?.display_name ?? "...",
    resolveAvatarUrl: (id) => peersQ.data?.get(id)?.avatar_url ?? null,
  });
  const showTyping = canShowTyping({ typingCount: typingUserIds.size, isGroup, peerId });

  const headerActions = (
    <>
      <ChatIconButton
        icon={Search}
        label={searchOpen ? t("chat.search.close") : t("chat.search.inConversation")}
        onClick={() => setSearchOpen((v) => !v)}
        pressed={searchOpen}
      />
      <ChatIconButton
        icon={Images}
        label={mediaOpen ? t("chat.mediaPanel.close") : t("chat.mediaPanel.open")}
        onClick={() => setMediaOpen((v) => !v)}
        pressed={mediaOpen}
      />
      <ConversationMenu
        open={menuOpen}
        onOpenChange={setMenuOpen}
        isGroup={isGroup}
        pinned={pinned}
        archived={archived}
        muted={muted}
        ttlSeconds={ttlSeconds}
        peerId={peerId}
        peerBlocked={peerBlocked}
        onOpenGroupInfo={() => setGroupInfoOpen(true)}
        onOpenAppearance={() => setAppearanceOpen(true)}
        onTogglePin={handlePinToggle}
        onToggleArchive={handleArchiveToggle}
        onMute={handleMute}
        onSetTtl={handleTtl}
        onOpenBlockDialog={() => setBlockDialogOpen(true)}
        onOpenClearDialog={() => setClearDialogOpen(true)}
      />
      {variant === "dock" && onMinimize && (
        <ChatIconButton icon={Minus} label={t("chat.minimize")} onClick={onMinimize} />
      )}
      {variant === "dock" && onClose && (
        <ChatIconButton icon={X} label={t("chat.close")} onClick={onClose} />
      )}
    </>
  );

  const mainCol = (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {searchOpen && (
        <MessageSearchBar
          conversationId={conversationId}
          lang={lang}
          resolveAuthorName={resolveAuthorName}
          onJump={(hit) => startJump(hit.id)}
          onClose={() => setSearchOpen(false)}
        />
      )}
      {/* Awaria renderowania pojedynczego dymka zostaje w panelu wątku -
          reszta ekranu wiadomości (lista rozmów, kompozytor) żyje dalej. */}
      <ChatSurfaceBoundary>
        <MessageList
          lang={lang}
          myUserId={myUserId}
          messages={messages}
          reactions={reactionsQ.data ?? EMPTY_REACTIONS_MAP}
          reactorProfiles={reactorProfiles}
          peerName={peerName}
          peerAvatarUrl={peerAvatar}
          isGroup={isGroup}
          senderProfiles={isGroup ? peersQ.data : undefined}
          senderNicknames={conversationNicknames}
          typingNames={typing.names}
          typingAvatarUrl={typing.avatarUrl}
          peerLastReadAt={peerLastReadAt}
          peerLastDeliveredAt={peerLastDeliveredAt}
          peerTyping={showTyping}
          ttlSeconds={ttlSeconds}
          wallpaper={wallpaper}
          starredIds={starredIdsQ.data}
          firstUnreadId={firstUnreadId}
          unreadCount={unreadSnapshot?.count ?? 0}
          jumpToId={jumpTarget}
          onJumpHandled={onJumpHandled}
          hasOlder={!!messagesQ.hasNextPage}
          loadingOlder={messagesQ.isFetchingNextPage || messagesQ.isLoading}
          onLoadOlder={handleLoadOlder}
          onReact={handleReact}
          onReply={handleReply}
          onEdit={handleEdit}
          onDelete={handleDelete}
          onDiscardFailed={handleDiscardFailed}
          onRetryFailed={handleRetryFailed}
          onToggleStar={handleToggleStar}
          onForward={handleForward}
          canEdit={canEdit}
        />
      </ChatSurfaceBoundary>
      {peerBlocked ? (
        <BlockedComposerNotice onUnblock={handleUnblock} pending={unblockUser.isPending} />
      ) : (
        <ChatComposer
          conversationId={conversationId}
          lang={lang}
          replyTo={replyTo}
          replyToAuthor={replyTo ? resolveAuthorName(replyTo.sender_id) : null}
          editing={editTarget}
          quickEmoji={quickEmoji}
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

  const body = (
    <>
      <div className="relative flex min-h-0 flex-1 flex-row">
        {mainCol}
        {mediaOpen && (
          <ChatMediaPanel
            conversationId={conversationId}
            enabled={mediaOpen}
            onClose={() => setMediaOpen(false)}
            className={
              variant === "dock"
                ? "w-[180px] shrink-0"
                : "absolute inset-y-0 right-0 z-30 w-full border-l border-border/60 bg-card shadow-xl md:static md:w-[260px] md:shrink-0 md:shadow-none lg:w-[300px]"
            }
          />
        )}
      </div>
      <ChatWindowDialogs
        conversationId={conversationId}
        view={view}
        isGroup={isGroup}
        peerName={peerName}
        peerBlocked={peerBlocked}
        deleteTarget={deleteTarget}
        onDeleteTargetChange={setDeleteTarget}
        onConfirmDelete={handleConfirmDelete}
        forwardTarget={forwardTarget}
        onForwardClose={() => setForwardTarget(null)}
        clearDialogOpen={clearDialogOpen}
        onClearDialogOpenChange={setClearDialogOpen}
        onConfirmClear={handleClearHistory}
        blockDialogOpen={blockDialogOpen}
        onBlockDialogOpenChange={setBlockDialogOpen}
        onConfirmBlockToggle={handleConfirmBlockToggle}
        groupInfoOpen={groupInfoOpen}
        onGroupInfoClose={() => setGroupInfoOpen(false)}
        onLeftGroup={onBack ?? onClose}
        appearanceOpen={appearanceOpen}
        onAppearanceClose={() => setAppearanceOpen(false)}
      />
    </>
  );

  const header = (
    <ChatWindowHeader
      variant={variant}
      name={peerName}
      avatarUrl={peerAvatar}
      slug={peerSlug}
      isGroup={isGroup}
      peerOnline={peerOnline}
      subtitle={subtitle}
      muted={muted}
      pinned={pinned}
      onBack={onBack}
      onOpenGroupInfo={() => setGroupInfoOpen(true)}
      actions={headerActions}
    />
  );

  if (variant === "page") {
    return (
      <TooltipProvider delayDuration={200}>
        <div
          className={cn("flex h-full min-h-0 flex-col", themeClass(theme), className)}
          data-active-conversation={conversationId}
        >
          {header}
          {body}
        </div>
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider delayDuration={200}>
      <section
        className={cn(
          "pointer-events-auto flex w-[420px] max-w-[calc(100vw-16px)] flex-col overflow-hidden sm:w-[460px] lg:w-[500px]",
          "h-[600px] max-h-[min(85vh,640px)] rounded-t-[6px] border border-b-0 border-border/60 bg-background shadow-2xl",
          "motion-safe:animate-in motion-safe:slide-in-from-bottom-4 motion-safe:fade-in-0 motion-safe:duration-200",
          themeClass(theme),
          className,
        )}
        role="dialog"
        aria-label={`${t("chat.title")}: ${peerName}`}
        data-active-conversation={conversationId}
        onKeyDown={(e) => {
          // Zachowanie Messengera: Escape zamyka okno dokowane. Kompozytor
          // zatrzymuje propagację, gdy Escape znaczy „anuluj edycję", a portale
          // Radixa (picker emoji, dialog usunięcia) żyją poza tym poddrzewem.
          if (e.key === "Escape" && onClose) {
            e.stopPropagation();
            onClose();
          }
        }}
      >
        {header}
        {body}
      </section>
    </TooltipProvider>
  );
}
