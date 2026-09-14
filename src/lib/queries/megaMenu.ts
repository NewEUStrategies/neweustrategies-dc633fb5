// Dedicated query options for MegaMenu category columns.
// Centralising the queryKey + queryFn lets every MegaMenu instance share
// the same cache entry instead of running the same Supabase round-trip per
// hovered column. With staleTime=10min + gcTime=30min the dropdown only
// refetches when the underlying posts/categories actually change (the
// SiteSettingsLiveSync invalidator will trigger that for us).
import { queryOptions, keepPreviousData } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { pickLocalized } from "@/lib/i18n/pickLocalized";
import { postsNarrowedToTaxonomy } from "@/lib/queries/taxonomyPivot";

export type MegaMenuLang = "pl" | "en";

interface MegaMenuPostCard {
  id: string;
  slug: string;
  title: string;
  cover: string;
  href: string;
}

export interface MegaMenuCategoryData {
  posts: MegaMenuPostCard[];
  catName: string;
}

export function megaMenuCategoryQueryOptions(slug: string, limit: number, lang: MegaMenuLang) {
  return queryOptions({
    queryKey: ["mega-menu-cat", slug, limit, lang] as const,
    enabled: slug.length > 0,
    // The cache is invalidated explicitly by SiteSettingsLiveSync and by
    // edits in the menu editor; until then this data is safe to reuse.
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    // Keep the previous render while a different language/limit refetches
    // so the dropdown never flashes a skeleton mid-interaction.
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<MegaMenuCategoryData> => {
      const { data: cat, error: catError } = await supabase
        .from("categories")
        .select("id, name_pl, name_en")
        .eq("slug", slug)
        .maybeSingle();
      if (catError) throw catError;
      if (!cat?.id) return { posts: [], catName: "" };
      const catName = pickLocalized(cat as Record<string, unknown>, "name", lang);
      // JEDNO zapytanie, z sortowaniem tam, gdzie działa.
      //
      // Do 13.09.2026 stały tu DWA. Pierwsze próbkowało tabelę pośrednią
      // `.limit(limit * 4)` BEZ `ORDER BY` i dopiero drugie sortowało po
      // `published_at` - czyli „najnowsze wpisy" liczyły się z przypadkowej
      // czwórki razy limit. Kolejność bez `ORDER BY` nie jest w Postgresie
      // gwarantowana, ale bywa STABILNA, więc defekt nie objawiał się losowo:
      // konsekwentnie pomijał te same wpisy - a przy staleTime 10 min
      // i wyłączonym odświeżaniu próbka zastygała na całe okno pracy.
      // Nadpróbkowanie `limit * 4` jest teraz zbędne: filtr publikacji i limit
      // stoją w tym samym zapytaniu, co zawężenie.
      const { data: posts, error: postsError } = await postsNarrowedToTaxonomy(
        "id, slug, title_pl, title_en, cover_image_url, published_at",
        { kind: "category", termIds: [cat.id as string] },
      )
        .eq("status", "published")
        .is("deleted_at", null)
        .order("published_at", { ascending: false })
        .limit(limit);
      if (postsError) throw postsError;
      return {
        posts: (posts ?? []).map((p) => ({
          id: p.id as string,
          slug: p.slug as string,
          title: pickLocalized(p as Record<string, unknown>, "title", lang),
          cover: (p.cover_image_url as string | null) ?? "",
          href: `/post/${p.slug as string}`,
        })),
        catName,
      };
    },
  });
}
