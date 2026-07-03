// Data layer for the PUBLIC block views (Gutenberg-style engine).
//
// One react-query module replaces the per-component useEffect+setState+raw
// supabase forks that used to live inside src/components/blocks/*. Rules
// (mirroring the builder engine, see src/lib/builder/postListQuery.ts):
//   * queryKey derived ONLY from the block's content inputs (+ lang where the
//     result depends on it) - the SSR prefetch and the client render resolve
//     the identical cache entry, so hydration never refetches or flashes;
//   * consumed via useQuery - with the loader prefetch (prefetchBlockQueries)
//     the data is already in the cache during SSR, so crawlers receive the
//     rendered lists instead of skeletons;
//   * staleTime 2 min / gcTime 10 min - same freshness contract as builder
//     widgets.
import { queryOptions, type FetchQueryOptions, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { BlocksDoc } from "@/lib/blocks/types";

const STALE_TIME = 2 * 60_000;
const GC_TIME = 10 * 60_000;

type Lang = "pl" | "en";

// ---------------------------------------------------------------------------
// Row shapes
// ---------------------------------------------------------------------------

export interface BlockPostRow {
  id: string;
  slug: string;
  title_pl: string | null;
  title_en: string | null;
  excerpt_pl: string | null;
  excerpt_en: string | null;
  cover_image_url: string | null;
  published_at: string | null;
  parent_page_id: string | null;
}

export interface TaxonomyItem {
  label: string;
  href: string;
  count: number;
}

export interface TagRow {
  slug: string;
  name: string;
}

export interface NavCategoryRow {
  id: string;
  slug: string;
  name_pl: string | null;
  name_en: string | null;
}

export interface PostNeighbor {
  post: BlockPostRow;
  href: string;
}

const POST_SELECT =
  "id, slug, title_pl, title_en, excerpt_pl, excerpt_en, cover_image_url, published_at, parent_page_id";

/** Post ids belonging to a category slug (empty slug -> null = no filter). */
async function postIdsForCategorySlug(categorySlug: string): Promise<string[] | null> {
  if (!categorySlug) return null;
  const { data: cat, error } = await supabase
    .from("categories")
    .select("id")
    .eq("slug", categorySlug)
    .maybeSingle();
  if (error) throw error;
  if (!cat?.id) return [];
  const { data: pc, error: pcErr } = await supabase
    .from("post_categories")
    .select("post_id")
    .eq("category_id", cat.id);
  if (pcErr) throw pcErr;
  return [...new Set((pc ?? []).map((r) => r.post_id))];
}

// ---------------------------------------------------------------------------
// latest-posts
// ---------------------------------------------------------------------------

export interface LatestPostsInput {
  count: number;
  category: string;
}

export const latestPostsBlockQueryOptions = (input: LatestPostsInput) =>
  queryOptions({
    queryKey: ["public", "blocks", "latest-posts", input] as const,
    staleTime: STALE_TIME,
    gcTime: GC_TIME,
    queryFn: async (): Promise<BlockPostRow[]> => {
      const safeCount = Math.max(1, Math.min(50, input.count));
      const ids = await postIdsForCategorySlug(input.category);
      if (ids !== null && ids.length === 0) return [];
      let q = supabase
        .from("posts")
        .select(POST_SELECT)
        .eq("status", "published")
        .is("deleted_at", null)
        .order("published_at", { ascending: false })
        .limit(safeCount);
      if (ids !== null) q = q.in("id", ids);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

// ---------------------------------------------------------------------------
// taxonomy lists (categories / archives) + tags
// ---------------------------------------------------------------------------

export const blockCategoriesQueryOptions = (lang: Lang) =>
  queryOptions({
    queryKey: ["public", "blocks", "categories", lang] as const,
    staleTime: STALE_TIME,
    gcTime: GC_TIME,
    queryFn: async (): Promise<TaxonomyItem[]> => {
      const { data, error } = await supabase
        .from("categories")
        .select("slug, name_pl, name_en")
        .order(lang === "en" ? "name_en" : "name_pl");
      if (error) throw error;
      return (data ?? []).map((c) => ({
        label: (lang === "en" ? c.name_en : c.name_pl) ?? c.name_pl ?? c.name_en ?? c.slug,
        href: `/category/${c.slug}`,
        count: 0,
      }));
    },
  });

export const blockArchivesQueryOptions = (lang: Lang) =>
  queryOptions({
    queryKey: ["public", "blocks", "archives", lang] as const,
    staleTime: STALE_TIME,
    gcTime: GC_TIME,
    queryFn: async (): Promise<TaxonomyItem[]> => {
      const { data, error } = await supabase
        .from("posts")
        .select("published_at")
        .eq("status", "published")
        .is("deleted_at", null)
        .not("published_at", "is", null)
        .order("published_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      const grouped = new Map<string, number>();
      for (const r of data ?? []) {
        if (!r.published_at) continue;
        const d = new Date(r.published_at);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        grouped.set(key, (grouped.get(key) ?? 0) + 1);
      }
      const fmt = new Intl.DateTimeFormat(lang === "en" ? "en" : "pl", {
        year: "numeric",
        month: "long",
      });
      return [...grouped.entries()].map(([key, count]) => {
        const [y, mo] = key.split("-").map(Number);
        return { label: fmt.format(new Date(y, mo - 1, 1)), href: `/archive/${key}`, count };
      });
    },
  });

export const blockTagsQueryOptions = (limit: number) =>
  queryOptions({
    queryKey: ["public", "blocks", "tags", { limit }] as const,
    staleTime: STALE_TIME,
    gcTime: GC_TIME,
    queryFn: async (): Promise<TagRow[]> => {
      const { data, error } = await supabase
        .from("tags")
        .select("slug, name")
        .order("name")
        .limit(Math.max(1, Math.min(200, limit)));
      if (error) throw error;
      return data ?? [];
    },
  });

// ---------------------------------------------------------------------------
// navigation (top categories as the MVP menu)
// ---------------------------------------------------------------------------

export const blockNavigationQueryOptions = () =>
  queryOptions({
    queryKey: ["public", "blocks", "navigation"] as const,
    staleTime: STALE_TIME,
    gcTime: GC_TIME,
    queryFn: async (): Promise<NavCategoryRow[]> => {
      const { data, error } = await supabase
        .from("categories")
        .select("id, slug, name_pl, name_en")
        .order("name_pl", { ascending: true })
        .limit(20);
      if (error) throw error;
      return data ?? [];
    },
  });

// ---------------------------------------------------------------------------
// post-navigation-link (prev/next neighbor of the current post)
// ---------------------------------------------------------------------------

export interface PostNeighborInput {
  currentId: string;
  publishedAt: string;
  direction: "prev" | "next";
}

export const postNeighborQueryOptions = (input: PostNeighborInput) =>
  queryOptions({
    queryKey: ["public", "blocks", "post-neighbor", input] as const,
    staleTime: STALE_TIME,
    gcTime: GC_TIME,
    queryFn: async (): Promise<PostNeighbor | null> => {
      const next = input.direction === "next";
      let q = supabase
        .from("posts")
        .select(POST_SELECT)
        .eq("status", "published")
        .is("deleted_at", null)
        .neq("id", input.currentId)
        .order("published_at", { ascending: !next })
        .limit(1);
      q = next ? q.lt("published_at", input.publishedAt) : q.gt("published_at", input.publishedAt);
      const { data, error } = await q;
      if (error) throw error;
      const row = (data ?? [])[0];
      if (!row) return null;
      if (row.parent_page_id) {
        const { data: path } = await supabase.rpc("page_full_path", {
          _page_id: row.parent_page_id,
        });
        return {
          post: row,
          href: `/${typeof path === "string" && path ? path : "blog"}/${row.slug}`,
        };
      }
      return { post: row, href: `/post/${row.slug}` };
    },
  });

// ---------------------------------------------------------------------------
// query-loop
// ---------------------------------------------------------------------------

export interface QueryLoopInput {
  categorySlug: string;
  limit: number;
  orderBy: "date" | "title";
  lang: Lang;
}

export const queryLoopBlockQueryOptions = (input: QueryLoopInput) =>
  queryOptions({
    queryKey: ["public", "blocks", "query-loop", input] as const,
    staleTime: STALE_TIME,
    gcTime: GC_TIME,
    queryFn: async (): Promise<BlockPostRow[]> => {
      const ids = await postIdsForCategorySlug(input.categorySlug);
      if (ids !== null && ids.length === 0) return [];
      let q = supabase
        .from("posts")
        .select(POST_SELECT)
        .eq("status", "published")
        .is("deleted_at", null)
        .limit(Math.max(1, Math.min(24, input.limit)));
      q =
        input.orderBy === "title"
          ? q.order(input.lang === "en" ? "title_en" : "title_pl", { ascending: true })
          : q.order("published_at", { ascending: false });
      if (ids !== null) q = q.in("id", ids);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

// ---------------------------------------------------------------------------
// related-posts (current-post context driven)
// ---------------------------------------------------------------------------

export interface RelatedPostsInput {
  currentId: string | null;
  strategy: "category" | "tag" | "author" | "latest";
  categorySlugs: readonly string[];
  tagSlugs: readonly string[];
  authorId: string | null;
  limit: number;
}

export const relatedPostsBlockQueryOptions = (input: RelatedPostsInput) =>
  queryOptions({
    queryKey: ["public", "blocks", "related", input] as const,
    staleTime: STALE_TIME,
    gcTime: GC_TIME,
    queryFn: async (): Promise<BlockPostRow[]> => {
      const cap = Math.max(1, Math.min(12, input.limit));
      let postIds: string[] | null = null;

      if (input.strategy === "category" && input.categorySlugs.length > 0) {
        const { data: cats, error } = await supabase
          .from("categories")
          .select("id")
          .in("slug", [...input.categorySlugs]);
        if (error) throw error;
        const catIds = (cats ?? []).map((r) => r.id);
        if (catIds.length > 0) {
          const { data: pc, error: pcErr } = await supabase
            .from("post_categories")
            .select("post_id")
            .in("category_id", catIds);
          if (pcErr) throw pcErr;
          postIds = [...new Set((pc ?? []).map((r) => r.post_id))];
        } else {
          postIds = [];
        }
      } else if (input.strategy === "tag" && input.tagSlugs.length > 0) {
        const { data: tags, error } = await supabase
          .from("tags")
          .select("id")
          .in("slug", [...input.tagSlugs]);
        if (error) throw error;
        const tagIds = (tags ?? []).map((r) => r.id);
        if (tagIds.length > 0) {
          const { data: pt, error: ptErr } = await supabase
            .from("post_tags")
            .select("post_id")
            .in("tag_id", tagIds);
          if (ptErr) throw ptErr;
          postIds = [...new Set((pt ?? []).map((r) => r.post_id))];
        } else {
          postIds = [];
        }
      }

      let q = supabase
        .from("posts")
        .select(POST_SELECT)
        .eq("status", "published")
        .is("deleted_at", null)
        .order("published_at", { ascending: false })
        .limit(cap);
      if (input.currentId) q = q.neq("id", input.currentId);
      if (input.strategy === "author" && input.authorId) q = q.eq("author_id", input.authorId);
      if (postIds !== null) {
        if (postIds.length === 0) return [];
        q = q.in("id", postIds);
      }
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

// ---------------------------------------------------------------------------
// author-bio (published posts count badge)
// ---------------------------------------------------------------------------

export const authorPostsCountQueryOptions = (authorId: string) =>
  queryOptions({
    queryKey: ["public", "blocks", "author-posts-count", authorId] as const,
    staleTime: STALE_TIME,
    gcTime: GC_TIME,
    queryFn: async (): Promise<number> => {
      const { count, error } = await supabase
        .from("posts")
        .select("id", { count: "exact", head: true })
        .eq("author_id", authorId)
        .eq("status", "published")
        .is("deleted_at", null);
      if (error) throw error;
      return typeof count === "number" ? count : 0;
    },
  });

// ---------------------------------------------------------------------------
// more-posts (latest / trending / same category as current post)
// ---------------------------------------------------------------------------

export interface MorePostsInput {
  strategy: "latest" | "trending" | "category";
  limit: number;
  categorySlug: string | null;
}

export const morePostsBlockQueryOptions = (input: MorePostsInput) =>
  queryOptions({
    queryKey: ["public", "blocks", "more-posts", input] as const,
    staleTime: STALE_TIME,
    gcTime: GC_TIME,
    queryFn: async (): Promise<BlockPostRow[]> => {
      const lim = Math.min(Math.max(input.limit, 2), 12);
      if (input.strategy === "trending") {
        const { data, error } = await supabase.rpc("trending_posts", {
          _days: 7,
          _limit: lim + 1,
        });
        if (error) throw error;
        return (data ?? []).map((p) => ({
          id: p.id,
          slug: p.slug,
          title_pl: p.title_pl,
          title_en: p.title_en,
          excerpt_pl: null,
          excerpt_en: null,
          cover_image_url: p.cover_image_url,
          published_at: p.published_at,
          parent_page_id: p.parent_page_id,
        }));
      }
      const ids =
        input.strategy === "category" && input.categorySlug
          ? await postIdsForCategorySlug(input.categorySlug)
          : null;
      if (input.strategy === "category" && (!ids || ids.length === 0)) return [];
      let q = supabase
        .from("posts")
        .select(POST_SELECT)
        .eq("status", "published")
        .is("deleted_at", null)
        .order("published_at", { ascending: false })
        .limit(lim + 1);
      if (ids !== null) q = q.in("id", ids);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

// ---------------------------------------------------------------------------
// calendar (published days of a month)
// ---------------------------------------------------------------------------

export interface CalendarInput {
  year: number;
  month: number;
}

export const calendarBlockQueryOptions = (input: CalendarInput) =>
  queryOptions({
    queryKey: ["public", "blocks", "calendar", input] as const,
    staleTime: STALE_TIME,
    gcTime: GC_TIME,
    queryFn: async (): Promise<Array<{ slug: string; published_at: string }>> => {
      const start = new Date(input.year, input.month - 1, 1).toISOString();
      const end = new Date(input.year, input.month, 1).toISOString();
      const { data, error } = await supabase
        .from("posts")
        .select("slug, published_at")
        .eq("status", "published")
        .is("deleted_at", null)
        .gte("published_at", start)
        .lt("published_at", end)
        .order("published_at", { ascending: true })
        .limit(500);
      if (error) throw error;
      return (data ?? []).filter(
        (r): r is { slug: string; published_at: string } => !!r.published_at,
      );
    },
  });

/** Resolve the month a `calendar` block targets ("YYYY-MM" or current). */
export function calendarTarget(month: string): CalendarInput {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (m) return { year: Number(m[1]), month: Number(m[2]) };
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

// ---------------------------------------------------------------------------
// SSR prefetch - the piece that makes the blocks engine crawler-complete.
// ---------------------------------------------------------------------------

export interface BlocksPrefetchCtx {
  /** Current post id (posts only) - drives neighbor/related/more-posts. */
  postId?: string | null;
  publishedAt?: string | null;
  authorId?: string | null;
  categorySlugs?: readonly string[];
  tagSlugs?: readonly string[];
}

function num(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function str(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

/** Union of every block data query - keeps prefetch/type-widening in one place. */
export type BlockDataQuery =
  | ReturnType<typeof latestPostsBlockQueryOptions>
  | ReturnType<typeof blockCategoriesQueryOptions>
  | ReturnType<typeof blockArchivesQueryOptions>
  | ReturnType<typeof blockTagsQueryOptions>
  | ReturnType<typeof blockNavigationQueryOptions>
  | ReturnType<typeof postNeighborQueryOptions>
  | ReturnType<typeof queryLoopBlockQueryOptions>
  | ReturnType<typeof relatedPostsBlockQueryOptions>
  | ReturnType<typeof authorPostsCountQueryOptions>
  | ReturnType<typeof morePostsBlockQueryOptions>
  | ReturnType<typeof calendarBlockQueryOptions>;

/**
 * Warm one block query. Same widening trade as the builder's
 * prefetchBuilderSectionQuery: the union has no single generic instantiation
 * for prefetchQuery, and only the runtime-intact queryKey/queryFn/staleTime
 * drive a prefetch, so the base FetchQueryOptions shape is sound here.
 */
function prefetchBlockDataQuery(queryClient: QueryClient, options: BlockDataQuery): Promise<void> {
  return queryClient.prefetchQuery(options as FetchQueryOptions);
}

/**
 * Map a blocks document to the query list its data-driven views will run,
 * mirroring the props BlocksRenderer derives from block.data 1:1 (same
 * inputs -> same queryKey -> the SSR cache is hit on render).
 */
export function blockQueryOptionsList(
  doc: BlocksDoc,
  lang: Lang,
  ctx: BlocksPrefetchCtx = {},
): BlockDataQuery[] {
  const list: BlockDataQuery[] = [];
  for (const block of doc.blocks) {
    switch (block.type) {
      case "latest-posts":
        list.push(
          latestPostsBlockQueryOptions({
            count: Math.max(1, Math.min(50, num(block.data.count, 5))),
            category: str(block.data.category, ""),
          }),
        );
        break;
      case "categories-list":
        list.push(blockCategoriesQueryOptions(lang));
        break;
      case "archives":
        list.push(blockArchivesQueryOptions(lang));
        break;
      case "tag-cloud":
        list.push(blockTagsQueryOptions(num(block.data.count, 30)));
        break;
      case "navigation":
        list.push(blockNavigationQueryOptions());
        break;
      case "calendar":
        list.push(calendarBlockQueryOptions(calendarTarget(str(block.data.month, ""))));
        break;
      case "post-navigation-link": {
        if (ctx.postId && ctx.publishedAt) {
          const direction = str(block.data.direction, "next") === "prev" ? "prev" : "next";
          list.push(
            postNeighborQueryOptions({
              currentId: ctx.postId,
              publishedAt: ctx.publishedAt,
              direction,
            }),
          );
        }
        break;
      }
      case "query-loop": {
        const orderBy = str(block.data.orderBy, "date") === "title" ? "title" : "date";
        list.push(
          queryLoopBlockQueryOptions({
            categorySlug: str(block.data.categorySlug, ""),
            limit: num(block.data.limit, 6),
            orderBy,
            lang,
          }),
        );
        break;
      }
      case "related-posts": {
        const s = str(block.data.strategy, "category");
        const strategy: RelatedPostsInput["strategy"] =
          s === "tag" ? "tag" : s === "author" ? "author" : s === "latest" ? "latest" : "category";
        list.push(
          relatedPostsBlockQueryOptions({
            currentId: ctx.postId ?? null,
            strategy,
            categorySlugs: ctx.categorySlugs ?? [],
            tagSlugs: ctx.tagSlugs ?? [],
            authorId: ctx.authorId ?? null,
            limit: num(block.data.limit, 3),
          }),
        );
        break;
      }
      case "author-bio":
        if (ctx.authorId && block.data.showPostsCount !== false) {
          list.push(authorPostsCountQueryOptions(ctx.authorId));
        }
        break;
      case "more-posts": {
        const s = str(block.data.strategy, "latest");
        const strategy: MorePostsInput["strategy"] =
          s === "trending" ? "trending" : s === "category" ? "category" : "latest";
        list.push(
          morePostsBlockQueryOptions({
            strategy,
            limit: num(block.data.limit, 4),
            categorySlug: strategy === "category" ? (ctx.categorySlugs?.[0] ?? null) : null,
          }),
        );
        break;
      }
      default:
        break;
    }
  }
  return list;
}

/**
 * Warm every data query a blocks document renders. Prefetch errors resolve
 * (never reject) so a single failing block cannot fail the SSR loader; the
 * affected view just falls back to its client fetch.
 */
export async function prefetchBlockQueries(
  queryClient: QueryClient,
  doc: BlocksDoc,
  lang: Lang,
  ctx: BlocksPrefetchCtx = {},
): Promise<void> {
  const options = blockQueryOptionsList(doc, lang, ctx);
  if (options.length === 0) return;
  await Promise.allSettled(options.map((opts) => prefetchBlockDataQuery(queryClient, opts)));
}
