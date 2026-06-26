// Shared hook + form helpers for site_settings sections.
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { siteSettingsQueryOptions } from "@/lib/useSiteSetting";
import { emitSiteSettingsInvalidate } from "@/lib/builder/siteSettingsLiveSync";

type Json = string | number | boolean | null | { [k: string]: Json } | Json[];
export type SettingsRecord = { [k: string]: Json };

export function useSettings<T extends SettingsRecord>(key: string, defaults: T) {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["site_settings", key],
    queryFn: async (): Promise<T> => {
      const { data, error } = await supabase
        .from("site_settings")
        .select("value")
        .eq("key", key)
        .maybeSingle();
      if (error) throw error;
      return { ...defaults, ...((data?.value as T | null) ?? {}) };
    },
  });

  const save = useMutation({
    mutationFn: async (next: T) => {
      const { error } = await supabase
        .from("site_settings")
        .upsert({ key, value: next as unknown as Json }, { onConflict: "key" });
      if (error) throw error;
      return next;
    },
    onSuccess: (next) => {
      qc.setQueryData(["site_settings", key], next);
      qc.setQueryData(
        siteSettingsQueryOptions.queryKey,
        (prev: Record<string, unknown> | undefined) => ({
          ...(prev ?? {}),
          [key]: next,
        }),
      );
      emitSiteSettingsInvalidate();
      toast.success("Zapisano");
    },
    onError: (e: Error) => toast.error(e.message || "Błąd zapisu"),
  });

  return { query, save };
}

export function useDraft<T extends SettingsRecord>(loaded: T | undefined) {
  const [draft, setDraft] = useState<T | null>(null);
  useEffect(() => {
    if (loaded && !draft) setDraft(loaded);
  }, [loaded, draft]);
  return [draft, setDraft] as const;
}
