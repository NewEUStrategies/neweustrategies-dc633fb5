// Public hook to read a site_settings key with defaults. Used by Header/Footer/etc.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useSiteSetting<T extends object>(key: string, defaults: T) {
  const { data } = useQuery({
    queryKey: ["site_settings_public", key],
    queryFn: async (): Promise<T> => {
      const { data, error } = await supabase
        .from("site_settings")
        .select("value")
        .eq("key", key)
        .maybeSingle();
      if (error) throw error;
      return { ...defaults, ...((data?.value as Partial<T> | null) ?? {}) };
    },
    staleTime: 60_000,
  });
  return data ?? defaults;
}
