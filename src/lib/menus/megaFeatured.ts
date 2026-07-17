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
  author_id: string | null;
  author_display_name: string | null;
  author_slug: string | null;
  author_avatar_url: string | null;
}

const COLS =
  "id, slug, title_pl, title_en, excerpt_pl, excerpt_en, cover_image_url, published_at, post_format, author_id";

interface RawMegaFeaturedPost {
  id: string;
  slug: string;
  title_pl: string | null;
  title_en: string | null;
  excerpt_pl: string | null;
  excerpt_en: string | null;
  cover_image_url: string | null;
  published_at: string | null;
  post_format: string | null;
  author_id: string | null;
}

const EMPTY_AUTHOR: Pick<
  MegaFeaturedPost,
  "author_display_name" | "author_slug" | "author_avatar_url"
> = {
  author_display_name: null,
  author_slug: null,
  author_avatar_url: null,
};

async function fetchMegaFeatured(postId: string | null): Promise<MegaFeaturedPost | null> {
  const raw = await fetchRawMegaFeatured(postId);
  if (!raw) return null;
  const author = raw.author_id ? await fetchAuthor(raw.author_id) : EMPTY_AUTHOR;
  return { ...raw, ...author };
}

async function fetchRawMegaFeatured(postId: string | null): Promise<RawMegaFeaturedPost | null> {
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
      return fetchLatestRaw();
    }
    return data as RawMegaFeaturedPost;
  }
  return fetchLatestRaw();
}

async function fetchLatestRaw(): Promise<RawMegaFeaturedPost | null> {
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
  return (data as RawMegaFeaturedPost | null) ?? null;
}

async function fetchAuthor(
  authorId: string,
): Promise<
  Pick<
    MegaFeaturedPost,
    "author_display_name" | "author_first_name" | "author_last_name" | "author_slug" | "author_avatar_url"
  >
> {
  const { data } = await supabase
    .from("profiles")
    .select("display_name, first_name, last_name, slug, avatar_url")
    .eq("id", authorId)
    .maybeSingle();
  const p = data as {
    display_name: string | null;
    first_name: string | null;
    last_name: string | null;
    slug: string | null;
    avatar_url: string | null;
  } | null;
  return {
    author_display_name: p?.display_name ?? null,
    author_first_name: p?.first_name ?? null,
    author_last_name: p?.last_name ?? null,
    author_slug: p?.slug ?? null,
    author_avatar_url: p?.avatar_url ?? null,
  };
}

export const megaFeaturedPostQueryOptions = (postId: string | null = null) =>
  queryOptions({
    queryKey: ["mega-menu-featured-post", postId] as const,
    queryFn: () => fetchMegaFeatured(postId),
    staleTime: 60_000,
  });
