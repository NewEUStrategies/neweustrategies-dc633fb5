// Rekomendacje postów - jedna ścieżka dla zalogowanego i gościa.
//
// Zastępuje server fn getRecommendedPosts (requireSupabaseAuth), który (a) był
// niedostępny dla gościa, (b) ignorował obserwowanych autorów, (c) tracił
// kontekst tenanta (klient serwerowy nie wysyłał x-tenant-host). RPC
// get_recommended_posts_v2 liczy scoring w SQL: zalogowany dostaje follows
// (autor/kategoria/tag) + historię czytania, gość - zainteresowania z
// localStorage przekazane parametrami. Klient przeglądarkowy dokłada
// x-tenant-host, więc tenant rozwiązuje się poprawnie na każdej domenie.
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { readAnonInterestIds } from "@/lib/personalization/anonMerge";
import type { Database } from "@/integrations/supabase/types";

export type RecommendedPost =
  Database["public"]["Functions"]["get_recommended_posts_v2"]["Returns"][number];

export type RecommendationReason = "author" | "category" | "tag" | "history" | "fresh";

export function useRecommendedPosts(
  limit = 9,
  options: { enabled?: boolean } = {},
): UseQueryResult<RecommendedPost[]> {
  const { user, loading } = useAuth();
  return useQuery({
    queryKey: ["recommended-posts", user?.id ?? "anon", limit],
    enabled: (options.enabled ?? true) && !loading,
    staleTime: 60_000,
    queryFn: async (): Promise<RecommendedPost[]> => {
      const anon = user ? { categoryIds: [], tagIds: [] } : readAnonInterestIds();
      const { data, error } = await supabase.rpc("get_recommended_posts_v2", {
        p_limit: limit,
        p_offset: 0,
        // Dla zalogowanego funkcja i tak używa follows z auth.uid();
        // tablice mają znaczenie wyłącznie dla gościa.
        p_category_ids: user ? [] : anon.categoryIds,
        p_tag_ids: user ? [] : anon.tagIds,
      });
      if (error) throw error;
      return data ?? [];
    },
  });
}
