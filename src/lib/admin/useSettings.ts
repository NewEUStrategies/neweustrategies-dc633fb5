// Shared hook + form helpers for site_settings sections.
import { toJson } from "@/lib/builder/types";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { siteSettingsQueryOptions } from "@/lib/useSiteSetting";
import { emitSiteSettingsInvalidate } from "@/lib/builder/siteSettingsLiveSync";
import { deepMerge } from "@/lib/deepMerge";

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
      // Stored settings evolve over time and may only contain selected nested
      // branches. A shallow spread can remove required defaults (for example
      // theme_options.header.search), which then crashes the whole admin pane.
      return deepMerge(defaults, data?.value);
    },
  });

  const save = useMutation({
    mutationFn: async (next: T) => {
      // Preserve unrelated nested branches. Several panes (e.g. General, SEO,
      // GlobalColorsEditor) call `useSettings("theme_options", <narrow shape>)`
      // - saving the narrow draft as-is would overwrite the whole row and
      // drop siblings like `header`, `buttons`, `text_fields`. Re-read the
      // current row and deep-merge `next` on top so partial writes are safe.
      const { data: existing, error: readErr } = await supabase
        .from("site_settings")
        .select("value")
        .eq("key", key)
        .maybeSingle();
      if (readErr) throw readErr;
      const base =
        existing?.value && typeof existing.value === "object" && !Array.isArray(existing.value)
          ? (existing.value as SettingsRecord)
          : ({} as SettingsRecord);
      const merged = deepMerge(base, next as unknown) as T;
      const { error } = await supabase
        .from("site_settings")
        .upsert({ key, value: toJson(merged) }, { onConflict: "tenant_id,key" });
      if (error) throw error;
      return merged;
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
