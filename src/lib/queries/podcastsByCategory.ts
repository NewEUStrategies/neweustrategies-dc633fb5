// Odcinki specjalizacji na /category/$slug i /tag/$slug - liść `queries/podcasts.ts` (roadmapa ładowania §9.10).
// Importuje go wyłącznie `TaxonomyPage`, więc bundler wkłada go do chunku tej strony
// zamiast do wspólnego chunku zapytań podcastów: strona nie dostaje dodatkowego
// żądania w zestawie startowym. Kod przeniesiony bez zmian.
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Podcast } from "@/lib/podcast/types";
import { PODCAST_FIELDS } from "./podcastsLatest";

/** Odcinki przypięte do specjalizacji (kategorii) - sekcja na /category/$slug. */
export const podcastsByCategoryQueryOptions = (categoryId: string, limit = 8) =>
  queryOptions({
    queryKey: ["podcasts", "by-category", categoryId, limit] as const,
    queryFn: async (): Promise<Podcast[]> => {
      const { data, error } = await supabase
        .from("podcasts")
        .select(PODCAST_FIELDS)
        .eq("category_id", categoryId)
        .eq("status", "published")
        .is("deleted_at", null)
        .order("published_at", { ascending: false, nullsFirst: false })
        .limit(Math.max(1, Math.min(limit, 50)));
      if (error) throw error;
      // `as unknown as`: kolumny explicit / episode_type pochodzą z migracji
      // 20260725090500 i nie ma ich jeszcze w wygenerowanych typach.
      return (data ?? []) as unknown as Podcast[];
    },
    staleTime: 2 * 60_000,
    enabled: !!categoryId,
  });
