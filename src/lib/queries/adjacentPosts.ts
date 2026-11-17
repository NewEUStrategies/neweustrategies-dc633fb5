// Prev/next chronological neighbours of a published post - powers the
// show_prev_next footer navigation (PostFooterBars). Runs entirely
// client-side against the publicly readable `posts` table (anon RLS:
// published posts of the current tenant are visible via public_tenant_id),
// so no loader cost and no service role.
//
// Strona-rodzic sąsiada jedzie osadzeniem w TYM SAMYM odczycie
// (`readPostsWithParentPage`): sąsiad pod INNĄ stroną-rodzicem niż bieżący
// wpis dostaje dzięki temu adres kanoniczny, gdy ta strona jest najwyższego
// poziomu (trasa liczy go `postCanonicalHref`). Sąsiad pod TĄ SAMĄ stroną ma
// pełną ścieżkę z okruszków loadera (także zagnieżdżoną) - osadzenie jej nie
// zastępuje. Błąd odczytu z osadzeniem powtarza ten sam odczyt bez niego;
// błąd TEGO odczytu rzuca jak dotąd.
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { PostParentPage } from "@/lib/routing/postHref";
import { readPostsWithParentPage } from "@/lib/routing/postParentPageRead";

export interface AdjacentPostRow {
  slug: string;
  title_pl: string;
  title_en: string;
  parent_page_id: string;
  /** Strona-rodzic z osadzenia; brak pola albo `null` = adres z reguły trasy. */
  parent_page?: PostParentPage | null;
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
      const [prevRes, nextRes] = await Promise.all([
        readPostsWithParentPage(
          (columns: string) =>
            supabase
              .from("posts")
              .select(columns)
              .eq("status", "published")
              .is("deleted_at", null)
              .lt("published_at", publishedAt)
              .order("published_at", { ascending: false })
              .limit(1),
          COLS,
        ),
        readPostsWithParentPage(
          (columns: string) =>
            supabase
              .from("posts")
              .select(columns)
              .eq("status", "published")
              .is("deleted_at", null)
              .gt("published_at", publishedAt)
              .order("published_at", { ascending: true })
              .limit(1),
          COLS,
        ),
      ]);
      if (prevRes.error) throw prevRes.error;
      if (nextRes.error) throw nextRes.error;
      const first = (rows: unknown[] | null): AdjacentPostRow | null =>
        ((rows ?? [])[0] as AdjacentPostRow | undefined) ?? null;
      return { prev: first(prevRes.data), next: first(nextRes.data) };
    },
    staleTime: 5 * 60_000,
  });
