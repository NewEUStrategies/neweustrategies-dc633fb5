// Dedicated query options for MegaMenu category columns.
// Centralising the queryKey + queryFn lets every MegaMenu instance share
// the same cache entry instead of running the same Supabase round-trip per
// hovered column. With staleTime=10min + gcTime=30min the dropdown only
// refetches when the underlying posts/categories actually change (the
// SiteSettingsLiveSync invalidator will trigger that for us).
import { queryOptions, keepPreviousData } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type MegaMenuLang = "pl" | "en";

export interface MegaMenuPostCard {
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

const pickLang = (a?: string | null, b?: string | null): string =>
  (a && a.length ? a : (b ?? "")) as string;

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
      const { data: cat } = await supabase
        .from("categories")
        .select("id, name_pl, name_en")
        .eq("slug", slug)
        .maybeSingle();
      if (!cat?.id) return { posts: [], catName: "" };
      const { data: pivot } = await supabase
        .from("post_categories")
        .select("post_id")
        .eq("category_id", cat.id as string)
        .limit(limit * 4);
      const ids = (pivot ?? []).map((r) => r.post_id as string);
      const catName = pickLang(cat.name_pl as string | null, cat.name_en as string | null);
      if (ids.length === 0) return { posts: [], catName };
      const { data: posts } = await supabase
        .from("posts")
        .select("id, slug, title_pl, title_en, cover_image_url, published_at")
        .in("id", ids)
        .eq("status", "published")
        .is("deleted_at", null)
        .order("published_at", { ascending: false })
        .limit(limit);
      return {
        posts: (posts ?? []).map((p) => ({
          id: p.id as string,
          slug: p.slug as string,
          title: pickLang(
            lang === "pl" ? (p.title_pl as string | null) : (p.title_en as string | null),
            p.title_pl as string | null,
          ),
          cover: (p.cover_image_url as string | null) ?? "",
          href: `/post/${p.slug as string}`,
        })),
        catName,
      };
    },
  });
}
