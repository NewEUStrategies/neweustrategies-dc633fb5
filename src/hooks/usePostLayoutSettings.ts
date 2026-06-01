import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { defaultPostLayoutSettings, type PostLayoutSettings } from "@/lib/postLayouts";

export function usePostLayoutSettings() {
  return useQuery({
    queryKey: ["post-layout-settings"],
    queryFn: async (): Promise<PostLayoutSettings> => {
      const { data, error } = await supabase
        .from("post_layout_settings")
        .select("*")
        .maybeSingle();
      if (error && error.code !== "PGRST116") throw error;
      return (data as PostLayoutSettings | null) ?? defaultPostLayoutSettings();
    },
    staleTime: 60_000,
  });
}

export function useSavePostLayoutSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<PostLayoutSettings>) => {
      const { data: existing } = await supabase.from("post_layout_settings").select("tenant_id").maybeSingle();
      if (existing) {
        const { error } = await supabase.from("post_layout_settings").update(patch).eq("tenant_id", existing.tenant_id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("post_layout_settings").insert(patch);
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["post-layout-settings"] }),
  });
}
