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
  return views.sort((a, b) => lastActivity(b) - lastActivity(a));
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
// Per-user realtime stream, shared app-wide. Any change to the caller's
// participant rows (new conversation, unread bump from a peer's message, read
// state synced from another tab) refreshes the conversations query - which
// also drives the derived unread badge. Kanał współdzielony przez
// tableChannelHub (refcount na poziomie huba): niezależnie od liczby
// subskrybentów istnieje dokładnie jeden websocketowy kanał.
// ---------------------------------------------------------------------------
export function useChatListRealtime(): void {
  const qc = useQueryClient();
  const { user } = useAuth();
  const uid = user?.id;
  useEffect(() => {
    if (!uid) return;
    return subscribeToTable(
      { table: "conversation_participants", filter: `user_id=eq.${uid}` },
      () => {
        void qc.invalidateQueries({ queryKey: chatKeys.conversations(uid) });
      },
    );
  }, [uid, qc]);
}
