// Query options dla „Najnowszego wpisu" pokazywanego w kolumnie featured
// mega menu. Idempotentne, cache 60s. Zwraca pojedynczy wpis lub null.
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface MegaFeaturedPost {
  id: string;
  slug: string;
  title_pl: string | null;
  title_en: string | null;
  excerpt_pl: string | null;
  excerpt_en: string | null;
  cover_image_url: string | null;
  published_at: string | null;
  post_format: string | null;
}

async function fetchMegaFeatured(): Promise<MegaFeaturedPost | null> {
  const { data, error } = await supabase
    .from("posts")
    .select(
      "id, slug, title_pl, title_en, excerpt_pl, excerpt_en, cover_image_url, published_at, post_format",
    )
    .eq("status", "published")
    .is("deleted_at", null)
    .not("cover_image_url", "is", null)
    .order("published_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return (data as MegaFeaturedPost | null) ?? null;
}

export const megaFeaturedPostQueryOptions = queryOptions({
  queryKey: ["mega-menu-featured-post"] as const,
  queryFn: fetchMegaFeatured,
  staleTime: 60_000,
});
