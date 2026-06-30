// Query options for the builder `news-ticker` widget. Extracted into a shared
// module (was inline in NewsTickerView) so the Suspense stream gate / loader
// prefetch and the widget render resolve the SAME cache entry. The key is
// snapshot-independent: uniqueOnPage de-dup is applied client-side over the
// fetched rows (see dedupeAndSlice), never baked into the query key - otherwise a
// streamed ticker would refetch under a divergent key after hydration.
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { WidgetContent } from "@/lib/builder/types";
import type { Lang } from "@/lib/builder/postListQuery";

export interface TickerPost {
  id: string;
  slug: string;
  title_pl: string | null;
  title_en: string | null;
}

interface NewsTickerInput {
  /** Rows to FETCH (over-fetched past the display limit when uniqueOnPage). */
  limit: number;
  categorySlugs: string[];
}

// Extra rows fetched when uniqueOnPage is set, so the client de-dup can still
// fill the ticker after excluding posts shown by earlier widgets.
const UNIQUE_FETCH_HEADROOM = 18;

function readBool(c: WidgetContent, key: string, dflt: boolean): boolean {
  const v = c[key];
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v === "true" || v === "1";
  return dflt;
}
function readNum(c: WidgetContent, key: string, dflt: number): number {
  const v = c[key];
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() && !Number.isNaN(Number(v))) return Number(v);
  return dflt;
}
function readStr(c: WidgetContent, key: string, dflt = ""): string {
  const v = c[key];
  return typeof v === "string" ? v : dflt;
}

/** Number of items the ticker displays (before over-fetch). */
export function newsTickerDisplayLimit(c: WidgetContent): number {
  return Math.max(3, Math.min(30, readNum(c, "limit", 10)));
}

function wantsUniqueOnPage(c: WidgetContent): boolean {
  return readBool(c, "uniqueOnPage", false);
}

export function newsTickerInput(c: WidgetContent): NewsTickerInput {
  const display = newsTickerDisplayLimit(c);
  const limit = wantsUniqueOnPage(c)
    ? Math.min(60, display + UNIQUE_FETCH_HEADROOM)
    : display;
  const categorySlugs = readStr(c, "categoriesCsv", "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return { limit, categorySlugs };
}

async function fetchTickerPosts(input: NewsTickerInput): Promise<TickerPost[]> {
  let allowedIds: string[] | null = null;
  if (input.categorySlugs.length) {
    const { data: cats } = await supabase.from("categories").select("id").in("slug", input.categorySlugs);
    const catIds = (cats ?? []).map((r: { id: string }) => r.id);
    if (!catIds.length) return [];
    const { data: links } = await supabase.from("post_categories").select("post_id").in("category_id", catIds);
    allowedIds = Array.from(new Set((links ?? []).map((r: { post_id: string }) => r.post_id)));
    if (!allowedIds.length) return [];
  }
  let q = supabase
    .from("posts")
    .select("id, slug, title_pl, title_en")
    .eq("status", "published")
    .order("published_at", { ascending: false })
    .limit(input.limit);
  if (allowedIds) q = q.in("id", allowedIds);
  const { data } = await q;
  return (data ?? []) as TickerPost[];
}

// `lang` is accepted for call-site symmetry with the other builder widget
// queries; the ticker selects both title columns and picks the language at
// render, so it does not affect the fetch (or the cache key).
export const newsTickerQueryOptions = (c: WidgetContent, _lang: Lang) => {
  const input = newsTickerInput(c);
  return queryOptions({
    queryKey: ["builder-news-ticker", input] as const,
    queryFn: () => fetchTickerPosts(input),
    staleTime: 2 * 60_000,
    gcTime: 10 * 60_000,
  });
};
