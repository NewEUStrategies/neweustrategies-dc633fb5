// Posts-sourced slider widget query - the single source of truth shared by the
// public renderer (PostsSliderWidget) and the SSR prefetch/streaming gate
// (lib/builder/prefetch). Before this module existed the queryFn lived inline
// in the widget component, so the server-side prefetch registry could not see
// it: the slider was server-rendered as its empty state and only filled in
// after client hydration fetched the posts - the most visible "content pops in
// late" element on the homepage.
import { queryOptions } from "@tanstack/react-query";
import type { WidgetContent } from "@/lib/builder/types";
import type { Lang } from "@/lib/builder/postListQuery";
import { asBool, asNum, asStr } from "@/lib/content-model/contentValue";
import { WIDGET_QUERY_ROOTS } from "@/lib/builder/queryKeys";
import { withoutExcerpts } from "@/lib/builder/postListExcerpt";
import { edgeTtlCache } from "@/lib/ssrCache";
import {
  postsConstrainedByTaxonomy,
  taxonomyConstraintsFromSlugs,
} from "@/lib/queries/taxonomyPivot";

/**
 * Wiersz slidera w cache. Pola językowe są OPCJONALNE, bo zapytanie oddaje
 * wiersz zrzutowany na język klucza (`localizeSliderPostRows`).
 */
export interface SliderPostRow {
  id: string;
  slug: string;
  title_pl?: string | null;
  title_en?: string | null;
  excerpt_pl?: string | null;
  excerpt_en?: string | null;
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
  /** Czy slider RENDERUJE zajawkę (P3.7b, T2; `sliderShowsExcerpt`). W kluczu, bo
   *  stan odwodniony slidera bez zajawki jedzie bez `excerpt_*` (ścinanie na
   *  serwerze); poza kluczem cache brzegowego. */
  withExcerpt: boolean;
}

/** Wejście pobrania wierszy: bez `withExcerpt` (jeden wpis `edgeTtlCache` dla obu przełączników). */
type SliderPostsFetchInput = Omit<SliderPostsInput, "withExcerpt">;

/**
 * Czy slider wpisów renderuje zajawkę - DOKŁADNIE przełącznik widoku
 * (`PostsSliderWidget`: `asBool(c.showExcerpt, true)`), który czyta stąd.
 */
export function sliderShowsExcerpt(c: WidgetContent): boolean {
  return asBool(c.showExcerpt, true);
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
    withExcerpt: sliderShowsExcerpt(c),
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

/** Kolumny wiersza slidera - jeden literał dla zapytania i typu wiersza. */
const SLIDER_POST_COLUMNS =
  "id, slug, title_pl, title_en, excerpt_pl, excerpt_en, cover_image_url, published_at, author_id";

async function fetchSliderPosts(input: SliderPostsFetchInput): Promise<SliderPostRow[]> {
  const { limit, categorySlugs, tagSlugs, excludeIds, orderBy, lang } = input;
  // Zawężenie kategorią i tagiem robi BAZA (osadzenia `!inner()` po
  // identyfikatorach terminów) - wcześniej stał tu odczyt całej tabeli
  // pośredniej bez `.limit()`, a identyfikatory wpisów szły do `.in("id", ...)`,
  // więc kategoria z kilkuset wpisami przepełniała linię żądania i slider
  // przestawał się renderować. Szczegóły: `lib/queries/taxonomyPivot.ts`.
  //
  // Polityka błędów slidera bez zmian: odmowa odczytu słownika daje pusty
  // slider, a nie błąd sekcji (tak samo kończyło się to przed zmianą).
  const constraints = await taxonomyConstraintsFromSlugs({
    includeCategories: categorySlugs,
    includeTags: tagSlugs,
  }).catch((): null => null);
  if (constraints === null) return [];
  let q = postsConstrainedByTaxonomy(SLIDER_POST_COLUMNS, constraints).eq("status", "published");
  if (excludeIds.length) q = q.not("id", "in", `(${excludeIds.join(",")})`);
  const ascending = orderBy === "oldest";
  q = q.order(sliderPostsOrderColumn(orderBy, lang), { ascending });
  q = q.limit(limit);
  const { data } = await q;
  return (data ?? []) as SliderPostRow[];
}

/**
 * DIETA STANU ODWODNIONEGO (P2.5, HW-3b): wiersze slidera zrzutowane na język
 * klucza.
 *
 * Łańcuch fallbacków jest KOPIĄ widoku, nie ogólną regułą: `PostsSliderWidget`
 * buduje slajd z `title_pl ?? ""`, `title_en ?? title_pl ?? ""` (zajawki tak
 * samo), a `SliderRender` wybiera tekst przez `pickI18n` (żądany język -> PL ->
 * EN). Dla tytułu i zajawki daje to `<lang> || <drugi> || ""` - w sliderze
 * zajawka SCHODZI na drugi język (w post-liście nie). Projekcja wpieka ten
 * wynik w pole języka klucza i zdejmuje pola drugiego języka, więc slajd z
 * wiersza zrzutowanego ma ten sam tytuł i zajawkę co z pełnego.
 */
export function localizeSliderPostRows(
  rows: readonly SliderPostRow[],
  lang: Lang,
): SliderPostRow[] {
  return rows.map((row) => {
    const { title_pl, title_en, excerpt_pl, excerpt_en, ...rest } = row;
    return lang === "pl"
      ? {
          ...rest,
          title_pl: title_pl || title_en || null,
          excerpt_pl: excerpt_pl || excerpt_en || null,
        }
      : {
          ...rest,
          title_en: title_en || title_pl || null,
          excerpt_en: excerpt_en || excerpt_pl || null,
        };
  });
}

export const sliderPostsQueryOptions = (c: WidgetContent, lang: Lang) => {
  const input = sliderPostsInput(c, lang);
  const { withExcerpt, ...fetchInput } = input;
  return queryOptions({
    // Korzeń klucza z WIDGET_QUERY_ROOTS - ten sam literał, z którego wyprowadzony
    // jest zbiór inwalidacji live, więc rozjazd nazw jest niewyrażalny.
    // `lang` jest CZĘŚCIĄ inputu: przy orderBy="title" queryFn sortuje po
    // title_pl vs title_en, więc klucz bez języka serwował PL-owi wynik
    // posortowany po EN (i odwrotnie) do końca okna świeżości. Od P2.5 język
    // klucza decyduje też o KSZTAŁCIE wiersza (`localizeSliderPostRows`).
    queryKey: [WIDGET_QUERY_ROOTS.sliderPosts, input] as const,
    queryFn: async () => {
      const rows = localizeSliderPostRows(
        // Per-isolate TTL: hero-slider strony głównej to do 3 zapytań w 2 falach na
        // render. Klucz cache pochodzi z całego inputu (zawiera już `lang`); w
        // cache brzegowym leży pełny wiersz, projekcja idzie po nim.
        await edgeTtlCache(`builder:slider-posts:${JSON.stringify(fetchInput)}`, 60_000, () =>
          fetchSliderPosts(fetchInput),
        ),
        input.lang,
      );
      // Slider z wyłączoną zajawką (P3.7b, T2): stan odwodniony bez `excerpt_*`,
      // ścinany WYŁĄCZNIE na serwerze (`postListExcerpt.ts`). Widok buduje wtedy
      // pusty podtytuł bez względu na treść wiersza, więc pełny wiersz po refetchu
      // klienta daje ten sam znacznik.
      return import.meta.env.SSR && !withExcerpt ? withoutExcerpts(rows) : rows;
    },
    staleTime: 2 * 60_000,
    gcTime: 10 * 60_000,
  });
};
