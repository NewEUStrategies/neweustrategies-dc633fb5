// Conversations data layer - list, unread badge, peer profiles, people search
// and conversation bootstrap. All reads go through RLS (member-only) or
// SECURITY DEFINER RPCs (authenticated-only), so anonymous visitors and
// crawlers have no read path; tenant isolation is enforced in the DB.
//
// Efficiency notes:
//  - ONE realtime channel per user for the whole list (module-level refcount);
//    ChatBell, ChatDock and /messages share it instead of subscribing thrice.
//  - The unread badge is DERIVED from the cached conversations query (select),
//    not a second round-trip with its own invalidation cycle.
//  - Peer profile lookups seed the per-peer cache keys, so opening a chat
//    window resolves its header instantly from the directory/list fetch.
import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { subscribeToTable } from "@/lib/realtime/tableChannelHub";
import { chatKeys } from "./keys";
import type {
  ConversationRow,
  ConversationView,
  ParticipantRow,
  PeerProfile,
  PersonHit,
} from "./types";

type ParticipantWithConversation = ParticipantRow & { conversation: ConversationRow | null };

function lastActivity(view: ConversationView): number {
  const iso = view.conversation.last_message_at ?? view.conversation.created_at;
  return new Date(iso).getTime();
}

/**
 * Peer user ids carried by the conversation itself. direct_key is
 * `<tenant>:<uidA>:<uidB>`, so the pair survives even when a peer's
 * participant ROW is hidden by RLS (peers who turned read receipts off no
 * longer expose their unread/last_read state - the reciprocal policy on
 * conversation_participants). Identity must not depend on that row.
 */
function peerIdsFromDirectKey(conversation: ConversationRow, uid: string): string[] {
  if (!conversation.direct_key) return [];
  const [, a, b] = conversation.direct_key.split(":");
  return [a, b].filter((id): id is string => !!id && id !== uid);
}

/**
 * Placeholder row for a peer whose participant row is RLS-hidden (read
 * receipts off). Null read state renders as "delivered", never "seen".
 */
function hiddenPeerRow(conversation: ConversationRow, userId: string): ParticipantRow {
  return {
    id: `hidden-${conversation.id}-${userId}`,
    conversation_id: conversation.id,
    user_id: userId,
    tenant_id: conversation.tenant_id,
    unread_count: 0,
    last_read_at: null,
    last_delivered_at: null,
    pinned_at: null,
    archived_at: null,
    muted_until: null,
    cleared_before: null,
    created_at: conversation.created_at,
    updated_at: conversation.created_at,
  };
}

async function fetchConversations(uid: string): Promise<ConversationView[]> {
  const { data, error } = await supabase
    .from("conversation_participants")
    .select("*, conversation:conversations(*)")
    .order("updated_at", { ascending: false })
    .limit(600);
  if (error) throw error;
  const grouped = new Map<
    string,
    { conversation: ConversationRow; me: ParticipantRow | null; peers: ParticipantRow[] }
  >();
  for (const row of (data ?? []) as ParticipantWithConversation[]) {
    const { conversation, ...participant } = row;
    if (!conversation) continue;
    let entry = grouped.get(conversation.id);
    if (!entry) {
      entry = { conversation, me: null, peers: [] };
      grouped.set(conversation.id, entry);
    }
    if (participant.user_id === uid) entry.me = participant;
    else entry.peers.push(participant);
  }
  const views: ConversationView[] = [];
  for (const entry of grouped.values()) {
    if (!entry.me) continue;
    for (const peerId of peerIdsFromDirectKey(entry.conversation, uid)) {
      if (!entry.peers.some((p) => p.user_id === peerId)) {
        entry.peers.push(hiddenPeerRow(entry.conversation, peerId));
      }
    }
    views.push({ conversation: entry.conversation, me: entry.me, peers: entry.peers });
  }
  // WhatsApp order: pinned first (newest pin on top), then by last activity.
  return views.sort((a, b) => {
    const aPin = a.me.pinned_at ? new Date(a.me.pinned_at).getTime() : null;
    const bPin = b.me.pinned_at ? new Date(b.me.pinned_at).getTime() : null;
    if (aPin !== null || bPin !== null) {
      if (aPin === null) return 1;
      if (bPin === null) return -1;
      return bPin - aPin;
    }
    return lastActivity(b) - lastActivity(a);
  });
}

/** Active vs archived split - every list surface hides archived by default. */
export function splitArchived(views: ConversationView[]): {
  active: ConversationView[];
  archived: ConversationView[];
} {
  const active: ConversationView[] = [];
  const archived: ConversationView[] = [];
  for (const view of views) (view.me.archived_at ? archived : active).push(view);
  return { active, archived };
}

/** PostgREST serializes `'infinity'::timestamptz` as the literal string. */
export function mutedUntilMs(raw: string | null): number | null {
  if (!raw) return null;
  if (raw === "infinity") return Number.POSITIVE_INFINITY;
  const ms = new Date(raw).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/** Whether the caller muted this conversation (now or forever). */
export function isMuted(view: ConversationView, nowMs: number = Date.now()): boolean {
  const until = mutedUntilMs(view.me.muted_until);
  return until !== null && until > nowMs;
}

function conversationsQueryOptions(uid: string | undefined) {
  return {
    queryKey: chatKeys.conversations(uid),
    enabled: !!uid,
    staleTime: 15_000,
    queryFn: () => fetchConversations(uid ?? ""),
  } as const;
}

/**
 * Every conversation the caller belongs to, with their own membership row and
 * the peers' rows. One round-trip: RLS already exposes all participant rows of
 * the caller's conversations, so grouping happens client-side.
 */
export function useConversations(): UseQueryResult<ConversationView[]> {
  const { user } = useAuth();
  return useQuery(conversationsQueryOptions(user?.id));
}

/**
 * Total unread messages - a `select` over the SAME cached conversations query
 * (no extra request, no extra invalidation; re-renders only when the sum
 * actually changes).
 */
export function useChatUnreadTotal(): number {
  const { user } = useAuth();
  const q = useQuery({
    ...conversationsQueryOptions(user?.id),
    select: (views: ConversationView[]) =>
      views.reduce((sum, view) => sum + view.me.unread_count, 0),
  });
  return q.data ?? 0;
}

/**
 * Safe profile cards (name, avatar, headline) for the given user ids.
 * Backed by the get_chat_peers RPC: resolvable only for yourself, users you
 * share a conversation with, or same-tenant discoverable users. Multi-id
 * results seed the single-id cache keys so chat windows open warm.
 */
export function usePeerProfiles(
  userIds: ReadonlyArray<string>,
): UseQueryResult<ReadonlyMap<string, PeerProfile>> {
  const qc = useQueryClient();
  const { user } = useAuth();
  const ids = [...new Set(userIds)].sort();
  return useQuery({
    queryKey: chatKeys.peers(user?.id, ids),
    enabled: !!user && ids.length > 0,
    staleTime: 5 * 60_000,
    // A new conversation changes the aggregate key; keep showing the previous
    // map while the widened set loads instead of blanking every name.
    placeholderData: (previous) => previous,
    queryFn: async (): Promise<ReadonlyMap<string, PeerProfile>> => {
      const { data, error } = await supabase.rpc("get_chat_peers", { p_user_ids: ids });
      if (error) throw error;
      const map = new Map((data ?? []).map((p) => [p.id, p]));
      if (ids.length > 1) {
        for (const [id, profile] of map) {
          qc.setQueryData(chatKeys.peers(user?.id, [id]), new Map([[id, profile]]));
        }
      }
      return map;
    },
  });
}

/**
 * Internal people search (registered users only). Empty query browses the
 * directory; the RPC returns only opted-in (discoverable) same-tenant users.
 */
export function usePeopleSearch(query: string, limit = 20): UseQueryResult<PersonHit[]> {
  const { user } = useAuth();
  const q = query.trim();
  return useQuery({
    queryKey: chatKeys.people(user?.id, `${q}:${limit}`),
    enabled: !!user,
    staleTime: 30_000,
    queryFn: async (): Promise<PersonHit[]> => {
      const { data, error } = await supabase.rpc("search_people", {
        p_query: q,
        p_limit: limit,
      });
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** Open (or create) the direct conversation with a peer. */
export function useStartConversation() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (peerId: string): Promise<string> => {
      const { data, error } = await supabase.rpc("get_or_create_direct_conversation", {
        p_peer_id: peerId,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: chatKeys.conversations(user?.id) });
    },
  });
}

/** Mark a conversation read (resets the badge, powers the peer's "seen"). */
export function useMarkConversationRead() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (conversationId: string) => {
      const { error } = await supabase.rpc("mark_conversation_read", {
        p_conversation_id: conversationId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: chatKeys.conversations(user?.id) });
    },
  });
}

// ---------------------------------------------------------------------------
// Per-conversation settings (pin / archive / mute / clear / disappearing).
// All server-enforced SECURITY DEFINER RPCs scoped to the caller's own
// participant row within their tenant - the client only relays intent.
// ---------------------------------------------------------------------------
function useConversationSetting<TArgs>(
  run: (args: TArgs) => Promise<void>,
  alsoInvalidateMessages?: (args: TArgs) => string | null,
) {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: run,
    onSuccess: (_res, args) => {
      void qc.invalidateQueries({ queryKey: chatKeys.conversations(user?.id) });
      const conversationId = alsoInvalidateMessages?.(args);
      if (conversationId) {
        void qc.invalidateQueries({ queryKey: chatKeys.messages(user?.id, conversationId) });
      }
    },
  });
}

export function useSetConversationPinned() {
  return useConversationSetting(async (args: { conversationId: string; pinned: boolean }) => {
    const { error } = await supabase.rpc("chat_set_pinned", {
      p_conversation_id: args.conversationId,
      p_pinned: args.pinned,
    });
    if (error) throw error;
  });
}

export function useSetConversationArchived() {
  return useConversationSetting(async (args: { conversationId: string; archived: boolean }) => {
    const { error } = await supabase.rpc("chat_set_archived", {
      p_conversation_id: args.conversationId,
      p_archived: args.archived,
    });
    if (error) throw error;
  });
}

/** seconds: null = unmute, -1 = forever, otherwise a bounded window. */
export function useSetConversationMuted() {
  return useConversationSetting(
    async (args: { conversationId: string; seconds: number | null }) => {
      const { error } = await supabase.rpc("chat_set_muted", {
        p_conversation_id: args.conversationId,
        p_seconds: args.seconds as number,
      });
      if (error) throw error;
    },
  );
}

/** "Clear chat for me" - history before this instant disappears for the caller only. */
export function useClearConversationHistory() {
  return useConversationSetting(
    async (args: { conversationId: string }) => {
      const { error } = await supabase.rpc("chat_clear_history", {
        p_conversation_id: args.conversationId,
      });
      if (error) throw error;
    },
    (args) => args.conversationId,
  );
}

/** Disappearing messages window for NEW messages (either participant may set it). */
export function useSetMessageTtl() {
  return useConversationSetting(
    async (args: { conversationId: string; ttlSeconds: number | null }) => {
      const { error } = await supabase.rpc("chat_set_message_ttl", {
        p_conversation_id: args.conversationId,
        p_ttl_seconds: args.ttlSeconds as number,
      });
      if (error) throw error;
    },
    (args) => args.conversationId,
  );
}

// ---------------------------------------------------------------------------
// Per-user realtime stream, shared app-wide. Any change to the caller's
// participant rows (new conversation, unread bump from a peer's message, read
// state synced from another tab) refreshes the conversations query - which
// also drives the derived unread badge. Kanał współdzielony przez
// tableChannelHub (refcount na poziomie huba): niezależnie od liczby
// subskrybentów istnieje dokładnie jeden websocketowy kanał.
// ---------------------------------------------------------------------------
// Delivery acks power the sender's ✓✓ tick. Debounced module-wide so a burst
// of realtime events costs one RPC; the RPC itself no-ops when every own row
// is already up to date (no realtime echo loop).
let deliveredTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleMarkDelivered(): void {
  if (deliveredTimer) return;
  deliveredTimer = setTimeout(() => {
    deliveredTimer = null;
    void supabase.rpc("mark_conversations_delivered");
  }, 800);
}

export function useChatListRealtime(): void {
  const qc = useQueryClient();
  const { user } = useAuth();
  const uid = user?.id;
  useEffect(() => {
    if (!uid) return;
    // Everything that arrived while this client was offline counts as
    // delivered the moment the list mounts.
    scheduleMarkDelivered();
    return subscribeToTable(
      { table: "conversation_participants", filter: `user_id=eq.${uid}` },
      () => {
        void qc.invalidateQueries({ queryKey: chatKeys.conversations(uid) });
        scheduleMarkDelivered();
      },
    );
  }, [uid, qc]);
}
