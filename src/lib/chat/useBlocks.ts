// Block/unblock data layer for 1:1 chat. `user_blocks` is RLS owner-only
// (select/insert/delete), so the query below only ever sees the caller's own
// blocks. The server is the real enforcement point: message inserts and
// get_or_create_direct_conversation are rejected with "chat: blocked" for a
// blocked pair - this hook only powers the UI (header toggle + composer gate).
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

/** Key includes the user id - same rule as chatKeys, no cross-account leaks. */
const blocksKey = (uid: string | undefined) => ["chat", "blocks", uid ?? "anon"] as const;

type BlockSet = ReadonlySet<string>;

/** Ids of the users the caller has blocked (RLS returns only own rows). */
export function useMyBlocks(): UseQueryResult<BlockSet> {
  const { user } = useAuth();
  return useQuery({
    queryKey: blocksKey(user?.id),
    enabled: !!user,
    staleTime: 30_000,
    queryFn: async (): Promise<BlockSet> => {
      const { data, error } = await supabase.from("user_blocks").select("blocked_id");
      if (error) throw error;
      return new Set((data ?? []).map((row) => row.blocked_id));
    },
  });
}

/** Patch the cached block set in place so the composer gate flips instantly. */
function patchBlockSet(old: BlockSet | undefined, peerId: string, blocked: boolean): BlockSet {
  const next = new Set(old ?? []);
  if (blocked) next.add(peerId);
  else next.delete(peerId);
  return next;
}

/** Block a peer. tenant_id is mandatory on every insert (RLS check). */
export function useBlockUser(): UseMutationResult<void, Error, string> {
  const qc = useQueryClient();
  const { user, tenantId } = useAuth();
  return useMutation({
    mutationFn: async (peerId: string): Promise<void> => {
      if (!user) throw new Error("chat: auth required");
      if (!tenantId) throw new Error("chat: tenant not resolved");
      const { error } = await supabase.from("user_blocks").insert({
        blocker_id: user.id,
        blocked_id: peerId,
        tenant_id: tenantId,
      });
      if (error) throw error;
    },
    onSuccess: (_data, peerId) => {
      qc.setQueryData<BlockSet>(blocksKey(user?.id), (old) => patchBlockSet(old, peerId, true));
      void qc.invalidateQueries({ queryKey: blocksKey(user?.id) });
    },
  });
}

/** Lift an own block (RLS delete is owner-only, the filters are belt & braces). */
export function useUnblockUser(): UseMutationResult<void, Error, string> {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (peerId: string): Promise<void> => {
      if (!user) throw new Error("chat: auth required");
      const { error } = await supabase
        .from("user_blocks")
        .delete()
        .eq("blocker_id", user.id)
        .eq("blocked_id", peerId);
      if (error) throw error;
    },
    onSuccess: (_data, peerId) => {
      qc.setQueryData<BlockSet>(blocksKey(user?.id), (old) => patchBlockSet(old, peerId, false));
      void qc.invalidateQueries({ queryKey: blocksKey(user?.id) });
    },
  });
}
