import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { useAuth } from "@/hooks/useAuth";

/** Zapisane wyszukiwanie: nazwa nadana przez użytkownika + zserializowane
 *  parametry URL (źródłem prawdy jest URL, params to wygodny snapshot). */
export interface SavedSearch {
  id: string;
  name: string;
  params: Record<string, unknown>;
  created_at: string;
}

export function useSavedSearches() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["saved-searches", user?.id],
    enabled: !!user,
    queryFn: async (): Promise<SavedSearch[]> => {
      const { data, error } = await supabase
        .from("saved_searches")
        .select("id, name, params, created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.id as string,
        name: r.name as string,
        params: (r.params as Record<string, unknown>) ?? {},
        created_at: r.created_at as string,
      }));
    },
  });
}

export function useSaveSearch() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({ name, params }: { name: string; params: Record<string, unknown> }) => {
      if (!user) throw new Error("Not authenticated");
      const { error } = await supabase
        .from("saved_searches")
        .insert({ user_id: user.id, name: name.trim().slice(0, 120), params: params as Json });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["saved-searches", user?.id] }),
  });
}

export function useDeleteSavedSearch() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (id: string) => {
      if (!user) throw new Error("Not authenticated");
      const { error } = await supabase.from("saved_searches").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["saved-searches", user?.id] }),
  });
}
