// Query + mutation dla `expert_layout_settings` (per tenant). Wzorowane
// na `usePostLayoutSettings` - jedna publiczna opcja + hook zapisu dla
// panelu admin. Zapisujący jest staffem: RLS wymusza dostęp.
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  defaultExpertLayoutSettings,
  type ExpertLayoutSettings,
} from "@/lib/expertLayouts";

export const expertLayoutSettingsQueryOptions = () =>
  queryOptions({
    queryKey: ["expert-layout-settings"] as const,
    queryFn: async (): Promise<ExpertLayoutSettings> => {
      const { data, error } = await supabase
        .from("expert_layout_settings")
        .select("*")
        .maybeSingle();
      if (error && error.code !== "PGRST116") throw error;
      if (!data) return defaultExpertLayoutSettings();
      return data as unknown as ExpertLayoutSettings;
    },
    staleTime: 5 * 60_000,
  });

export function useExpertLayoutSettings() {
  return useQuery(expertLayoutSettingsQueryOptions());
}

export function useSaveExpertLayoutSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<ExpertLayoutSettings>) => {
      const { data: tRow, error: tErr } = await supabase.rpc("current_tenant_id");
      if (tErr) throw tErr;
      const tenant_id = (tRow as string | null) ?? undefined;
      if (!tenant_id) throw new Error("Brak tenanta w kontekście - nie mogę zapisać layoutu.");
      const payload = { ...patch, tenant_id };
      const { error } = await supabase
        .from("expert_layout_settings")
        .upsert(payload, { onConflict: "tenant_id" });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["expert-layout-settings"] }),
  });
}
