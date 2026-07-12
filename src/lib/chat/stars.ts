// Starred messages (private per user - the sender never learns their message
// was starred; RLS exposes only the caller's own rows). The starred list joins
// messages through PostgREST, so expired / cleared-for-me messages drop out
// via the messages RLS automatically.
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { chatKeys } from "./keys";
import type { MessageRow } from "./types";

export interface StarredEntry {
  readonly message_id: string;
  readonly created_at: string;
  readonly message: MessageRow | null;
}

/** Ids of the caller's starred messages in one conversation (bubble stars). */
export function useStarredIds(
  conversationId: string,
  enabled: boolean,
): UseQueryResult<ReadonlySet<string>> {
  const { user } = useAuth();
  return useQuery({
    queryKey: chatKeys.stars(user?.id, conversationId),
    enabled: enabled && !!user,
    staleTime: 30_000,
    queryFn: async (): Promise<ReadonlySet<string>> => {
      const { data, error } = await supabase
        .from("message_stars")
        .select("message_id")
        .eq("conversation_id", conversationId)
        .limit(1000);
      if (error) throw error;
      return new Set((data ?? []).map((row) => row.message_id));
    },
  });
}

/** Full starred entries (with message payload) for the media-panel tab. */
export function useStarredMessages(
  conversationId: string,
  enabled: boolean,
): UseQueryResult<StarredEntry[]> {
  const { user } = useAuth();
  return useQuery({
    queryKey: chatKeys.starredList(user?.id, conversationId),
    enabled: enabled && !!user,
    staleTime: 30_000,
    queryFn: async (): Promise<StarredEntry[]> => {
      const { data, error } = await supabase
        .from("message_stars")
        .select("message_id, created_at, message:messages(*)")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return ((data ?? []) as unknown as StarredEntry[]).filter(
        (entry) => entry.message && !entry.message.deleted_at,
      );
    },
  });
}

export function useToggleStar(conversationId: string) {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: { messageId: string; starred: boolean }) => {
      if (!user) throw new Error("chat: auth required");
      if (input.starred) {
        const { error } = await supabase
          .from("message_stars")
          .delete()
          .eq("user_id", user.id)
          .eq("message_id", input.messageId);
        if (error) throw error;
        return;
      }
      // conversation_id + tenant_id are stamped by the BEFORE INSERT trigger
      // from the referenced message; passing anything client-side is ignored.
      const { error } = await supabase.from("message_stars").insert({
        user_id: user.id,
        message_id: input.messageId,
      } as never);
      if (error) throw error;
    },
    // Optimistic star flip; the invalidation reconciles the starred-list tab.
    onMutate: async (input) => {
      if (!user) return;
      const key = chatKeys.stars(user.id, conversationId);
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<ReadonlySet<string>>(key);
      qc.setQueryData<ReadonlySet<string>>(key, (old) => {
        const next = new Set(old ?? []);
        if (input.starred) next.delete(input.messageId);
        else next.add(input.messageId);
        return next;
      });
      return { previous };
    },
    onError: (_err, _input, ctx) => {
      if (!user || !ctx) return;
      qc.setQueryData(chatKeys.stars(user.id, conversationId), ctx.previous);
    },
    onSettled: () => {
      if (!user) return;
      void qc.invalidateQueries({ queryKey: chatKeys.stars(user.id, conversationId) });
      void qc.invalidateQueries({ queryKey: chatKeys.starredList(user.id, conversationId) });
    },
  });
}
