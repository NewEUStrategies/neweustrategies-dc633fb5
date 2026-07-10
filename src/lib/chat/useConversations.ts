// Conversations data layer - list, unread badge, peer profiles, people search
// and conversation bootstrap. All reads go through RLS (member-only) or
// SECURITY DEFINER RPCs (authenticated-only), so anonymous visitors and
// crawlers have no read path; tenant isolation is enforced in the DB.
import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
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
 * Every conversation the caller belongs to, with their own membership row and
 * the peers' rows. One round-trip: RLS already exposes all participant rows of
 * the caller's conversations, so grouping happens client-side.
 */
export function useConversations(): UseQueryResult<ConversationView[]> {
  const { user } = useAuth();
  return useQuery({
    queryKey: chatKeys.conversations(user?.id),
    enabled: !!user,
    staleTime: 15_000,
    queryFn: async (): Promise<ConversationView[]> => {
      const { data, error } = await supabase
        .from("conversation_participants")
        .select("*, conversation:conversations(*)")
        .order("updated_at", { ascending: false })
        .limit(600);
      if (error) throw error;
      const uid = user?.id;
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
        views.push({ conversation: entry.conversation, me: entry.me, peers: entry.peers });
      }
      return views.sort((a, b) => lastActivity(b) - lastActivity(a));
    },
  });
}

/** Total unread messages across conversations - powers the header badge. */
export function useChatUnreadTotal(): UseQueryResult<number> {
  const { user } = useAuth();
  return useQuery({
    queryKey: chatKeys.unread(user?.id),
    enabled: !!user,
    staleTime: 15_000,
    queryFn: async (): Promise<number> => {
      const { data, error } = await supabase
        .from("conversation_participants")
        .select("unread_count")
        .eq("user_id", user?.id ?? "")
        .gt("unread_count", 0);
      if (error) throw error;
      return (data ?? []).reduce((sum, row) => sum + row.unread_count, 0);
    },
  });
}

/**
 * Safe profile cards (name, avatar, headline) for the given user ids.
 * Backed by the get_chat_peers RPC: resolvable only for yourself, users you
 * share a conversation with, or same-tenant discoverable users.
 */
export function usePeerProfiles(
  userIds: ReadonlyArray<string>,
): UseQueryResult<ReadonlyMap<string, PeerProfile>> {
  const { user } = useAuth();
  const ids = [...new Set(userIds)].sort();
  return useQuery({
    queryKey: chatKeys.peers(user?.id, ids),
    enabled: !!user && ids.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<ReadonlyMap<string, PeerProfile>> => {
      const { data, error } = await supabase.rpc("get_chat_peers", { p_user_ids: ids });
      if (error) throw error;
      return new Map((data ?? []).map((p) => [p.id, p]));
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
      void qc.invalidateQueries({ queryKey: chatKeys.unread(user?.id) });
    },
  });
}

/**
 * Per-user realtime stream: any change to the caller's participant rows
 * (new conversation, unread bump from a peer's message, read state synced from
 * another tab) refreshes the list + badge. Channel name is unique per mount to
 * survive StrictMode double-mounts (same reasoning as useNotificationsRealtime).
 */
export function useChatListRealtime(): void {
  const qc = useQueryClient();
  const { user } = useAuth();
  useEffect(() => {
    if (!user) return;
    const channelName = `chat-list:${user.id}:${Math.random().toString(36).slice(2, 10)}`;
    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "conversation_participants",
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          void qc.invalidateQueries({ queryKey: chatKeys.conversations(user.id) });
          void qc.invalidateQueries({ queryKey: chatKeys.unread(user.id) });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [user, qc]);
}
