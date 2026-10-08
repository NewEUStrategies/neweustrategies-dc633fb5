// Globalny toast „ktoś do Ciebie napisał" (i zdarzenie dla animowanych
// dzwonków). JEDNA subskrypcja INSERT na `messages` na użytkownika (RLS
// przepuszcza tylko rozmowy, w których jest uczestnikiem) zamienia nowe
// wiadomości w toasty sonnera w dowolnym miejscu serwisu. Toast milknie, gdy
// okno tej rozmowy jest otwarte I karta ma fokus, gdy rozmowa jest wyciszona
// oraz gdy nadawcą jest sam użytkownik (echo z drugiej karty).
//
// GDZIE TO ŻYJE. Hak montuje `WorkspaceDock` - jedyna powierzchnia rozmów,
// leniwy chunk renderowany wyłącznie dla zalogowanych, poza /admin i /login,
// w stałej pozycji drzewa `SiteChrome` (nawigacja go nie przemontowuje).
// Wcześniej montował go tylko `ChatBell`, którego nic nie renderuje, więc
// kanał nie powstawał i żadna wiadomość nie dawała toasta. Gość nie pobiera
// tego kodu i nie otwiera kanału.
//
// KANAŁ IDZIE PRZEZ `tableChannelHub` - wspólną implementację kanałów
// `postgres_changes` w repozytorium. Własny kanał o stałej nazwie
// `chat-incoming:<uid>` ginął, gdy hak montował się ponownie, zanim serwer
// potwierdził opuszczenie poprzedniego, już dołączonego kanału (zejście
// i powrót doku, ponowne zalogowanie): realtime-js oddaje wtedy z
// `supabase.channel()` ten sam, opuszczany obiekt, `subscribe()` na nim
// nie dołącza, a po potwierdzeniu kanał jest rozbierany - toasty cicho
// przestają przychodzić. Hub nadaje nazwie losowy sufiks i liczy referencje.
import { useEffect } from "react";
import i18n from "@/lib/i18n";
import "@/lib/i18n-chat";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { subscribeToTable } from "@/lib/realtime/tableChannelHub";
import { openChatWindow } from "./chatDockBus";
import { mutedUntilMs } from "./useConversations";
import type { MessageRow, PeerProfile } from "./types";

const INCOMING_EVENT = "nes:chat-incoming";

/** Fired whenever a new incoming message is observed (for animated bells). */
export function onIncomingChatMessage(handler: (message: MessageRow) => void) {
  if (typeof window === "undefined") return () => {};
  const listener = (e: Event) => {
    const detail = (e as CustomEvent<MessageRow>).detail;
    if (detail) handler(detail);
  };
  window.addEventListener(INCOMING_EVENT, listener);
  return () => window.removeEventListener(INCOMING_EVENT, listener);
}

let unsubscribe: (() => void) | null = null;
let subscribedUid: string | null = null;
let refCount = 0;
const seenIds = new Set<string>();
const peerCache = new Map<string, PeerProfile>();

function isConversationFocused(conversationId: string): boolean {
  if (typeof document === "undefined") return false;
  if (!document.hasFocus()) return false;
  if (document.visibilityState !== "visible") return false;
  return !!document.querySelector(`[data-active-conversation="${CSS.escape(conversationId)}"]`);
}

function attachmentSummary(row: MessageRow): string | null {
  if (row.kind === "image") return i18n.t("chat.photo");
  if (row.kind === "audio") return i18n.t("chat.voice.message");
  if (row.kind === "file") {
    const label = i18n.t("chat.file");
    return row.attachment_name ? `${label}: ${row.attachment_name}` : label;
  }
  return null;
}

// Mute gate for toasts (badge and bell state still update - like WhatsApp,
// muted chats count unread but stay silent). 60 s TTL keeps this at one
// lightweight own-row select per conversation per minute, worst case.
const muteCache = new Map<string, { until: number | null; at: number }>();

/**
 * Drop the cached mute state of one conversation (or all). Called by the
 * mute mutation so "wycisz" silences toasts IMMEDIATELY instead of after the
 * cache's 60 s TTL.
 */
export function invalidateMuteCache(conversationId?: string): void {
  if (conversationId) muteCache.delete(conversationId);
  else muteCache.clear();
}

async function isMutedConversation(uid: string, conversationId: string): Promise<boolean> {
  const now = Date.now();
  const cached = muteCache.get(conversationId);
  if (cached && now - cached.at < 60_000) {
    return cached.until !== null && cached.until > now;
  }
  const { data, error } = await supabase
    .from("conversation_participants")
    .select("muted_until")
    .eq("conversation_id", conversationId)
    .eq("user_id", uid)
    .maybeSingle();
  if (error) return false;
  const until = mutedUntilMs(data?.muted_until ?? null);
  muteCache.set(conversationId, { until, at: now });
  return until !== null && until > now;
}

function buildPreview(row: MessageRow): string {
  const attach = attachmentSummary(row);
  const text = (row.body ?? "").trim();
  if (attach && text) return `${attach} - ${text}`;
  if (attach) return attach;
  if (text.length > 140) return `${text.slice(0, 137)}...`;
  return text || i18n.t("chat.incoming.emptyBody");
}

async function resolvePeer(senderId: string): Promise<PeerProfile | null> {
  const cached = peerCache.get(senderId);
  if (cached) return cached;
  const { data, error } = await supabase.rpc("get_chat_peers", {
    p_user_ids: [senderId],
  });
  if (error || !data || data.length === 0) return null;
  const profile = data[0];
  peerCache.set(senderId, profile);
  return profile;
}

async function handleInsert(uid: string, row: MessageRow) {
  if (!row?.id || seenIds.has(row.id)) return;
  seenIds.add(row.id);
  if (seenIds.size > 500) {
    // Bound memory - drop the oldest half.
    const arr = [...seenIds];
    seenIds.clear();
    for (const id of arr.slice(arr.length / 2)) seenIds.add(id);
  }
  if (row.sender_id === uid) return;
  if (row.deleted_at) return;

  window.dispatchEvent(new CustomEvent<MessageRow>(INCOMING_EVENT, { detail: row }));

  if (isConversationFocused(row.conversation_id)) return;
  if (await isMutedConversation(uid, row.conversation_id)) return;

  const peer = await resolvePeer(row.sender_id);
  // Odczyty wyżej trwają. W tym czasie sesja mogła się skończyć (wylogowanie,
  // zejście doku) albo użytkownik mógł otworzyć tę rozmowę - spóźniony toast
  // nie może trafić do innej sesji ani dublować okna, które już czyta.
  if (subscribedUid !== uid || isConversationFocused(row.conversation_id)) return;
  const name = peer?.display_name ?? i18n.t("chat.incoming.someone");
  const preview = buildPreview(row);
  const openLabel = i18n.t("chat.incoming.open");

  toast(name, {
    description: preview,
    duration: 6000,
    action: {
      label: openLabel,
      onClick: () => openChatWindow({ conversationId: row.conversation_id }),
    },
    onAutoClose: () => undefined,
  });
}

function acquire(uid: string) {
  refCount += 1;
  if (unsubscribe && subscribedUid === uid) return;
  unsubscribe?.();
  subscribedUid = uid;
  unsubscribe = subscribeToTable(
    { table: "messages", event: "INSERT", filter: `sender_id=neq.${uid}` },
    (payload) => {
      void handleInsert(uid, payload.new as MessageRow);
    },
  );
}

function release() {
  refCount = Math.max(0, refCount - 1);
  if (refCount > 0 || !unsubscribe) return;
  unsubscribe();
  unsubscribe = null;
  subscribedUid = null;
  seenIds.clear();
  muteCache.clear();
}

/**
 * Montowany raz na sesję członka przez `WorkspaceDock`. Subskrypcja jest
 * liczona na poziomie modułu, więc dodatkowa powierzchnia wołająca ten hak
 * nie otworzy drugiego kanału. `enabled = false` (moduł czatu wyłączony
 * w panelu) nie otwiera kanału wcale, a wyłączenie w trakcie sesji go zwalnia.
 */
export function useIncomingChatToasts(enabled = true): void {
  const { user } = useAuth();
  const uid = user?.id;
  useEffect(() => {
    if (!uid || !enabled) return;
    acquire(uid);
    return release;
  }, [uid, enabled]);
}
