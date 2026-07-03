// Posts-sourced slider widget query - the single source of truth shared by the
// public renderer (PostsSliderWidget) and the SSR prefetch/streaming gate
// (lib/builder/prefetch). Before this module existed the queryFn lived inline
// in the widget component, so the server-side prefetch registry could not see
// it: the slider was server-rendered as its empty state and only filled in
// after client hydration fetched the posts - the most visible "content pops in
// late" element on the homepage.
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { WidgetContent } from "@/lib/builder/types";
import type { Lang } from "@/lib/builder/postListQuery";

export interface SliderPostRow {
  id: string;
  slug: string;
  title_pl: string | null;
  title_en: string | null;
  excerpt_pl: string | null;
  excerpt_en: string | null;
  cover_image_url: string | null;
  published_at: string | null;
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
  return getStr(c, key)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface SliderPostsInput {
  limit: number;
  categoryId: string;
  categorySlugs: string[];
  tagSlugs: string[];
  excludeIds: string[];
  orderBy: string;
}

/** The display limit a posts-mode slider renders. */
export function sliderPostsLimit(c: WidgetContent): number {
  return Math.max(1, Math.min(20, getNum(c, "limit", 5)));
}

export function sliderPostsInput(c: WidgetContent): SliderPostsInput {
  return {
    limit: sliderPostsLimit(c),
    categoryId: getStr(c, "categoryId"),
    categorySlugs: csv(c, "categorySlugs"),
    tagSlugs: csv(c, "tagSlugs"),
    excludeIds: csv(c, "excludeIds"),
    orderBy: getStr(c, "orderBy") || "newest",
  };
}

/**
 * Whether a `slider` widget renders from published posts (PostsSliderWidget)
 * rather than from manually configured items. Must stay in lockstep with the
 * routing in SimpleWidgets' "slider" case - the prefetch registry uses it to
 * warm the exact query the widget will read.
 *
 * Posts mode applies when explicitly chosen (`source: "posts"`), when every
 * manual item is a placeholder (no image and no post binding - legacy
 * "Pierwszy/Drugi slajd" defaults), or when there are no items at all.
 */
export function sliderUsesPostsSource(c: WidgetContent): boolean {
  if (getStr(c, "source") === "posts") return true;
  const rawItems = Array.isArray(c.items)
    ? (c.items as unknown[]).filter(
        (x): x is Record<string, unknown> => typeof x === "object" && x !== null,
      )
    : [];
  if (rawItems.length === 0) return true;
  const hasBoundItems = rawItems.some(
    (it) =>
      (typeof it.image === "string" && it.image) || (typeof it.postId === "string" && it.postId),
  );
  return !hasBoundItems;
}

async function fetchSliderPosts(input: SliderPostsInput, lang: Lang): Promise<SliderPostRow[]> {
  const { limit, categoryId, categorySlugs, tagSlugs, excludeIds, orderBy } = input;
  let allowedIds: string[] | null = null;
  if (categoryId) {
    const { data } = await supabase
      .from("post_categories")
      .select("post_id")
      .eq("category_id", categoryId);
    allowedIds = (data ?? []).map((r) => r.post_id);
  }
  if (categorySlugs.length) {
    const { data } = await supabase
      .from("post_categories")
      .select("post_id, categories!inner(slug)")
      .in("categories.slug", categorySlugs);
    const ids = (data ?? []).map((r: { post_id: string }) => r.post_id);
    allowedIds = allowedIds ? allowedIds.filter((id) => ids.includes(id)) : ids;
  }
  if (tagSlugs.length) {
    const { data: tagRows } = await supabase.from("tags").select("id").in("slug", tagSlugs);
    const tagIds = (tagRows ?? []).map((r) => r.id);
    if (tagIds.length) {
      const { data: ptRows } = await supabase
        .from("post_tags")
        .select("post_id")
        .in("tag_id", tagIds);
      const ids = (ptRows ?? []).map((r) => r.post_id);
      allowedIds = allowedIds ? allowedIds.filter((id) => ids.includes(id)) : ids;
    } else {
      allowedIds = [];
    }
  }
  if (allowedIds && allowedIds.length === 0) return [];
  let q = supabase
    .from("posts")
    .select("id, slug, title_pl, title_en, excerpt_pl, excerpt_en, cover_image_url, published_at")
    .eq("status", "published");
  if (allowedIds) q = q.in("id", allowedIds);
  if (excludeIds.length) q = q.not("id", "in", `(${excludeIds.join(",")})`);
  const ascending = orderBy === "oldest";
  const orderCol = orderBy === "title" ? (lang === "en" ? "title_en" : "title_pl") : "published_at";
  q = q.order(orderCol, { ascending });
  q = q.limit(limit);
  const { data } = await q;
  return (data ?? []) as SliderPostRow[];
}

export const sliderPostsQueryOptions = (c: WidgetContent, lang: Lang) => {
  const input = sliderPostsInput(c);
  return queryOptions({
    // Key shape kept identical to the widget's historical inline query so
    // deploys don't orphan warm cache entries.
    queryKey: ["builder-slider-posts", input] as const,
    queryFn: () => fetchSliderPosts(input, lang),
    staleTime: 2 * 60_000,
    gcTime: 10 * 60_000,
  });
};
