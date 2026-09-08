// Odczyt i zapis TABELI rozmiarów czcionek tenanta
// (`site_design_tokens.font_scale`). Współdzieli jeden round-trip z tokenami
// marki i kolorami globalnymi (patrz fetchSiteDesignTokensRow).
import { useMutation, useQuery, useQueryClient, queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toJson } from "@/lib/builder/types";
import { notifyError, notifySuccess } from "@/lib/notify";
import { fetchSiteDesignTokensRow } from "@/lib/builder/designTokens";
import {
  EMPTY_FONT_SCALE,
  fontScaleToCss,
  normalizeFontScale,
  type FontScaleValue,
} from "@/lib/theme/fontScale";

const QUERY_KEY = ["site_font_scale"] as const;

export const fontScaleQueryOptions = queryOptions({
  queryKey: QUERY_KEY,
  queryFn: async (): Promise<FontScaleValue> => {
    // Czysto prezentacyjne (zasila zmienne CSS) - błąd degraduje do domyślnych
    // rozmiarów z `src/styles.css`, nigdy nie wywraca trasy.
    const data = await fetchSiteDesignTokensRow();
    if (!data) return EMPTY_FONT_SCALE;
    return normalizeFontScale(data.font_scale);
  },
  staleTime: 5 * 60_000,
});

export function useFontScale() {
  return useQuery(fontScaleQueryOptions);
}

export function useSaveFontScale() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (next: FontScaleValue) => {
      const clean = normalizeFontScale(next);
      const { error } = await supabase
        .from("site_design_tokens")
        .upsert({ font_scale: toJson(clean) }, { onConflict: "tenant_id" });
      if (error) throw error;
      return clean;
    },
    onSuccess: (next) => {
      qc.setQueryData(QUERY_KEY, next);
      notifySuccess("Zapisano rozmiary czcionek");
    },
    onError: (e: Error) => notifyError(e.message || "Błąd zapisu rozmiarów czcionek"),
  });
}

export { fontScaleToCss };
