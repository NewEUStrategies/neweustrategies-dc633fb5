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
import { asNum, asStr } from "@/lib/content-model/contentValue";
import { WIDGET_QUERY_ROOTS } from "@/lib/builder/queryKeys";
import { edgeTtlCache } from "@/lib/ssrCache";

export interface SliderPostRow {
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

function getStr(c: WidgetContent, key: string): string {
  return asStr(c[key]);
}

function getNum(c: WidgetContent, key: string, fallback: number): number {
  return asNum(c[key], fallback);
}

function csv(c: WidgetContent, key: string): string[] {
  return getStr(c, key)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface SliderPostsInput {
  limit: number;
  categorySlugs: string[];
  tagSlugs: string[];
  excludeIds: string[];
  orderBy: string;
  /** Jezyk WCHODZI do inputu (a wiec i do klucza zapytania), bo przy
   *  orderBy="title" decyduje o kolumnie sortowania (title_pl vs title_en).
   *  Bez niego PL i EN dzielily jeden wpis cache: przelaczenie jezyka
   *  zwracalo liste posortowana po drugim jezyku. */
  lang: Lang;
}

/** The display limit a posts-mode slider renders. */
export function sliderPostsLimit(c: WidgetContent): number {
  return Math.max(1, Math.min(20, getNum(c, "limit", 5)));
}

/** Znormalizowany input - pochodna wylacznie tresci widgetu i jezyka. */
export function sliderPostsInput(c: WidgetContent, lang: Lang): SliderPostsInput {
  return {
    limit: sliderPostsLimit(c),
    // Bez `categoryId`: filtr po identyfikatorze kategorii nie miał AUTORA -
    // ani edytor slidera, ani import, ani szablony startowe nigdy go nie
    // zapisywały. Zapytanie płaciło za gałąź, której nie dało się włączyć,
    // a redakcja i tak filtruje po `categorySlugs` (czytelnych i edytowalnych).
    categorySlugs: csv(c, "categorySlugs"),
    tagSlugs: csv(c, "tagSlugs"),
    excludeIds: csv(c, "excludeIds"),
    orderBy: getStr(c, "orderBy") || "newest",
    lang,
  };
}

/** Kolumna sortowania slidera - czysta, wiec kontrakt jest testowalny bez bazy. */
export function sliderPostsOrderColumn(orderBy: string, lang: Lang): string {
  if (orderBy !== "title") return "published_at";
  return lang === "en" ? "title_en" : "title_pl";
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

async function fetchSliderPosts(input: SliderPostsInput): Promise<SliderPostRow[]> {
  const { limit, categorySlugs, tagSlugs, excludeIds, orderBy, lang } = input;
  let allowedIds: string[] | null = null;
  if (categorySlugs.length) {
    const { data } = await supabase
      .from("post_categories")
      .select("post_id, categories!inner(slug)")
      .in("categories.slug", categorySlugs);
    // Pierwszy filtr USTAWIA zbiór dozwolonych id (nie ma jeszcze czego przecinać).
    allowedIds = (data ?? []).map((r: { post_id: string }) => r.post_id);
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
    .select(
      "id, slug, title_pl, title_en, excerpt_pl, excerpt_en, cover_image_url, published_at, author_id",
    )
    .eq("status", "published");
  if (allowedIds) q = q.in("id", allowedIds);
  if (excludeIds.length) q = q.not("id", "in", `(${excludeIds.join(",")})`);
  const ascending = orderBy === "oldest";
  q = q.order(sliderPostsOrderColumn(orderBy, lang), { ascending });
  q = q.limit(limit);
  const { data } = await q;
  return (data ?? []) as SliderPostRow[];
}

export const sliderPostsQueryOptions = (c: WidgetContent, lang: Lang) => {
  const input = sliderPostsInput(c, lang);
  return queryOptions({
    // Korzeń klucza z WIDGET_QUERY_ROOTS - ten sam literał, z którego wyprowadzony
    // jest zbiór inwalidacji live, więc rozjazd nazw jest niewyrażalny.
    // `lang` jest CZĘŚCIĄ inputu: przy orderBy="title" queryFn sortuje po
    // title_pl vs title_en, więc klucz bez języka serwował PL-owi wynik
    // posortowany po EN (i odwrotnie) do końca okna świeżości.
    queryKey: [WIDGET_QUERY_ROOTS.sliderPosts, input] as const,
    queryFn: () =>
      // Per-isolate TTL: hero-slider strony głównej to do ~4 round-tripów na
      // render. Klucz cache pochodzi z całego inputu (zawiera już `lang`).
      edgeTtlCache(`builder:slider-posts:${JSON.stringify(input)}`, 60_000, () =>
        fetchSliderPosts(input),
      ),
    staleTime: 2 * 60_000,
    gcTime: 10 * 60_000,
  });
};
