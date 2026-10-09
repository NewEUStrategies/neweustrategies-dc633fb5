import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { WidgetContent } from "@/lib/builder/types";
import { asBool, asNum, asOneOf, asStr } from "@/lib/content-model/contentValue";
import { authorDisplayMode, type AuthorDisplayMode } from "@/lib/builder/authorDisplay";
import { WIDGET_QUERY_ROOTS } from "@/lib/builder/queryKeys";
import {
  postListRendersExcerpt,
  withoutExcerpts,
  type PostListSurface,
} from "@/lib/builder/postListExcerpt";
import { edgeTtlCache } from "@/lib/ssrCache";
import {
  postsConstrainedByTaxonomy,
  taxonomyConstraintsFromSlugs,
} from "@/lib/queries/taxonomyPivot";

export type Lang = "pl" | "en";

/**
 * Wiersz post-listy w cache. Pola językowe są OPCJONALNE, bo zapytanie oddaje
 * wiersz zrzutowany na język klucza (`localizePostListRows`): wiersz PL nie
 * niesie `title_en`/`excerpt_en`, wiersz EN - `title_pl`/`excerpt_pl`.
 */
export interface PostRow {
  id: string;
  slug: string;
  title_pl?: string | null;
  title_en?: string | null;
  excerpt_pl?: string | null;
  excerpt_en?: string | null;
  cover_image_url: string | null;
  published_at: string | null;
  post_format: string | null;
  author_id: string | null;
  /** Ujawnienie komercyjne dla oznaczenia pozycji listy (UPNPR art. 7 pkt 11a). */
  is_sponsored?: boolean | null;
  sponsored_kind?: string | null;
  sponsored_affiliate?: boolean | null;
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
  /** Czy widget RENDERUJE zajawkę (P3.7b, T2; `postListRendersExcerpt`). W kluczu,
   *  bo stan odwodniony widgetu bez zajawki jedzie bez `excerpt_*` (ścinanie na
   *  serwerze) i widget z zajawką nie może trafić w jego wpis; poza kluczem cache
   *  brzegowego (niżej). */
  withExcerpt: boolean;
}

/** Wejście pobrania wierszy: bez `withExcerpt`, więc widgety z różnym przełącznikiem
 *  dzielą jeden wpis `edgeTtlCache` (w cache brzegowym leży pełny wiersz). */
type PostListFetchInput = Omit<PostListInput, "withExcerpt">;

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

export function postListInput(
  c: WidgetContent,
  lang: Lang,
  surface: PostListSurface = "list",
): PostListInput {
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
    withExcerpt: postListRendersExcerpt(c, surface),
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

/**
 * Kolumny wiersza post-listy. Oznaczenie komercyjne jedzie z listą: obowiązek
 * dotyczy TAKŻE pozycji w zestawieniu (UPNPR art. 7 pkt 11a), a widget
 * `post-list` zasila strony główne budowane builderem - bez tych kolumn
 * sponsorowany materiał trafiałby tam bez żadnego wyróżnienia.
 */
const POST_LIST_COLUMNS =
  "id, slug, title_pl, title_en, excerpt_pl, excerpt_en, cover_image_url, published_at, post_format, author_id, is_sponsored, sponsored_kind, sponsored_affiliate";

async function fetchPostListRows(input: PostListFetchInput): Promise<PostRow[]> {
  // Ranking popularności nie zależy od taksonomii, więc RPC biegnie w TEJ SAMEJ
  // fali co odczyt słowników - jedna fala round-tripów mniej przed zapytaniem
  // o wpisy.
  const [constraints, ranked] = await Promise.all([
    // ZAWĘŻENIE TAKSONOMIĄ ROBI BAZA, NIE ADRES URL. Do 03.10.2026 stały tu
    // cztery odczyty tabel pośrednich bez `.limit()`, a pobrane identyfikatory
    // wpisów szły do `.in("id", ...)` (kategorie/tagi włączone) i do
    // `.not("id", "in", ...)` (wykluczone). Kategoria z kilkuset wpisami
    // w którymkolwiek polu przepełniała linię żądania i widget przestawał się
    // renderować. Teraz do bazy jadą identyfikatory TERMINÓW, a złączenie
    // (i anty-złączenie dla wykluczeń) liczy PostgREST - `lib/queries/taxonomyPivot.ts`.
    //
    // Błąd odczytu słownika RZUCA (widget wchodzi w stan błędu): połknięty
    // kasowałby wykluczenie i pokazywał wpisy, które redakcja wycięła.
    taxonomyConstraintsFromSlugs({
      includeCategories: input.includeCats,
      includeTags: input.includeTags,
      excludeCategories: input.excludeCats,
      excludeTags: input.excludeTags,
    }),
    // "popular" ranking comes from the tenant-scoped popular_post_ids RPC, which
    // aggregates post_views server-side behind a hard LIMIT - no full-table scan
    // of user_read_history. If the RPC is unavailable we degrade to recency
    // ordering (effectiveOrderBy) rather than rendering an empty widget.
    input.orderByRaw === "popular"
      ? fetchPopularPostIds(input.popularDays, input.orderDir)
      : Promise.resolve(null),
  ]);
  if (constraints === null) return [];

  // Lista `.in("id", ...)` niesie WYŁĄCZNIE identyfikatory ograniczone z góry:
  // jawne id wpisane w panelu i co najwyżej 200 kandydatów z rankingu.
  let idFilter: string[] | null = input.includeIds.length
    ? Array.from(new Set(input.includeIds))
    : null;

  let popularIds: string[] | null = null;
  let effectiveOrderBy: PostListFetchInput["orderByRaw"] = input.orderByRaw;
  if (input.orderByRaw === "popular") {
    if (ranked === null) {
      effectiveOrderBy = "published_at";
    } else if (ranked.length === 0) {
      return [];
    } else {
      popularIds = ranked;
      const popSet = new Set(ranked);
      idFilter = idFilter ? idFilter.filter((id) => popSet.has(id)) : ranked;
    }
  }
  if (idFilter && idFilter.length === 0) return [];

  let q = postsConstrainedByTaxonomy(POST_LIST_COLUMNS, constraints)
    .eq("status", "published")
    .is("deleted_at", null);

  if (input.postFormat) q = q.eq("post_format", input.postFormat);
  if (input.authorId) q = q.eq("author_id", input.authorId);
  if (input.dateFrom) q = q.gte("published_at", `${input.dateFrom}T00:00:00Z`);
  if (input.dateTo) q = q.lte("published_at", `${input.dateTo}T23:59:59Z`);
  if (idFilter) q = q.in("id", idFilter);
  if (input.excludeIds.length) {
    q = q.not("id", "in", `(${Array.from(new Set(input.excludeIds)).join(",")})`);
  }

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

/**
 * DIETA STANU ODWODNIONEGO (P2.5, HW-3b): wiersze zrzutowane na język klucza.
 *
 * Klucz post-listy zawiera `lang`, a widok (`PostListView`) czyta wyłącznie:
 * tytuł `(lang ? title_<lang>) || title_pl || title_en` i zajawkę
 * `excerpt_<lang>` BEZ zejścia na drugi język. Projekcja wpieka DOKŁADNIE ten
 * łańcuch w pole języka klucza i zdejmuje pola drugiego języka, więc widok
 * liczy z wiersza zrzutowanego ten sam tekst co z pełnego - a stan `$tsr`
 * strony PL nie niesie angielskich tytułów i zajawek (i odwrotnie).
 *
 * Zajawka NIE schodzi na drugi język (inaczej niż w sliderze): ogólne
 * „język z fallbackiem" zmieniłoby angielskie strony bez zajawki EN.
 * Projekcja żyje w `queryFn` (po cache brzegowym, w którym leży pełny wiersz),
 * więc SSR, hydratacja i refetch klienta mają ten sam kształt.
 */
export function localizePostListRows(rows: readonly PostRow[], lang: Lang): PostRow[] {
  return rows.map((row) => {
    const { title_pl, title_en, excerpt_pl, excerpt_en, ...rest } = row;
    return lang === "pl"
      ? { ...rest, title_pl: title_pl || title_en || null, excerpt_pl: excerpt_pl ?? null }
      : { ...rest, title_en: title_en || title_pl || null, excerpt_en: excerpt_en ?? null };
  });
}

/**
 * Opcje zapytania post-listy. `surface` jest WYMAGANE (P3.7b, T2): widget
 * `carousel` dzieli ten klucz z `post-list`, ale renderuje zajawkę w każdym
 * wariancie, więc każde miejsce wywołania musi powiedzieć, który widget czyta
 * wpis (powierzchnia albo `widget.type`) - inaczej klucz SSR i klucz widoku
 * rozjechałyby się (refetch po hydratacji) albo widok dostałby wiersze bez
 * zajawki, którą rysuje.
 */
export const postListQueryOptions = (c: WidgetContent, lang: Lang, surface: PostListSurface) => {
  const input = postListInput(c, lang, surface);
  const { withExcerpt, ...fetchInput } = input;
  return queryOptions({
    // Snapshot-independent key: identical between the server prefetch/stream gate
    // and the client render, so a streamed uniqueOnPage widget reuses the
    // dehydrated rows instead of refetching under a divergent key. uniqueOnPage
    // de-dup happens client-side via dedupeAndSlice, not in this key.
    queryKey: [WIDGET_QUERY_ROOTS.postList, input] as const,
    queryFn: async () => {
      const rows = localizePostListRows(
        // Per-isolate TTL: pojedynczy widget post-list to wewnętrznie do 5
        // zapytań w 3 falach (słowniki taksonomii + ranking, wpisy, autorzy);
        // chrome i strony builderowe prefetchują go na każdym
        // renderze. Wariant "random" celowo POZA cache - zamrożenie kolejności
        // na minutę zmieniłoby zachowanie widgetu (na kliencie przezroczyste).
        input.orderByRaw === "random"
          ? await fetchPostListRows(fetchInput)
          : await edgeTtlCache(`builder:post-list:${JSON.stringify(fetchInput)}`, 60_000, () =>
              fetchPostListRows(fetchInput),
            ),
        input.lang,
      );
      // ZAJAWKI TYLKO TAM, GDZIE WIDGET JE RENDERUJE (P3.7b, T2): stan odwodniony
      // widgetu, który zajawki nie rysuje, jedzie bez `excerpt_*`. Tylko serwer
      // (bramka wycina kod z bundla klienta); refetch klienta zostawia wiersz
      // pełny, a znacznik jest ten sam (`postListExcerpt.ts`).
      return import.meta.env.SSR && !withExcerpt ? withoutExcerpts(rows) : rows;
    },
    staleTime: 2 * 60_000,
    gcTime: 10 * 60_000,
  });
};
