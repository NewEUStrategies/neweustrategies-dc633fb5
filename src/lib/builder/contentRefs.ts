// Live content reference resolvers for builder widgets.
// Any widget that points at a post/page/category/tag should run its display
// data through these hooks so editing the source entity propagates instantly
// (covers, titles, excerpts, hrefs, taxonomy labels) without duplicating
// payload in widget JSON.
//
// Cache keys are stable + lang-scoped so a single invalidate({ queryKey:
// ["post-ref"] }) refreshes every widget on the page.

import { useQueries } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { edgeTtlCache } from "@/lib/ssrCache";

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
  authorAvatar: string;
  authorSlug: string;
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

interface AuthorInfo {
  name: string;
  avatar: string;
  slug: string;
}

const EMPTY_AUTHOR: AuthorInfo = { name: "", avatar: "", slug: "" };

async function fetchAuthorInfo(id: string | null): Promise<AuthorInfo> {
  if (!id) return EMPTY_AUTHOR;
  // profiles_public: publiczna projekcja profilu (ta sama, którą czyta cała
  // powierzchnia publiczna) zamiast pełnej tabeli `profiles` - lżejszy wiersz,
  // spójny kontrakt widoczności.
  const { data } = await supabase
    .from("profiles_public")
    .select("display_name, avatar_url, slug")
    .eq("id", id)
    .maybeSingle();
  const row = data as {
    display_name: string | null;
    avatar_url: string | null;
    slug: string | null;
  } | null;
  return {
    name: row?.display_name ?? "",
    avatar: row?.avatar_url ?? "",
    slug: row?.slug ?? "",
  };
}

/** Wpis + autor jednym pakietem (niezależnym od języka - mapowanie na wariant
 *  PL/EN robi `toPostRef` po odczycie, więc oba języki dzielą jeden wpis TTL). */
interface PostRefBundle {
  row: RawPostRow | null;
  author: AuthorInfo;
}

/**
 * Referencja wpisu JEDNYM round-tripem: RPC `get_post_refs` (migracja
 * 20260724151000, join wpis + publiczny profil autora w bazie). Wcześniej
 * każdy referowany wpis slidera kosztował dwa SEKWENCYJNE round-tripy
 * (wpis -> autor). Fallback dwuetapowy zostaje na okno wdrożeniowe migracji;
 * całość za edgeTtlCache per tenant host (klucz per id, wspólny dla języków).
 */
async function fetchPostRefBundle(id: string): Promise<PostRefBundle> {
  return edgeTtlCache(
    `builder:post-ref:${id}`,
    POST_REF_STALE,
    async (): Promise<PostRefBundle> => {
      // Cast przez `unknown`: wygenerowane typy Supabase nie znają jeszcze
      // funkcji z migracji 20260724151000 (regeneracja typów po jej wdrożeniu).
      const { data, error } = await (
        supabase.rpc as unknown as (
          fn: string,
          args: { _post_ids: string[] },
        ) => PromiseLike<{ data: unknown; error: { message: string } | null }>
      )("get_post_refs", { _post_ids: [id] });
      if (!error && Array.isArray(data)) {
        const row = (data[0] ?? null) as
          | (RawPostRow & {
              author_name: string | null;
              author_avatar: string | null;
              author_slug: string | null;
            })
          | null;
        if (!row) return { row: null, author: EMPTY_AUTHOR };
        return {
          row,
          author: {
            name: row.author_name ?? "",
            avatar: row.author_avatar ?? "",
            slug: row.author_slug ?? "",
          },
        };
      }
      const row = await fetchPostRef(id);
      const author = await fetchAuthorInfo(row?.author_id ?? null);
      return { row, author };
    },
  );
}

function toPostRef(row: RawPostRow | null, author: AuthorInfo, lang: Lang): PostRefData | null {
  if (!row) return null;
  const title = (lang === "en" ? row.title_en : row.title_pl) ?? row.title_pl ?? row.title_en ?? "";
  const excerpt =
    (lang === "en" ? row.excerpt_en : row.excerpt_pl) ?? row.excerpt_pl ?? row.excerpt_en ?? "";
  return {
    id: row.id,
    slug: row.slug,
    title: title ?? "",
    excerpt: excerpt ?? "",
    cover: row.cover_image_url ?? "",
    href: `/post/${row.slug}`,
    publishedAt: row.published_at,
    authorName: author.name,
    authorAvatar: author.avatar,
    authorSlug: author.slug,
  };
}

export function postRefQueryOptions(id: string | null | undefined, lang: Lang) {
  return {
    queryKey: ["post-ref", id ?? "", lang] as const,
    queryFn: async (): Promise<PostRefData | null> => {
      if (!id) return null;
      const bundle = await fetchPostRefBundle(id);
      return toPostRef(bundle.row, bundle.author, lang);
    },
    enabled: Boolean(id),
    staleTime: POST_REF_STALE,
    gcTime: POST_REF_GC,
  };
}

/** Batch resolver - one query per id, dedup'd before useQueries receives keys. */
export function useResolvedPostRefs(ids: ReadonlyArray<string | null | undefined>, lang: Lang) {
  const seen = new Set<string>();
  const uniqueIds = ids.reduce<string[]>((acc, id) => {
    if (typeof id !== "string") return acc;
    const normalized = id.trim();
    if (!normalized || seen.has(normalized)) return acc;
    seen.add(normalized);
    acc.push(normalized);
    return acc;
  }, []);
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
 * Invalidate every widget cache that consumes live entity refs.
 *
 * Re-exported from `queryKeys.ts`, which derives the set from the SAME string
 * constants the query modules use in their `queryKey`. Maintaining the list by
 * hand here previously let it drift: five roots ("post-list", "news-ticker",
 * "rated-list", "categories-widget", "tags-widget") matched no live query, so
 * realtime invalidation silently skipped those widgets.
 */
export { WIDGET_LIVE_QUERY_PREFIXES } from "./queryKeys";
