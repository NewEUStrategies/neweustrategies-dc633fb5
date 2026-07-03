import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type BookmarkEntityType = "post" | "page";

export interface Bookmark {
  id: string;
  entity_type: BookmarkEntityType;
  entity_id: string;
  created_at: string;
}

export function useBookmarks() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["bookmarks", user?.id],
    enabled: !!user,
    queryFn: async (): Promise<Bookmark[]> => {
      const { data, error } = await supabase
        .from("user_bookmarks")
        .select("id, entity_type, entity_id, created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Bookmark[];
    },
  });
}

export function useIsBookmarked(entityType: BookmarkEntityType, entityId: string | undefined) {
  const { data } = useBookmarks();
  if (!entityId) return false;
  return (data ?? []).some((b) => b.entity_type === entityType && b.entity_id === entityId);
}

export function useToggleBookmark() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({
      entityType,
      entityId,
      on,
    }: {
      entityType: BookmarkEntityType;
      entityId: string;
      on: boolean;
    }) => {
      if (!user) throw new Error("Not authenticated");
      if (on) {
        const { error } = await supabase
          .from("user_bookmarks")
          .insert({ user_id: user.id, entity_type: entityType, entity_id: entityId });
        if (error && !String(error.message).includes("duplicate")) throw error;
      } else {
        const { error } = await supabase
          .from("user_bookmarks")
          .delete()
          .eq("user_id", user.id)
          .eq("entity_type", entityType)
          .eq("entity_id", entityId);
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bookmarks", user?.id] }),
  });
}
