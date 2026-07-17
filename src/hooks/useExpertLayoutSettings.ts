// Query + mutation dla `expert_layout_settings` (per tenant). Wzorowane
// na `usePostLayoutSettings` - jedna publiczna opcja + hook zapisu dla
// panelu admin. Zapisujący jest staffem: RLS wymusza dostęp.
//
// `expertLayoutSettingsQueryOptions(tenantId?)`:
//   - bez argumentu: RLS zwraca wiersz dla bieżącego tenanta hosta
//     (public_tenant_id() dla anonima, current_tenant_id() dla staffu).
//   - z tenantId: jawnie filtrujemy po tenant_id (np. profil eksperta,
//     którego tenant NIE jest bieżącym hostem - wystawiony przez subdomenę
//     innego tenanta lub udostępniony publicznie).
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { defaultExpertLayoutSettings, type ExpertLayoutSettings } from "@/lib/expertLayouts";

export const expertLayoutSettingsQueryOptions = (tenantId?: string | null) =>
  queryOptions({
    queryKey: ["expert-layout-settings", tenantId ?? "__current__"] as const,
    queryFn: async (): Promise<ExpertLayoutSettings> => {
      let q = supabase.from("expert_layout_settings").select("*");
      if (tenantId) q = q.eq("tenant_id", tenantId);
      const { data, error } = await q.maybeSingle();
      if (error && error.code !== "PGRST116") throw error;
      if (!data) return defaultExpertLayoutSettings(tenantId ?? "");
      return data as unknown as ExpertLayoutSettings;
    },
    staleTime: 5 * 60_000,
  });

export function useExpertLayoutSettings(tenantId?: string | null) {
  return useQuery(expertLayoutSettingsQueryOptions(tenantId));
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
