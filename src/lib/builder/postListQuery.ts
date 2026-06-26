import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { WidgetContent } from "@/lib/builder/types";

export type Lang = "pl" | "en";

export interface PostRow {
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

interface PostListInput {
  variant: string;
  limit: number;
  offset: number;
  cols: number;
  orderByRaw: "published_at" | "title" | "random" | "popular";
  orderDir: "asc" | "desc";
  postFormat: string;
  authorId: string;
  dateFrom: string;
  dateTo: string;
  popularDays: number;
  includeCats: string[];
  excludeCats: string[];
  includeTags: string[];
  excludeTags: string[];
  includeIds: string[];
  excludeIds: string[];
  usedSnapshot: readonly string[];
  lang: Lang;
}

function getStr(c: WidgetContent, key: string): string {
  const value = c[key];
  return typeof value === "string" ? value : "";
}

function getNum(c: WidgetContent, key: string, fallback: number): number {
  const value = c[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function csv(c: WidgetContent, key: string): string[] {
  return getStr(c, key).split(",").map((s) => s.trim()).filter(Boolean);
}

function safeOrderBy(raw: string): PostListInput["orderByRaw"] {
  return raw === "title" || raw === "random" || raw === "popular" ? raw : "published_at";
}

export function postListInput(
  c: WidgetContent,
  lang: Lang,
  usedSnapshot: readonly string[] = [],
): PostListInput {
  return {
    variant: getStr(c, "variant") || "card",
    limit: Math.max(1, Math.min(100, getNum(c, "limit", 6))),
    offset: Math.max(0, getNum(c, "offset", 0)),
    cols: Math.max(1, Math.min(6, getNum(c, "columns", 3))),
    orderByRaw: safeOrderBy(getStr(c, "orderBy") || "published_at"),
    orderDir: (getStr(c, "orderDir") || "desc") === "asc" ? "asc" : "desc",
    postFormat: getStr(c, "postFormat"),
    authorId: getStr(c, "authorId"),
    dateFrom: getStr(c, "dateFrom"),
    dateTo: getStr(c, "dateTo"),
    popularDays: Math.max(1, Math.min(365, getNum(c, "popularDays", 30))),
    includeCats: csv(c, "categoriesCsv"),
    excludeCats: csv(c, "excludeCategoriesCsv"),
    includeTags: csv(c, "tagsCsv"),
    excludeTags: csv(c, "excludeTagsCsv"),
    includeIds: csv(c, "includeIdsCsv"),
    excludeIds: csv(c, "excludeIdsCsv"),
    usedSnapshot,
    lang,
  };
}

async function fetchPostIdsBySlugs(
  table: "post_categories" | "post_tags",
  slugs: readonly string[],
): Promise<Set<string>> {
  if (!slugs.length) return new Set();
  if (table === "post_categories") {
    const { data: cats } = await supabase.from("categories").select("id").in("slug", [...slugs]);
    const ids = (cats ?? []).map((r: { id: string }) => r.id);
    if (!ids.length) return new Set();
    const { data: links } = await supabase.from("post_categories").select("post_id").in("category_id", ids);
    return new Set((links ?? []).map((r: { post_id: string }) => r.post_id));
  }
  const { data: tags } = await supabase.from("tags").select("id").in("slug", [...slugs]);
  const ids = (tags ?? []).map((r: { id: string }) => r.id);
  if (!ids.length) return new Set();
  const { data: links } = await supabase.from("post_tags").select("post_id").in("tag_id", ids);
  return new Set((links ?? []).map((r: { post_id: string }) => r.post_id));
}

/**
 * Reorder fetched rows to match a popularity ranking (most-popular first), then
 * apply the widget's offset/limit window. Pure and exported so the ordering
 * contract is unit-testable without the database. Rows whose id is absent from
 * `rankedIds` sort last, preserving their relative order.
 */
export function rankAndSlicePopular<T extends { id: string }>(
  rows: readonly T[],
  rankedIds: readonly string[],
  offset: number,
  limit: number,
): T[] {
  const order = new Map(rankedIds.map((id, i) => [id, i] as const));
  const sorted = [...rows].sort(
    (a, b) =>
      (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
      (order.get(b.id) ?? Number.MAX_SAFE_INTEGER),
  );
  const start = Math.max(0, offset);
  return sorted.slice(start, start + Math.max(0, limit));
}

/**
 * Resolve the popularity ranking via the tenant-scoped `popular_post_ids` RPC
 * (post_views aggregate, bounded server-side). Returns most-popular-first ids,
 * or `null` when the RPC is unavailable so the caller can degrade to recency
 * instead of rendering an empty widget.
 */
async function fetchPopularPostIds(
  days: number,
  orderDir: "asc" | "desc",
): Promise<string[] | null> {
  // 200 candidates is ample for any post-list (limit is clamped to 100) while
  // keeping the follow-up `.in("id", ...)` URL comfortably within length limits.
  // Cast RPC name through `unknown` because generated types lag behind the
  // `popular_post_ids` migration; the function is defined in
  // supabase/migrations/20260626120000_popular_post_ids.sql.
  const { data, error } = await (
    supabase.rpc as unknown as (
      fn: string,
      args: { _days: number; _limit: number },
    ) => Promise<{ data: unknown; error: { message: string } | null }>
  )("popular_post_ids", {
    _days: Math.max(1, Math.min(365, Math.round(days))),
    _limit: 200,
  });
  if (error) {
    if (typeof console !== "undefined") {
      // eslint-disable-next-line no-console
      console.warn(
        "[postList] popular_post_ids RPC unavailable; falling back to recency:",
        error.message,
      );
    }
    return null;
  }
  const rows = (data ?? []) as Array<{ post_id: string }>;
  const ids = rows.map((r) => r.post_id);
  // The RPC returns most-popular-first; "asc" flips to least-popular-first to
  // honour the widget's orderDir.
  return orderDir === "asc" ? ids.reverse() : ids;
}

async function fetchPostListRows(input: PostListInput): Promise<PostRow[]> {
  const [incCatIds, incTagIds, excCatIds, excTagIds] = await Promise.all([
    fetchPostIdsBySlugs("post_categories", input.includeCats),
    fetchPostIdsBySlugs("post_tags", input.includeTags),
    fetchPostIdsBySlugs("post_categories", input.excludeCats),
    fetchPostIdsBySlugs("post_tags", input.excludeTags),
  ]);

  const includeSets: Set<string>[] = [];
  if (input.includeCats.length) includeSets.push(incCatIds);
  if (input.includeTags.length) includeSets.push(incTagIds);
  if (input.includeIds.length) includeSets.push(new Set(input.includeIds));
  let includeSet: Set<string> | null = includeSets.length
    ? includeSets.slice(1).reduce(
        (acc, set) => new Set([...acc].filter((id) => set.has(id))),
        new Set(includeSets[0]),
      )
    : null;
  if (includeSet && includeSet.size === 0) return [];

  const excludeSet = new Set<string>([
    ...excCatIds,
    ...excTagIds,
    ...input.excludeIds,
    ...input.usedSnapshot,
  ]);

  // "popular" ranking comes from the tenant-scoped popular_post_ids RPC, which
  // aggregates post_views server-side behind a hard LIMIT - no full-table scan
  // of user_read_history. If the RPC is unavailable we degrade to recency
  // ordering (effectiveOrderBy) rather than rendering an empty widget.
  let popularIds: string[] | null = null;
  let effectiveOrderBy: PostListInput["orderByRaw"] = input.orderByRaw;
  if (input.orderByRaw === "popular") {
    const ranked = await fetchPopularPostIds(input.popularDays, input.orderDir);
    if (ranked === null) {
      effectiveOrderBy = "published_at";
    } else if (ranked.length === 0) {
      return [];
    } else {
      popularIds = ranked;
      const popSet = new Set(popularIds);
      includeSet = includeSet ? new Set([...includeSet].filter((x) => popSet.has(x))) : popSet;
    }
  }

  let q = supabase
    .from("posts")
    .select("id, slug, title_pl, title_en, excerpt_pl, excerpt_en, cover_image_url, published_at, post_format, author_id")
    .eq("status", "published")
    .is("deleted_at", null);

  if (input.postFormat) q = q.eq("post_format", input.postFormat);
  if (input.authorId) q = q.eq("author_id", input.authorId);
  if (input.dateFrom) q = q.gte("published_at", `${input.dateFrom}T00:00:00Z`);
  if (input.dateTo) q = q.lte("published_at", `${input.dateTo}T23:59:59Z`);
  if (includeSet) q = q.in("id", Array.from(includeSet));
  if (excludeSet.size) q = q.not("id", "in", `(${Array.from(excludeSet).join(",")})`);

  const orderCol =
    effectiveOrderBy === "title" ? `title_${input.lang}`
    : effectiveOrderBy === "random" || effectiveOrderBy === "popular" ? "published_at"
    : effectiveOrderBy;
  if (effectiveOrderBy !== "random" && effectiveOrderBy !== "popular") {
    q = q.order(orderCol, { ascending: input.orderDir === "asc" });
  }
  if (effectiveOrderBy !== "popular") {
    q = q.range(input.offset, input.offset + input.limit - 1);
  }

  const { data, error } = await q;
  if (error) throw error;
  let rows = (data ?? []) as PostRow[];
  if (effectiveOrderBy === "random") rows = [...rows].sort(() => Math.random() - 0.5);
  if (effectiveOrderBy === "popular" && popularIds) {
    rows = rankAndSlicePopular(rows, popularIds, input.offset, input.limit);
  }
  return rows;
}

export const postListQueryOptions = (
  c: WidgetContent,
  lang: Lang,
  usedSnapshot: readonly string[] = [],
) => {
  const input = postListInput(c, lang, usedSnapshot);
  return queryOptions({
    queryKey: ["builder-post-list", input] as const,
    queryFn: () => fetchPostListRows(input),
    staleTime: 2 * 60_000,
    gcTime: 10 * 60_000,
  });
};
