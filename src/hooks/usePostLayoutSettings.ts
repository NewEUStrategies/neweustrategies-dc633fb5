import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { defaultPostLayoutSettings, type PostLayoutSettings } from "@/lib/postLayouts";

export const postLayoutSettingsQueryOptions = () =>
  queryOptions({
    queryKey: ["post-layout-settings"] as const,
    queryFn: async (): Promise<PostLayoutSettings> => {
      const { data, error } = await supabase.from("post_layout_settings").select("*").maybeSingle();
      if (error && error.code !== "PGRST116") throw error;
      return (data as PostLayoutSettings | null) ?? defaultPostLayoutSettings();
    },
    staleTime: 5 * 60_000,
  });

export function usePostLayoutSettings() {
  return useQuery(postLayoutSettingsQueryOptions());
}

export function useSavePostLayoutSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<PostLayoutSettings>) => {
      // Resolve tenant_id explicitly so first-time inserts are deterministic
      // (DB default current_tenant_id() also works, but being explicit lets us
      // upsert idempotently regardless of whether a row exists).
      const { data: tRow, error: tErr } = await supabase.rpc("current_tenant_id");
      if (tErr) throw tErr;
      const tenant_id = (tRow as string | null) ?? undefined;
      const payload = { ...patch, ...(tenant_id ? { tenant_id } : {}) };
      const { error } = await supabase
        .from("post_layout_settings")
        .upsert(payload, { onConflict: "tenant_id" });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["post-layout-settings"] }),
  });
}
