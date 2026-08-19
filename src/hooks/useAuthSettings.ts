import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  AUTH_DEFAULTS,
  AUTH_SETTINGS_KEY,
  normalizeAuthSettings,
  type AuthSettings,
} from "@/lib/authSettings";
import { siteSettingsQueryOptions } from "@/lib/useSiteSetting";
import { toJson } from "@/lib/builder/types";

export function useAuthSettings(): AuthSettings {
  const { data } = useQuery({
    queryKey: ["site_settings_public", AUTH_SETTINGS_KEY],
    queryFn: async ({ client }): Promise<AuthSettings> => {
      const settings = await client.ensureQueryData(siteSettingsQueryOptions);
      return normalizeAuthSettings(settings[AUTH_SETTINGS_KEY]);
    },
    staleTime: 60_000,
  });
  return data ?? AUTH_DEFAULTS;
}

export function useSaveAuthSettings() {
  const qc = useQueryClient();
  const queryKey = ["site_settings_public", AUTH_SETTINGS_KEY] as const;
  return useMutation({
    mutationFn: async (value: AuthSettings) => {
      const { error } = await supabase
        .from("site_settings")
        .upsert({ key: AUTH_SETTINGS_KEY, value: toJson(value) }, { onConflict: "tenant_id,key" });
      if (error) throw error;
    },
    onMutate: async (value) => {
      await qc.cancelQueries({ queryKey });
      const previous = qc.getQueryData<AuthSettings>(queryKey);
      qc.setQueryData(queryKey, value);
      return { previous };
    },
    onError: (_error, _value, context) => {
      if (context?.previous) qc.setQueryData(queryKey, context.previous);
      else qc.removeQueries({ queryKey, exact: true });
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey }),
        qc.invalidateQueries({ queryKey: ["site_settings_public", "all"] }),
      ]);
    },
  });
}
