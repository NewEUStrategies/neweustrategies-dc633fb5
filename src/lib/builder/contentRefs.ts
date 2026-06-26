// Live content reference resolvers for builder widgets.
// Any widget that points at a post/page/category/tag should run its display
// data through these hooks so editing the source entity propagates instantly
// (covers, titles, excerpts, hrefs, taxonomy labels) without duplicating
// payload in widget JSON.
//
// Cache keys are stable + lang-scoped so a single invalidate({ queryKey:
// ["post-ref"] }) refreshes every widget on the page.

import { useQueries, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type Lang = "pl" | "en";

export interface PostRefData {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  cover: string;
  href: string;
  publishedAt: string | null;
  authorName: string;
}

const POST_REF_STALE = 60_000; // 1 min - aggressive enough to feel "live"
const POST_REF_GC = 5 * 60_000;

interface RawPostRow {
  id: string;
  slug: string;
  title_pl: string | null;
  title_en: string | null;
  excerpt_pl: string | null;
  excerpt_en: string | null;
  cover_image_url: string | null;
  published_at: string | null;
  author_id: string | null;
}

async function fetchPostRef(id: string): Promise<RawPostRow | null> {
  const { data, error } = await supabase
    .from("posts")
    .select(
      "id, slug, title_pl, title_en, excerpt_pl, excerpt_en, cover_image_url, published_at, author_id",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) return null;
  return (data as RawPostRow | null) ?? null;
}

async function fetchAuthorName(id: string | null): Promise<string> {
  if (!id) return "";
  const { data } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", id)
    .maybeSingle();
  const row = data as { display_name: string | null } | null;
  return row?.display_name ?? "";
}

function toPostRef(row: RawPostRow | null, authorName: string, lang: Lang): PostRefData | null {
  if (!row) return null;
  const title = (lang === "en" ? row.title_en : row.title_pl) ?? row.title_pl ?? row.title_en ?? "";
  const excerpt = (lang === "en" ? row.excerpt_en : row.excerpt_pl) ?? row.excerpt_pl ?? row.excerpt_en ?? "";
  return {
    id: row.id,
    slug: row.slug,
    title: title ?? "",
    excerpt: excerpt ?? "",
    cover: row.cover_image_url ?? "",
    href: `/post/${row.slug}`,
    publishedAt: row.published_at,
    authorName,
  };
}

export function postRefQueryOptions(id: string | null | undefined, lang: Lang) {
  return {
    queryKey: ["post-ref", id ?? "", lang] as const,
    queryFn: async (): Promise<PostRefData | null> => {
      if (!id) return null;
      const row = await fetchPostRef(id);
      const authorName = await fetchAuthorName(row?.author_id ?? null);
      return toPostRef(row, authorName, lang);
    },
    enabled: Boolean(id),
    staleTime: POST_REF_STALE,
    gcTime: POST_REF_GC,
  };
}

/** Resolve a single post reference. Returns null until loaded / when no id. */
export function useResolvedPostRef(id: string | null | undefined, lang: Lang) {
  const q = useQuery(postRefQueryOptions(id ?? null, lang));
  return q.data ?? null;
}

/** Batch resolver - one query per id, dedup'd via React Query cache. */
export function useResolvedPostRefs(ids: ReadonlyArray<string | null | undefined>, lang: Lang) {
  const uniqueIds = Array.from(new Set(ids.filter((id): id is string => Boolean(id))));
  const results = useQueries({
    queries: uniqueIds.map((id) => postRefQueryOptions(id, lang)),
  });
  const map = new Map<string, PostRefData>();
  results.forEach((r, i) => {
    const id = uniqueIds[i];
    if (r.data) map.set(id, r.data);
  });
  return map;
}

/**
 * Merge a manually-edited widget item with a resolved post reference.
 * Rule: explicit non-empty user overrides win; otherwise live post data wins;
 * otherwise we fall back to whatever was previously saved.
 */
export function mergePostRefOverride<T extends Record<string, unknown>>(
  override: T,
  ref: PostRefData | null,
  map: {
    image?: keyof T;
    title?: keyof T;
    subtitle?: keyof T;
    href?: keyof T;
    author?: keyof T;
  },
): T {
  if (!ref) return override;
  const out = { ...override };
  const pick = (key: keyof T | undefined, live: string) => {
    if (!key) return;
    const current = out[key];
    if (typeof current !== "string" || current.trim() === "") {
      (out as Record<keyof T, unknown>)[key] = live as T[keyof T];
    }
  };
  pick(map.image, ref.cover);
  pick(map.title, ref.title);
  pick(map.subtitle, ref.excerpt);
  pick(map.href, ref.href);
  pick(map.author, ref.authorName);
  return out;
}

/** Invalidate every widget cache that consumes live entity refs. */
export const WIDGET_LIVE_QUERY_PREFIXES: ReadonlySet<string> = new Set([
  "post-ref",
  "page-ref",
  "category-ref",
  "tag-ref",
  "builder-slider-posts",
  "post-list",
  "news-ticker",
  "trending",
  "rated-list",
  "categories-widget",
  "tags-widget",
]);
