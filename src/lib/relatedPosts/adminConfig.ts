// Warstwa danych panelu /admin/related-posts: odczyt i zapis konfiguracji
// WŁASNEGO obszaru roboczego (tenanta domowego zalogowanego użytkownika).
//
// Rozdział płaszczyzn jest tu celowy i istotny dla izolacji tenantów:
//   - PUBLICZNIE (lib/queries/relatedPosts) czytamy tenanta PRZEGLĄDANEGO
//     (`public_tenant_id()` z nagłówka hosta) - to dane publiczne strony;
//   - W PANELU czytamy i zapisujemy tenanta DOMOWEGO (`current_tenant_id()`
//     liczony z `profiles`) - nagłówek hosta nie może przestawić tego, czyją
//     konfigurację edytuje admin. Panel jednej firmy nie zobaczy więc i nie
//     nadpisze konfiguracji drugiej, nawet gdy otworzy jej domenę.

import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { RELATED_POSTS_DEFAULTS, type RelatedPostsConfig } from "@/lib/relatedPosts";
import {
  saveRelatedPostsConfig,
  type RelatedPostsConfigPort,
  type RelatedPostsConfigRow,
} from "@/lib/relatedPosts/settings";

export const RELATED_POSTS_ADMIN_QUERY_KEY = ["admin", "related-posts-config"] as const;
export const RELATED_POSTS_PUBLIC_QUERY_KEY = ["public", "related-posts-config"] as const;

const CONFIG_COLUMNS =
  "enabled, position, after_paragraph, layout, columns, items_limit, source_strategy, " +
  "show_excerpt, show_meta, show_cover, recency_boost_days, slider_autoplay, slider_interval_ms, " +
  "title_pl, title_en, weight_categories, weight_tags, weight_author, weight_recency, " +
  "weight_popularity, weight_dwell, weight_personalization, use_idf, min_score";

/** `current_tenant_id()` - tenant domowy zalogowanego użytkownika. */
async function resolveCurrentTenantId(): Promise<{
  tenantId: string | null;
  error: string | null;
}> {
  const { data, error } = await supabase.rpc("current_tenant_id");
  if (error) return { tenantId: null, error: error.message };
  return { tenantId: typeof data === "string" && data ? data : null, error: null };
}

/**
 * Port zapisu oparty o realnego klienta Supabase. Cała logika decyzyjna
 * (normalizacja, weryfikacja zapisu) siedzi w lib/relatedPosts/settings i jest
 * testowana bez sieci; ten moduł to wyłącznie adapter.
 */
export const supabaseRelatedPostsPort: RelatedPostsConfigPort = {
  currentTenantId: resolveCurrentTenantId,
  async upsert(row: RelatedPostsConfigRow) {
    // `.select("tenant_id")` jest OBOWIĄZKOWE: bez niego PostgREST zwraca 204 i
    // nie sposób odróżnić zapisu od braku dopasowania - dokładnie ten mechanizm
    // maskował błąd w poprzedniej implementacji (UPDATE + neq).
    const { data, error } = await supabase
      .from("related_posts_config")
      .upsert(row, { onConflict: "tenant_id" })
      .select("tenant_id");
    if (error) return { savedTenantIds: [], error: error.message };
    return { savedTenantIds: (data ?? []).map((r) => r.tenant_id), error: null };
  },
};

/** Konfiguracja WŁASNEGO tenanta - źródło prawdy dla formularza w panelu. */
export const relatedPostsAdminConfigQueryOptions = () =>
  queryOptions({
    queryKey: RELATED_POSTS_ADMIN_QUERY_KEY,
    queryFn: async (): Promise<RelatedPostsConfig> => {
      const { tenantId, error } = await resolveCurrentTenantId();
      if (error) throw new Error(error);
      // Brak tenanta = brak kontekstu edycji; formularz pokazuje defaulty, a
      // zapis (z tą samą przyczyną) zwróci czytelny błąd `no_tenant`.
      if (!tenantId) return RELATED_POSTS_DEFAULTS;
      const { data, error: readError } = await supabase
        .from("related_posts_config")
        .select(CONFIG_COLUMNS)
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (readError) throw new Error(readError.message);
      if (!data) return RELATED_POSTS_DEFAULTS;
      return { ...RELATED_POSTS_DEFAULTS, ...(data as Partial<RelatedPostsConfig>) };
    },
    staleTime: 30_000,
  });

/**
 * Zapis konfiguracji. Sukces oznacza POTWIERDZONY wiersz w bazie - inaczej
 * mutacja rzuca i panel pokazuje błąd, a nie „Zapisano".
 */
export function useSaveRelatedPostsConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (next: RelatedPostsConfig): Promise<RelatedPostsConfigRow> =>
      saveRelatedPostsConfig(supabaseRelatedPostsPort, next),
    onSuccess: (saved) => {
      // Cache dostaje wartości PO normalizacji (przycięte zakresy), nie surowy
      // draft z formularza - inaczej UI pokazywałby coś innego niż baza.
      const { tenant_id: _tenantId, ...config } = saved;
      qc.setQueryData(RELATED_POSTS_ADMIN_QUERY_KEY, config satisfies RelatedPostsConfig);
      void qc.invalidateQueries({ queryKey: RELATED_POSTS_PUBLIC_QUERY_KEY });
    },
  });
}
