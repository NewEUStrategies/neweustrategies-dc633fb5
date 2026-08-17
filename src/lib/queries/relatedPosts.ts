// Related-posts: TanStack Query options for global config + per-post compute.
// Runs entirely client-side against publicly readable tables (posts,
// post_categories, post_tags, related_posts_config).
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  RELATED_POSTS_DEFAULTS,
  rankRelated,
  scoreRelated,
  type RelatedPostsConfig,
} from "@/lib/relatedPosts";
import type { BlogListItem } from "@/lib/queries/public";
import { SPONSORED_LIST_COLS } from "@/lib/content/sponsored";

const RELATED_TTL = 5 * 60_000;

/**
 * Konfiguracja rekomendacji tenanta PRZEGLĄDANEGO (płaszczyzna publiczna).
 *
 * Czyta przez `get_related_posts_config()`, a nie przez `select().limit(1)`.
 * Dlaczego: polityki SELECT na tabeli sumują się (OR) - publiczna po
 * `public_tenant_id()` i edytorska po `current_tenant_id()`. Zalogowany
 * admin/edytor tenanta A, który przegląda domenę tenanta B, spełniał OBIE, więc
 * `limit(1)` mógł zwrócić wiersz TENANTA A i publiczna strona tenanta B
 * renderowała się cudzą konfiguracją. Funkcja zwraca wyłącznie wiersz tenanta
 * przeglądanego, więc odczyt jest deterministyczny i izolowany.
 *
 * Klucz zapytania celowo NIE zawiera tenanta - prefetch SSR i render kliencki
 * muszą trafiać w ten sam wpis cache (patrz components/blocks/renderer/tenant.tsx).
 */
export const relatedPostsConfigQueryOptions = () =>
  queryOptions({
    queryKey: ["public", "related-posts-config"] as const,
    queryFn: async (): Promise<RelatedPostsConfig> => {
      const { data } = await supabase.rpc("get_related_posts_config");
      const row = Array.isArray(data) ? data[0] : null;
      if (!row) return RELATED_POSTS_DEFAULTS;
      return { ...RELATED_POSTS_DEFAULTS, ...(row as Partial<RelatedPostsConfig>) };
    },
    staleTime: RELATED_TTL,
  });

export interface RelatedPostsInput {
  postId: string;
  limit: number;
  strategy: RelatedPostsConfig["source_strategy"];
  recencyBoostDays: number;
}

export const relatedPostsQueryOptions = (input: RelatedPostsInput) =>
  queryOptions({
    queryKey: ["public", "related-posts", input] as const,
    enabled: !!input.postId,
    queryFn: async (): Promise<BlogListItem[]> => {
      // 1. Current post's category/tag/author IDs.
      const [{ data: curCats }, { data: curTags }, { data: curPost }] = await Promise.all([
        supabase.from("post_categories").select("category_id").eq("post_id", input.postId),
        supabase.from("post_tags").select("tag_id").eq("post_id", input.postId),
        supabase
          .from("posts")
          .select("author_id, parent_page_id")
          .eq("id", input.postId)
          .maybeSingle(),
      ]);

      const curCatSet = new Set<string>((curCats ?? []).map((r) => r.category_id as string));
      const curTagSet = new Set<string>((curTags ?? []).map((r) => r.tag_id as string));
      const curAuthor = (curPost?.author_id as string | null) ?? null;

      // No signals at all → no related posts (avoid recommending random items).
      if (
        curCatSet.size === 0 &&
        curTagSet.size === 0 &&
        !(input.strategy === "author" && curAuthor)
      ) {
        return [];
      }

      // 2. Candidate post IDs sharing at least one signal.
      const candidateIds = new Set<string>();
      if ((input.strategy === "categories" || input.strategy === "both") && curCatSet.size > 0) {
        const { data } = await supabase
          .from("post_categories")
          .select("post_id")
          .in("category_id", Array.from(curCatSet));
        (data ?? []).forEach((r) => {
          const id = r.post_id as string;
          if (id !== input.postId) candidateIds.add(id);
        });
      }
      if ((input.strategy === "tags" || input.strategy === "both") && curTagSet.size > 0) {
        const { data } = await supabase
          .from("post_tags")
          .select("post_id")
          .in("tag_id", Array.from(curTagSet));
        (data ?? []).forEach((r) => {
          const id = r.post_id as string;
          if (id !== input.postId) candidateIds.add(id);
        });
      }
      if (input.strategy === "author" && curAuthor) {
        const { data } = await supabase
          .from("posts")
          .select("id")
          .eq("author_id", curAuthor)
          .neq("id", input.postId)
          .eq("status", "published")
          .is("deleted_at", null)
          .order("published_at", { ascending: false })
          .limit(50);
        (data ?? []).forEach((r) => candidateIds.add(r.id as string));
      }

      if (candidateIds.size === 0) return [];

      // 3. Hydrate candidates.
      const ids = Array.from(candidateIds).slice(0, 100);
      const { data: posts } = await supabase
        .from("posts")
        .select(
          `id, slug, title_pl, title_en, excerpt_pl, excerpt_en, cover_image_url, published_at, parent_page_id, author_id, ${SPONSORED_LIST_COLS}`,
        )
        .in("id", ids)
        .eq("status", "published")
        .is("deleted_at", null);
      const rows = (posts ?? []) as Array<{
        id: string;
        slug: string;
        title_pl: string;
        title_en: string;
        excerpt_pl: string | null;
        excerpt_en: string | null;
        cover_image_url: string | null;
        published_at: string | null;
        parent_page_id: string;
        author_id: string | null;
        is_sponsored: boolean | null;
        sponsored_kind: string | null;
        sponsored_affiliate: boolean | null;
      }>;
      if (rows.length === 0) return [];

      // 4. Fetch category/tag membership for candidates in bulk.
      const candIds = rows.map((r) => r.id);
      const [{ data: pc }, { data: pt }] = await Promise.all([
        supabase.from("post_categories").select("post_id, category_id").in("post_id", candIds),
        supabase.from("post_tags").select("post_id, tag_id").in("post_id", candIds),
      ]);
      const catsByPost = new Map<string, Set<string>>();
      (pc ?? []).forEach((r) => {
        const set = catsByPost.get(r.post_id as string) ?? new Set<string>();
        set.add(r.category_id as string);
        catsByPost.set(r.post_id as string, set);
      });
      const tagsByPost = new Map<string, Set<string>>();
      (pt ?? []).forEach((r) => {
        const set = tagsByPost.get(r.post_id as string) ?? new Set<string>();
        set.add(r.tag_id as string);
        tagsByPost.set(r.post_id as string, set);
      });

      // 5. Resolve parent page paths for href.
      const parentIds = Array.from(new Set(rows.map((r) => r.parent_page_id)));
      const paths = new Map<string, string>();
      await Promise.all(
        parentIds.map(async (pid) => {
          const { data: p } = await supabase.rpc("page_full_path", { _page_id: pid });
          if (typeof p === "string") paths.set(pid, p);
        }),
      );

      // 6. Score and rank.
      const scored = rows.map((r) => {
        const score = scoreRelated(
          { categoryIds: curCatSet, tagIds: curTagSet, authorId: curAuthor },
          {
            categoryIds: catsByPost.get(r.id) ?? new Set(),
            tagIds: tagsByPost.get(r.id) ?? new Set(),
            authorId: r.author_id,
          },
          { source_strategy: input.strategy, recency_boost_days: input.recencyBoostDays },
          r.published_at,
        );
        const item: BlogListItem = {
          is_sponsored: r.is_sponsored,
          sponsored_kind: r.sponsored_kind,
          sponsored_affiliate: r.sponsored_affiliate,
          id: r.id,
          slug: r.slug,
          title_pl: r.title_pl,
          title_en: r.title_en,
          excerpt_pl: r.excerpt_pl,
          excerpt_en: r.excerpt_en,
          cover_image_url: r.cover_image_url,
          published_at: r.published_at,
          parent_page_id: r.parent_page_id,
          href: `/${paths.get(r.parent_page_id) ?? "blog"}/${r.slug}`,
        };
        return { post: item, score };
      });

      return rankRelated(scored, input.limit).map((s) => s.post);
    },
    staleTime: RELATED_TTL,
  });
