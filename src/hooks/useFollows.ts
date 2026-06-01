import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type FollowTargetType = "author" | "category" | "tag";

export interface Follow {
  id: string;
  target_type: FollowTargetType;
  target_id: string;
  created_at: string;
}

export function useFollows() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["follows", user?.id],
    enabled: !!user,
    queryFn: async (): Promise<Follow[]> => {
      const { data, error } = await supabase
        .from("user_follows")
        .select("id, target_type, target_id, created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Follow[];
    },
  });
}

export function useIsFollowing(targetType: FollowTargetType, targetId: string | undefined) {
  const { data } = useFollows();
  if (!targetId) return false;
  return (data ?? []).some((f) => f.target_type === targetType && f.target_id === targetId);
}

export function useToggleFollow() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({ targetType, targetId, on }: { targetType: FollowTargetType; targetId: string; on: boolean }) => {
      if (!user) throw new Error("Not authenticated");
      if (on) {
        const { error } = await supabase
          .from("user_follows")
          .insert({ user_id: user.id, target_type: targetType, target_id: targetId });
        if (error && !String(error.message).includes("duplicate")) throw error;
      } else {
        const { error } = await supabase
          .from("user_follows")
          .delete()
          .eq("user_id", user.id)
          .eq("target_type", targetType)
          .eq("target_id", targetId);
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["follows", user?.id] }),
  });
}
