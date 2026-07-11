// Prev/next chronological neighbours of a published post - powers the
// show_prev_next footer navigation (PostFooterBars). Runs entirely
// client-side against the publicly readable `posts` table (anon RLS:
// published posts of the current tenant are visible via public_tenant_id),
// so no loader cost and no service role.
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface AdjacentPostRow {
  slug: string;
  title_pl: string;
  title_en: string;
  parent_page_id: string;
}

export interface AdjacentPosts {
  prev: AdjacentPostRow | null;
  next: AdjacentPostRow | null;
}

const COLS = "slug, title_pl, title_en, parent_page_id";

export const adjacentPostsQueryOptions = (postId: string | null, publishedAt: string | null) =>
  queryOptions({
    queryKey: ["public", "adjacent-posts", postId, publishedAt] as const,
    // Disabled until both keys are known AND the caller passes them (the $
    // route only forwards them when show_prev_next is effectively on).
    enabled: !!postId && !!publishedAt,
    queryFn: async (): Promise<AdjacentPosts> => {
      if (!postId || !publishedAt) return { prev: null, next: null };
      // previous = newest post published BEFORE the current one,
      // next = oldest post published AFTER it (strict comparisons, so the
      // current post never matches itself even without a neq(id) filter).
      const base = () =>
        supabase.from("posts").select(COLS).eq("status", "published").is("deleted_at", null);
      const [prevRes, nextRes] = await Promise.all([
        base().lt("published_at", publishedAt).order("published_at", { ascending: false }).limit(1),
        base().gt("published_at", publishedAt).order("published_at", { ascending: true }).limit(1),
      ]);
      if (prevRes.error) throw prevRes.error;
      if (nextRes.error) throw nextRes.error;
      const first = (rows: unknown[] | null): AdjacentPostRow | null =>
        ((rows ?? [])[0] as AdjacentPostRow | undefined) ?? null;
      return { prev: first(prevRes.data), next: first(nextRes.data) };
    },
    staleTime: 5 * 60_000,
  });
