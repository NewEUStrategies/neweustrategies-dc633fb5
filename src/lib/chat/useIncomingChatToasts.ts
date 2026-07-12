// Global "someone wrote to you" toast + bell pulse. Subscribes ONCE per user
// to messages INSERT (RLS restricts to conversations the caller belongs to)
// and surfaces incoming messages as sonner toasts anywhere in the app.
// Suppressed when the corresponding chat window is already open AND focused,
// or when the sender is the current user (echo / other tab).
import { useEffect } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import i18n from "@/lib/i18n";
import "@/lib/i18n-chat";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
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

let channel: RealtimeChannel | null = null;
let channelUid: string | null = null;
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
  if (row.kind === "image") return i18n.t("chat.photo", { defaultValue: "Zdjęcie" });
  if (row.kind === "audio")
    return i18n.t("chat.voice.message", { defaultValue: "Wiadomość głosowa" });
  if (row.kind === "file") {
    const label = i18n.t("chat.file", { defaultValue: "Plik" });
    return row.attachment_name ? `${label}: ${row.attachment_name}` : label;
  }
  return null;
}

// Mute gate for toasts (badge and bell state still update - like WhatsApp,
// muted chats count unread but stay silent). 60 s TTL keeps this at one
// lightweight own-row select per conversation per minute, worst case.
const muteCache = new Map<string, { until: number | null; at: number }>();

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
  return text || i18n.t("chat.incoming.emptyBody", { defaultValue: "..." });
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
  const name = peer?.display_name ?? i18n.t("chat.incoming.someone", { defaultValue: "Ktoś" });
  const preview = buildPreview(row);
  const openLabel = i18n.t("chat.incoming.open", { defaultValue: "Otwórz" });

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
  if (channel && channelUid === uid) return;
  if (channel) {
    void supabase.removeChannel(channel);
    channel = null;
  }
  channelUid = uid;
  channel = supabase
    .channel(`chat-incoming:${uid}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "messages",
        filter: `sender_id=neq.${uid}`,
      },
      (payload) => {
        void handleInsert(uid, payload.new as MessageRow);
      },
    )
    .subscribe();
}

function release() {
  refCount = Math.max(0, refCount - 1);
  if (refCount === 0 && channel) {
    void supabase.removeChannel(channel);
    channel = null;
    channelUid = null;
    seenIds.clear();
    muteCache.clear();
  }
}

/**
 * Mount once (per surface) - the underlying channel is refcounted, so
 * ChatBell + ChatDock + /messages together keep exactly one websocket.
 */
export function useIncomingChatToasts(): void {
  const { user } = useAuth();
  const uid = user?.id;
  useEffect(() => {
    if (!uid) return;
    acquire(uid);
    return release;
  }, [uid]);
}
