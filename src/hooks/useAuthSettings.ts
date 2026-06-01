import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AUTH_DEFAULTS, AUTH_SETTINGS_KEY, type AuthSettings } from "@/lib/authSettings";

export function useAuthSettings(): AuthSettings {
  const { data } = useQuery({
    queryKey: ["site_settings_public", AUTH_SETTINGS_KEY],
    queryFn: async (): Promise<AuthSettings> => {
      const { data, error } = await supabase
        .from("site_settings")
        .select("value")
        .eq("key", AUTH_SETTINGS_KEY)
        .maybeSingle();
      if (error) throw error;
      return { ...AUTH_DEFAULTS, ...((data?.value as Partial<AuthSettings> | null) ?? {}) };
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .upsert({ key: AUTH_SETTINGS_KEY, value: value as any }, { onConflict: "key" });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["site_settings_public", AUTH_SETTINGS_KEY] });
    },
  });
}
