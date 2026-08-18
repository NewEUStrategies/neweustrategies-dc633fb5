// Hook + helpery dla "Global Colors" - strukturalnej palety zapisywanej w
// `site_design_tokens.global_colors`. Współistnieje z dowolnymi `colors` marki.
import { toJson } from "@/lib/builder/types";
import { useMutation, useQuery, useQueryClient, queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { notifyError, notifySuccess } from "@/lib/notify";
import {
  EMPTY_GLOBAL_COLORS,
  type GlobalColorsValue,
  globalColorsToCss,
} from "@/lib/builder/globalColors";
import { fetchSiteDesignTokensRow } from "@/lib/builder/designTokens";

const QUERY_KEY = ["site_global_colors"] as const;

export const globalColorsQueryOptions = queryOptions({
  queryKey: QUERY_KEY,
  queryFn: async (): Promise<GlobalColorsValue> => {
    // Wspólny odczyt wiersza `site_design_tokens` z tokenami marki (jeden
    // round-trip zamiast dwóch na każdą trasę - patrz fetchSiteDesignTokensRow).
    // Presentational only (feeds CSS variables) and warmed by the root loader on
    // every route: degrade to defaults on error instead of throwing, so a
    // transient failure here cannot 500 the whole site.
    const data = await fetchSiteDesignTokensRow();
    if (!data) return EMPTY_GLOBAL_COLORS;
    const raw = (data.global_colors ?? {}) as Record<string, { light?: string; dark?: string }>;
    return raw ?? EMPTY_GLOBAL_COLORS;
  },
  staleTime: 5 * 60_000,
});

export function useGlobalColors() {
  return useQuery(globalColorsQueryOptions);
}

export function useSaveGlobalColors() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (next: GlobalColorsValue) => {
      const { error } = await supabase
        .from("site_design_tokens")
        .upsert({ global_colors: toJson(next) }, { onConflict: "tenant_id" });
      if (error) throw error;
      return next;
    },
    onSuccess: (next) => {
      qc.setQueryData(QUERY_KEY, next);
      notifySuccess("Zapisano kolory globalne");
    },
    onError: (e: Error) => notifyError(e.message || "Błąd zapisu kolorów"),
  });
}

export { globalColorsToCss };
