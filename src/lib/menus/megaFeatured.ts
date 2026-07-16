// Query options dla „Wyróżnionego wpisu" pokazywanego w kolumnie featured
// mega menu. Idempotentne, cache 60s. Jeśli `postId` przekazany - zwraca ten
// konkretny wpis. W przeciwnym razie zwraca ostatni opublikowany.
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

const COLS =
  "id, slug, title_pl, title_en, excerpt_pl, excerpt_en, cover_image_url, published_at, post_format";

async function fetchMegaFeatured(postId: string | null): Promise<MegaFeaturedPost | null> {
  if (postId) {
    const { data, error } = await supabase
      .from("posts")
      .select(COLS)
      .eq("id", postId)
      .eq("status", "published")
      .is("deleted_at", null)
      .maybeSingle();
    if (error || !data) {
      // fallback do najnowszego
      return fetchLatest();
    }
    return data as MegaFeaturedPost;
  }
  return fetchLatest();
}

async function fetchLatest(): Promise<MegaFeaturedPost | null> {
  const { data, error } = await supabase
    .from("posts")
    .select(COLS)
    .eq("status", "published")
    .is("deleted_at", null)
    .not("cover_image_url", "is", null)
    .order("published_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return (data as MegaFeaturedPost | null) ?? null;
}

export const megaFeaturedPostQueryOptions = (postId: string | null = null) =>
  queryOptions({
    queryKey: ["mega-menu-featured-post", postId] as const,
    queryFn: () => fetchMegaFeatured(postId),
    staleTime: 60_000,
  });
