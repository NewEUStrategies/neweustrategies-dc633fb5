import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useEffect } from "react";

export interface ReadHistoryRow {
  id: string;
  post_id: string;
  read_at: string;
}

export function useReadHistory(limit = 50) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["read_history", user?.id, limit],
    enabled: !!user,
    queryFn: async (): Promise<ReadHistoryRow[]> => {
      const { data, error } = await supabase
        .from("user_read_history")
        .select("id, post_id, read_at")
        .order("read_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as ReadHistoryRow[];
    },
  });
}

export function useRecordRead() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (postId: string) => {
      if (!user) return;
      await supabase
        .from("user_read_history")
        .upsert(
          { user_id: user.id, post_id: postId, read_at: new Date().toISOString() },
          { onConflict: "user_id,post_id" },
        );
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["read_history", user?.id] }),
  });
}

/** Fire-and-forget: records that the user read this post when component mounts. */
export function useTrackPostRead(postId: string | undefined) {
  const { user } = useAuth();
  const record = useRecordRead();
  useEffect(() => {
    if (user && postId) {
      record.mutate(postId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, postId]);
}
