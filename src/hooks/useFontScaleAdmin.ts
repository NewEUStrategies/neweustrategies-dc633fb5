// Tabela rozmiarów czcionek - część PANELU (`/admin/appearance/font-sizes`):
// odczyt edytora (błąd RZUCA, patrz niżej) i zapis. Odczyt prezentacyjny
// zasilający zmienne CSS żyje w `useFontScale.ts`.
//
// OSOBNY MODUŁ, CELOWO (chunk startowy, roadmapa ładowania §9.1 J3).
// `useFontScale.ts` rozgrzewa korzeń tras, więc siedzi w `app-initial`; to
// tutaj woła wyłącznie panel. `useFontScale.ts` NIE importuje stąd niczego -
// także reeksportem.
import { useMutation, useQuery, useQueryClient, queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toJson } from "@/lib/builder/types";
import { notifyError, notifySuccess } from "@/lib/notify";
import { normalizeFontScale, type FontScaleValue } from "@/lib/theme/fontScale";
import { QUERY_KEY } from "./useFontScale";

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
