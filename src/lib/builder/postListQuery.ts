import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { WidgetContent } from "@/lib/builder/types";
import { asBool, asNum, asOneOf, asStr } from "@/lib/content-model/contentValue";
import { authorDisplayMode, type AuthorDisplayMode } from "@/lib/builder/authorDisplay";
import { WIDGET_QUERY_ROOTS } from "@/lib/builder/queryKeys";
import { edgeTtlCache } from "@/lib/ssrCache";

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
  /** Resolved inside the query for variants that render a byline (see
   *  {@link POST_LIST_BYLINE_VARIANTS}), so author names ship with the SSR
   *  prefetch instead of popping in via a separate client-side query after
   *  hydration. */
  author_display_name?: string | null;
  /** Author avatar (5px rounded thumb) rendered by the ranked byline. */
  author_avatar_url?: string | null;
  /** Slug for linking the byline to the author profile page. */
  author_slug?: string | null;
}

/**
 * Sortowania oferowane przez edytor (PostListEditor.ORDER_BY) - lista MUSI byc
 * ich nadzbiorem. "created_at" bylo wczesniej cicho koercowane do
 * "published_at": ustawienie dawalo sie wybrac, a nie robilo nic (typowe
 * "wybralem, nic sie nie zmienilo").
 */
export const POST_LIST_ORDER_BY = [
  "published_at",
  "created_at",
  "title",
  "popular",
  "random",
] as const;
export type PostListOrderBy = (typeof POST_LIST_ORDER_BY)[number];

/**
 * Warianty post-listy, ktore RENDERUJA byline autora (PostListView: karta,
 * lista, klasyczny, flex-grid, boxed-*, overlay, minimal, ranked). Tylko dla
 * nich zapytanie doklada round-trip do `profiles_public`.
 *
 * "numbered" celowo POZA lista - ten wariant rysuje wylacznie indeks, tytul i
 * miniature, wiec pobieranie profili autorow bylo czystym marnotrawstwem.
 *
 * Eksportowane, zeby widok korzystal z TEJ SAMEJ listy zamiast utrzymywac
 * wlasna kopie - inaczej "wariant renderuje byline" i "zapytanie dociaga
 * autorow" rozjezdzaja sie bez zadnego sygnalu (byline renderowany z pustym
 * nazwiskiem = autor po prostu znika).
 */
export const POST_LIST_BYLINE_VARIANTS = [
  "card",
  "boxed-grid",
  "minimal",
  "overlay",
  "list",
  "boxed-list",
  "classic",
  "flex-grid",
  "ranked",
] as const;
export type PostListBylineVariant = (typeof POST_LIST_BYLINE_VARIANTS)[number];

const BYLINE_VARIANTS: ReadonlySet<string> = new Set<string>(POST_LIST_BYLINE_VARIANTS);

/** Czy dany wariant rysuje byline autora (patrz {@link POST_LIST_BYLINE_VARIANTS}). */
export function postListVariantHasByline(variant: string): boolean {
  return BYLINE_VARIANTS.has(variant);
}

/** Sposob prezentacji autora w post-liscie. */
export type PostListAuthorDisplay = AuthorDisplayMode;

/**
 * Rozstrzyga ustawienie "Autor" TYM SAMYM rezolwerem, ktorego uzywa widok i
 * panel wlasciwosci (`@/lib/builder/authorDisplay`). Wczesniej ta funkcja byla
 * druga, niezalezna kopia reguly - a "czy autor jest pokazywany" musi miec
 * dokladnie jedna definicje, inaczej zapytanie dociaga profile, ktorych widok
 * nie rysuje (albo odwrotnie: byline bez danych).
 */
export function postListAuthorDisplay(c: WidgetContent): PostListAuthorDisplay {
  return authorDisplayMode(c);
}

interface PostListInput {
  variant: string;
  /** Number of rows to FETCH. Over-fetched past the display limit when
   *  uniqueOnPage is set, so the client-side de-dup still fills the grid. */
  limit: number;
  offset: number;
  cols: number;
  orderByRaw: PostListOrderBy;
  orderDir: "asc" | "desc";
  /** Czy dociagac autorow (wariant z bylinem + wlaczona prezentacja autora).
   *  W kluczu, bo decyduje o ksztalcie zwracanych wierszy. */
  withAuthors: boolean;
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
  lang: Lang;
}

// Extra rows fetched when a widget opts into uniqueOnPage, so that after the
// client filters out posts already shown by earlier widgets there are still
// enough left to fill the display limit. Stable (content-derived), so it never
// changes the query key between server prefetch and client render.
const UNIQUE_FETCH_HEADROOM = 18;

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

/** Zawezenie do sortowan, ktore zapytanie faktycznie realizuje. */
function safeOrderBy(raw: unknown): PostListOrderBy {
  return asOneOf(raw, POST_LIST_ORDER_BY, "published_at");
}

/**
 * Kolumna `ORDER BY` dla danego sortowania. "random" i "popular" nie sortuja w
 * bazie (kolejnosc ustala sie po stronie klienta / rankingu RPC), wiec dostaja
 * stabilna kolumne bazowa. Czyste i eksportowane, zeby kontrakt sortowania byl
 * testowalny bez Supabase.
 */
export function postListOrderColumn(orderBy: PostListOrderBy, lang: Lang): string {
  if (orderBy === "title") return `title_${lang}`;
  if (orderBy === "random" || orderBy === "popular") return "published_at";
  return orderBy;
}

/** The display limit a post-list widget renders (before any over-fetch). */
export function postListDisplayLimit(c: WidgetContent): number {
  return Math.max(1, Math.min(100, getNum(c, "limit", 6)));
}

function wantsUniqueOnPage(c: WidgetContent): boolean {
  return asBool(c["uniqueOnPage"], false);
}

export function postListInput(c: WidgetContent, lang: Lang): PostListInput {
  const displayLimit = postListDisplayLimit(c);
  // Over-fetch when uniqueOnPage so the client-side de-dup (which removes posts
  // already shown by earlier widgets) can still fill the grid. The fetch size is
  // derived purely from content, so the query key stays identical between the
  // server prefetch and the client render - no refetch / skeleton flash.
  const fetchLimit = wantsUniqueOnPage(c)
    ? Math.min(100, displayLimit + UNIQUE_FETCH_HEADROOM)
    : displayLimit;
  const variant = getStr(c, "variant") || "card";
  return {
    variant,
    limit: fetchLimit,
    offset: Math.max(0, getNum(c, "offset", 0)),
    cols: Math.max(1, Math.min(6, getNum(c, "columns", 3))),
    orderByRaw: safeOrderBy(c["orderBy"]),
    orderDir: (getStr(c, "orderDir") || "desc") === "asc" ? "asc" : "desc",
    withAuthors: postListVariantHasByline(variant) && postListAuthorDisplay(c) !== "none",
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
    lang,
  };
}

/**
 * Pure de-dup + window for uniqueOnPage rendering: drop rows whose id is in
 * `excludeIds` (posts already shown by earlier widgets) and take the first
 * `displayLimit`. Exported so the ordering/uniqueness contract is unit-testable
 * without React or the database. Applied on the CLIENT over already-cached rows,
 * so it never triggers a network round-trip.
 */
export function dedupeAndSlice<T extends { id: string }>(
  rows: readonly T[],
  excludeIds: readonly string[],
  displayLimit: number,
): T[] {
  const exclude = new Set(excludeIds);
  const out: T[] = [];
  for (const row of rows) {
    if (exclude.has(row.id)) continue;
    out.push(row);
    if (out.length >= displayLimit) break;
  }
  return out;
}

async function fetchPostIdsBySlugs(
  table: "post_categories" | "post_tags",
  slugs: readonly string[],
): Promise<Set<string>> {
  if (!slugs.length) return new Set();
  if (table === "post_categories") {
    const { data: cats } = await supabase
      .from("categories")
      .select("id")
      .in("slug", [...slugs]);
    const ids = (cats ?? []).map((r: { id: string }) => r.id);
    if (!ids.length) return new Set();
    const { data: links } = await supabase
      .from("post_categories")
      .select("post_id")
      .in("category_id", ids);
    return new Set((links ?? []).map((r: { post_id: string }) => r.post_id));
  }
  const { data: tags } = await supabase
    .from("tags")
    .select("id")
    .in("slug", [...slugs]);
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
      (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.id) ?? Number.MAX_SAFE_INTEGER),
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
    ? includeSets
        .slice(1)
        .reduce(
          (acc, set) => new Set([...acc].filter((id) => set.has(id))),
          new Set(includeSets[0]),
        )
    : null;
  if (includeSet && includeSet.size === 0) return [];

  const excludeSet = new Set<string>([...excCatIds, ...excTagIds, ...input.excludeIds]);

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
    .select(
      "id, slug, title_pl, title_en, excerpt_pl, excerpt_en, cover_image_url, published_at, post_format, author_id",
    )
    .eq("status", "published")
    .is("deleted_at", null);

  if (input.postFormat) q = q.eq("post_format", input.postFormat);
  if (input.authorId) q = q.eq("author_id", input.authorId);
  if (input.dateFrom) q = q.gte("published_at", `${input.dateFrom}T00:00:00Z`);
  if (input.dateTo) q = q.lte("published_at", `${input.dateTo}T23:59:59Z`);
  if (includeSet) q = q.in("id", Array.from(includeSet));
  if (excludeSet.size) q = q.not("id", "in", `(${Array.from(excludeSet).join(",")})`);

  const orderCol = postListOrderColumn(effectiveOrderBy, input.lang);
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
  return attachAuthorNames(rows, input.withAuthors);
}

/**
 * Resolve author display names as part of the SAME query that fetches the
 * rows. posts.author_id references auth.users (not profiles), so PostgREST
 * cannot embed the profile in one select - but doing the lookup here means the
 * server-side widget prefetch covers bylines too: they render in the SSR HTML
 * instead of appearing after hydration (which read as "the page keeps
 * loading").
 *
 * Round-trip placi WYLACZNIE widget, ktory autora naprawde rysuje: wariant z
 * bylinem (POST_LIST_BYLINE_VARIANTS) i wlaczona prezentacja autora
 * (authorDisplay != "none"). Patrz `withAuthors` w PostListInput.
 */
async function attachAuthorNames(rows: PostRow[], withAuthors: boolean): Promise<PostRow[]> {
  if (!withAuthors || rows.length === 0) return rows;
  const authorIds = Array.from(
    new Set(rows.map((r) => r.author_id).filter((x): x is string => !!x)),
  );
  if (authorIds.length === 0) return rows;
  const { data: profs } = await supabase
    .from("profiles_public")
    .select("id, display_name, avatar_url, slug")
    .in("id", authorIds);
  const map = new Map(
    (
      (profs ?? []) as Array<{
        id: string;
        display_name: string | null;
        avatar_url: string | null;
        slug: string | null;
      }>
    ).map((p) => [p.id, p]),
  );
  // Wzbogacamy, nigdy nie kasujemy: gdy profil autora jest niedostepny (usuniety,
  // odciety przez RLS), zostawiamy to, co wiersz juz niesie, zamiast nadpisywac
  // nazwisko null-em i chowac byline, ktory mial czym sie wyrenderowac.
  return rows.map((r) => {
    const p = r.author_id ? map.get(r.author_id) : undefined;
    if (!p) return r;
    return {
      ...r,
      author_display_name: p.display_name ?? r.author_display_name ?? null,
      author_avatar_url: p.avatar_url ?? r.author_avatar_url ?? null,
      author_slug: p.slug ?? r.author_slug ?? null,
    };
  });
}

export const postListQueryOptions = (c: WidgetContent, lang: Lang) => {
  const input = postListInput(c, lang);
  return queryOptions({
    // Snapshot-independent key: identical between the server prefetch/stream gate
    // and the client render, so a streamed uniqueOnPage widget reuses the
    // dehydrated rows instead of refetching under a divergent key. uniqueOnPage
    // de-dup happens client-side via dedupeAndSlice, not in this key.
    queryKey: [WIDGET_QUERY_ROOTS.postList, input] as const,
    queryFn: () =>
      // Per-isolate TTL: pojedynczy widget post-list to wewnętrznie do ~7
      // round-tripów; chrome i strony builderowe prefetchują go na każdym
      // renderze. Wariant "random" celowo POZA cache - zamrożenie kolejności
      // na minutę zmieniłoby zachowanie widgetu (na kliencie przezroczyste).
      input.orderByRaw === "random"
        ? fetchPostListRows(input)
        : edgeTtlCache(`builder:post-list:${JSON.stringify(input)}`, 60_000, () =>
            fetchPostListRows(input),
          ),
    staleTime: 2 * 60_000,
    gcTime: 10 * 60_000,
  });
};
