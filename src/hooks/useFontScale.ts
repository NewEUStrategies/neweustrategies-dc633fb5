// Odczyt i zapis TABELI rozmiarów czcionek tenanta
// (`site_design_tokens.font_scale`). Współdzieli jeden round-trip z tokenami
// marki i kolorami globalnymi (patrz fetchSiteDesignTokensRow).
//
// Ten moduł (odczyt prezentacyjny) rozgrzewa korzeń tras, więc jest w chunku
// startowym klienta. Odczyt EDYTORA i zapis mieszkają w `useFontScaleAdmin.ts`
// - nie importuj go stąd (roadmapa ładowania §9.1 J3).
import { useQuery, queryOptions } from "@tanstack/react-query";
import { fetchSiteDesignTokensRow } from "@/lib/builder/designTokens";
import {
  EMPTY_FONT_SCALE,
  fontScaleToCss,
  normalizeFontScale,
  type FontScaleValue,
} from "@/lib/theme/fontScale";

/** Klucz odczytu prezentacyjnego; zapis panelu (`useFontScaleAdmin.ts`) wpisuje pod niego wynik. */
export const QUERY_KEY = ["site_font_scale"] as const;

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

export { fontScaleToCss };
