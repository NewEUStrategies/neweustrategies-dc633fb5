// Per-conversation nicknames (Messenger semantics: any member may set a
// nickname for any member; everyone in the conversation sees it).
//
// Data shape: ONE query per user covering every visible nickname row (RLS
// already scopes to the caller's conversations within their tenant), grouped
// client-side by conversation. Every surface - list rows, window header,
// group sender labels, typing indicator, reply quotes - resolves names
// through `resolveMemberName`, so a nickname wins wherever a profile name
// would have been shown.
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { chatKeys } from "./keys";
import type { PeerProfile } from "./types";

/** conversation_id -> (user_id -> nickname) */
export type NicknameIndex = ReadonlyMap<string, ReadonlyMap<string, string>>;

const EMPTY_INDEX: NicknameIndex = new Map();

interface NicknameRowLite {
  conversation_id: string;
  user_id: string;
  nickname: string;
}

/** Pure grouping - unit-tested without the Supabase client. */
export function buildNicknameIndex(rows: ReadonlyArray<NicknameRowLite>): NicknameIndex {
  const index = new Map<string, Map<string, string>>();
  for (const row of rows) {
    const nickname = row.nickname.trim();
    if (!nickname) continue;
    let byUser = index.get(row.conversation_id);
    if (!byUser) {
      byUser = new Map();
      index.set(row.conversation_id, byUser);
    }
    byUser.set(row.user_id, nickname);
  }
  return index;
}

/** Nickname of a member in a conversation, or null. */
export function nicknameFor(
  index: NicknameIndex | undefined,
  conversationId: string,
  userId: string,
): string | null {
  return index?.get(conversationId)?.get(userId) ?? null;
}

/**
 * Display name resolution used by every chat surface: nickname beats the
 * profile display name; the "..." fallback keeps layouts stable while the
 * profile query is in flight.
 */
export function resolveMemberName(
  index: NicknameIndex | undefined,
  conversationId: string,
  userId: string,
  profiles: ReadonlyMap<string, PeerProfile> | undefined,
  fallback = "...",
): string {
  return (
    nicknameFor(index, conversationId, userId) ?? profiles?.get(userId)?.display_name ?? fallback
  );
}

/** Every nickname visible to the caller, grouped by conversation. */
export function useNicknames(): UseQueryResult<NicknameIndex> {
  const { user } = useAuth();
  return useQuery({
    queryKey: chatKeys.nicknames(user?.id),
    enabled: !!user,
    staleTime: 60_000,
    placeholderData: (previous) => previous ?? EMPTY_INDEX,
    queryFn: async (): Promise<NicknameIndex> => {
      const { data, error } = await supabase
        .from("conversation_nicknames")
        .select("conversation_id, user_id, nickname")
        .limit(2000);
      if (error) throw error;
      return buildNicknameIndex(data ?? []);
    },
  });
}

/**
 * Set/clear a member's nickname (empty string clears). Optimistic: the new
 * name lands in the index instantly; the per-conversation realtime stream
 * (conversation_nicknames postgres_changes) reconciles cross-client.
 */
export function useSetNickname() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: { conversationId: string; userId: string; nickname: string }) => {
      const { error } = await supabase.rpc("chat_set_nickname", {
        p_conversation_id: input.conversationId,
        p_user_id: input.userId,
        p_nickname: input.nickname.trim(),
      });
      if (error) throw error;
    },
    onMutate: async (input) => {
      if (!user) return;
      const key = chatKeys.nicknames(user.id);
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<NicknameIndex>(key);
      qc.setQueryData<NicknameIndex>(key, (old) => {
        const next = new Map<string, ReadonlyMap<string, string>>(old ?? []);
        const byUser = new Map(next.get(input.conversationId) ?? []);
        const trimmed = input.nickname.trim();
        if (trimmed) byUser.set(input.userId, trimmed);
        else byUser.delete(input.userId);
        if (byUser.size === 0) next.delete(input.conversationId);
        else next.set(input.conversationId, byUser);
        return next;
      });
      return { previous };
    },
    onError: (_err, _input, ctx) => {
      if (!user || !ctx) return;
      qc.setQueryData(chatKeys.nicknames(user.id), ctx.previous);
    },
    onSettled: () => {
      if (!user) return;
      void qc.invalidateQueries({ queryKey: chatKeys.nicknames(user.id) });
    },
  });
}
