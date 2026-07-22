// Warstwa danych retencji (przepływ anulowania subskrypcji): ustawienia
// kontrofertki i katalog powodów odejścia. Odczyt dla zalogowanych (RLS);
// zapisy idą wyłącznie przez server fns (lib/retention/functions.ts).
import { queryOptions, useQuery, type UseQueryResult } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type RetentionSettingsRow = Database["public"]["Tables"]["retention_settings"]["Row"];
export type RetentionReasonRow = Database["public"]["Tables"]["retention_reasons"]["Row"];
export type RetentionFeedbackRow = Database["public"]["Tables"]["retention_feedback"]["Row"];

export function retentionSettingsQueryOptions() {
  return queryOptions({
    queryKey: ["retention-settings"],
    staleTime: 60_000,
    queryFn: async (): Promise<RetentionSettingsRow | null> => {
      const { data, error } = await supabase.from("retention_settings").select("*").maybeSingle();
      if (error) throw error;
      return data ?? null;
    },
  });
}

export function retentionReasonsQueryOptions() {
  return queryOptions({
    queryKey: ["retention-reasons"],
    staleTime: 60_000,
    queryFn: async (): Promise<RetentionReasonRow[]> => {
      const { data, error } = await supabase
        .from("retention_reasons")
        .select("*")
        .eq("active", true)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useRetentionSettings(
  enabled: boolean,
): UseQueryResult<RetentionSettingsRow | null> {
  return useQuery({ ...retentionSettingsQueryOptions(), enabled });
}

export function useRetentionReasons(enabled: boolean): UseQueryResult<RetentionReasonRow[]> {
  return useQuery({ ...retentionReasonsQueryOptions(), enabled });
}

export function reasonLabel(reason: RetentionReasonRow, lang: string): string {
  return lang === "en" ? reason.label_en || reason.label_pl : reason.label_pl || reason.label_en;
}
