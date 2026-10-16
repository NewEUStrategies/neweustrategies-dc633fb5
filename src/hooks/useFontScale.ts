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

/**
 * Odczyt EDYTORA tabeli (`/admin/appearance/font-sizes`) - świadomie inny niż
 * prezentacyjny wyżej.
 *
 * DLACZEGO NIE `fontScaleQueryOptions`. Tamten zamienia KAŻDĄ awarię odczytu
 * (`fetchSiteDesignTokensRow` łapie błąd i oddaje `null`) w pustą tabelę ze
 * świeżym znacznikiem czasu - dla arkusza CSS to właściwa degradacja, dla
 * edytora utrata danych: redaktor widzi same rozmiary domyślne, poprawia jeden
 * wiersz, a zapis (`font_scale` idzie W CAŁOŚCI) kasuje pozostałe nadpisania
 * najemcy. Tu błąd RZUCA, a pusta tabela znaczy wyłącznie „brak wiersza".
 *
 * Klucz pod prefiksem odczytu prezentacyjnego, poza zasięgiem rozgrzewki
 * korzenia; `staleTime: 0`, bo szkic edytora startuje z bazy, nie z cache'u
 * sprzed minut (zmianę mógł zrobić inny redaktor).
 */
export const adminFontScaleQueryOptions = queryOptions({
  queryKey: [...QUERY_KEY, "admin"] as const,
  queryFn: async (): Promise<FontScaleValue> => {
    const { data, error } = await supabase
      .from("site_design_tokens")
      .select("font_scale")
      .maybeSingle();
    if (error) throw error;
    return normalizeFontScale(data?.font_scale);
  },
  staleTime: 0,
});

export function useAdminFontScale() {
  return useQuery(adminFontScaleQueryOptions);
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
      qc.setQueryData(adminFontScaleQueryOptions.queryKey, next);
      notifySuccess("Zapisano rozmiary czcionek");
    },
    onError: (e: Error) => notifyError(e.message || "Błąd zapisu rozmiarów czcionek"),
  });
}

export { fontScaleToCss };
