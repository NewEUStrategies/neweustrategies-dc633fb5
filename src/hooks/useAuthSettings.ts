import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AUTH_DEFAULTS, AUTH_SETTINGS_KEY, type AuthSettings } from "@/lib/authSettings";
import { siteSettingsQueryOptions } from "@/lib/useSiteSetting";
import { toJson } from "@/lib/builder/types";

export function useAuthSettings(): AuthSettings {
  const { data } = useQuery({
    queryKey: ["site_settings_public", AUTH_SETTINGS_KEY],
    queryFn: async ({ client }): Promise<AuthSettings> => {
      const settings = await client.ensureQueryData(siteSettingsQueryOptions);
      return {
        ...AUTH_DEFAULTS,
        ...((settings[AUTH_SETTINGS_KEY] as Partial<AuthSettings> | null) ?? {}),
      };
    },
    staleTime: 60_000,
  });
  return data ?? AUTH_DEFAULTS;
}

export function useSaveAuthSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (value: AuthSettings) => {
      const { error } = await supabase
        .from("site_settings")
        .upsert({ key: AUTH_SETTINGS_KEY, value: toJson(value) }, { onConflict: "tenant_id,key" });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["site_settings_public", AUTH_SETTINGS_KEY] });
      qc.invalidateQueries({ queryKey: ["site_settings_public", "all"] });
    },
  });
}
