// Warstwa danych widgetu „Lista oceniana / rankingowa" (`rated-list`)
// w trybie dynamicznym (`content.source === "dynamic"`).
//
// CO NAPRAWIA. Klucz i cały `queryFn` stały WPROST w `RatedListView.tsx`, więc
// rejestr prefetchu SSR (`prefetch.widgetQueryOptionsList`) tego typu nie
// widział i dla `rated-list` zwracał pustą listę. Skutki były dwa i oba ciche:
//   1. loader nie grzał ani jednego wpisu cache, więc serwer renderował siatkę
//      bez wierszy (`dynItems ?? []` - zero pozycji, same numery tła), a tytuły,
//      zajawki i byline doskakiwały po hydratacji i osobnym zapytaniu,
//   2. `shouldStreamSection` (sectionStreaming.tsx) bramkuje strumieniowanie na
//      NIEPUSTEJ liście zapytań sekcji - sekcja z samą listą ocenianą liczyła
//      się jako statyczna, więc `ServerSectionGate` nie miał na co czekać.
//
// `queryFn` JEST PRZENIESIONY, NIE SKOPIOWANY. Ciało zapytania (ok. 135 linii)
// zależało WYŁĄCZNIE od wartości wyliczonych z treści widgetu i z `lang` - zero
// stanu komponentu, zero refów, zero API przeglądarki - więc dało się je
// przenieść w całości. To najmocniejszy dostępny wariant: dwie kopie zapytania
// (jedna w widoku, jedna w rejestrze) rozjechałyby się przy pierwszej zmianie
// filtra, a rozjazd o JEDNĄ koercję daje rozgrzany wpis, w który widget nigdy
// nie trafia (SSR pusty, klient płaci drugie zapytanie, nic nie zgłasza błędu).
// Po przeniesieniu rozjazd jest strukturalnie niewyrażalny - jest jeden literał
// klucza i jedno ciało `queryFn`, po które sięgają obie strony. Dzięki temu
// bramka dryfu czytająca plik widoku (jak dla taksonomii i mediów) jest tu
// ZBĘDNA: sprawdzamy statycznie tylko to, że widok NADAL woła tę fabrykę,
// a nie że dwie kopie są identyczne.
//
// KOLEJNOŚĆ KLUCZY W OBIEKCIE KLUCZA - USTALONE, NIE ZGADNIĘTE.
// `@tanstack/query-core` 5.102.8, `src/utils.ts:223` (`hashKey`):
//   JSON.stringify(queryKey, (_, val) => isPlainObject(val)
//     ? Object.keys(val).sort().reduce(...)  // <- sortowanie kluczy
//     : val)
// czyli hash klucza SORTUJE klucze każdego zwykłego obiektu, więc kolejność
// pól w obiekcie wejścia NIE ma znaczenia dla trafienia w ten sam wpis cache.
// Znaczenie ma natomiast KOLEJNOŚĆ ELEMENTÓW TABLIC (`cats`, `tagSlugs`, ...):
// tablica nie przechodzi przez `isPlainObject`, więc `["a","b"]` i `["b","a"]`
// to dwa różne wpisy. Dlatego listy CSV liczy `csvList` - to samo wyrażenie,
// które miał widok - i nikt ich nie sortuje „po drodze". Kolejność pól obiektu
// zachowujemy identyczną jak w widoku wyłącznie dla czytelności diffu.
//
// TENANT / RLS: bez zmiany widoczności. Czytamy `posts`, `post_categories`,
// `post_tags` i widok `profiles_public` przez ten sam anonimowy klient
// (`@/integrations/supabase/client`), co widok - żadnego klienta serwisowego,
// żadnego `service_role`. Odcięcie robi RLS po `public_tenant_id()`, dokładnie
// jak w `postListQuery`.
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { asNum, asNumInRange, asOneOf, asStr } from "@/lib/content-model/contentValue";
import { WIDGET_QUERY_ROOTS } from "@/lib/builder/queryKeys";
import type { WidgetContent } from "@/lib/builder/types";

export type Lang = "pl" | "en";

/**
 * Świeżość listy dynamicznej. Ta sama wartość, co `postListQuery` - to ta sama
 * klasa danych (opublikowane wpisy), więc rozjazd TTL-i byłby zaskoczeniem.
 * Wartość MUSI zostać jawna: przy `undefined` `widgetCacheTargets` raportowało
 * by zero, a wtedy bramka SWR `useSectionPreload.isSectionFresh` uznaje sekcję
 * za przestarzałą po KAŻDYM renderze i grzeje ją w kółko.
 */
export const RATED_LIST_STALE_MS = 2 * 60_000;

/**
 * Kolumny wpisu. Eksportowane, bo `sectionPrefetch.test.ts` przypina literał:
 * zmiana kształtu wiersza zmienia to, co prefetch SSR wpisuje do cache, a widok
 * czyta ten wpis bez żadnej walidacji.
 */
export const RATED_LIST_POST_COLUMNS =
  "id, slug, title_pl, title_en, excerpt_pl, excerpt_en, published_at, post_format, author_id";

/** Kolumny publicznej projekcji profilu (`profiles_public`). */
export const RATED_LIST_PROFILE_COLUMNS = "id, display_name, avatar_url";

const ORDER_BY = ["last_published", "title_asc", "title_desc", "random"] as const;
const SOURCES = ["manual", "dynamic"] as const;

export type RatedListOrderBy = (typeof ORDER_BY)[number];

/**
 * Pozycja listy. Kształt WSPÓLNY dla trybu ręcznego (mapowanie `content.items`
 * w widoku) i dynamicznego (wynik `queryFn`) - widok renderuje jedną pętlę.
 */
export interface RatedListItem {
  title: string;
  excerpt: string;
  author: string;
  authorAvatar?: string;
  authorHref?: string;
  rating: number;
  href?: string;
  category?: string;
  date?: string;
  format?: string;
}

/** Wiersz `posts` w kształcie, który wpada do cache. */
interface PostRow {
  id: string;
  slug: string;
  title_pl: string;
  title_en: string;
  excerpt_pl: string | null;
  excerpt_en: string | null;
  published_at: string | null;
  post_format: string | null;
  author_id: string | null;
}

/** Publiczna projekcja profilu (`profiles_public`) - `id` bywa nullowalne w typach widoku. */
interface ProfileRow {
  id: string | null;
  display_name: string | null;
  avatar_url: string | null;
}

/**
 * Wejście zapytania - DOKŁADNIE to, co ląduje w drugim elemencie klucza.
 * Pola w tej samej kolejności, w jakiej stały w widoku (dla hasha nieistotnej -
 * patrz nagłówek - ale diff czyta człowiek).
 */
export interface RatedListInput {
  lang: Lang;
  cats: string[];
  excludeCats: string[];
  tagSlugs: string[];
  excludeTagSlugs: string[];
  postFormat: string;
  authors: string[];
  postIds: string[];
  excludePostIds: string[];
  orderBy: RatedListOrderBy;
  limit: number;
  offset: number;
}

/**
 * Lista z pola CSV. Kopia lokalnego `csv` z widoku (`asStr` -> split "," ->
 * trim -> odrzucenie pustych). Kolejność elementów JEST częścią klucza, więc
 * nie wolno tu niczego sortować ani deduplikować „przy okazji".
 */
function csvList(c: WidgetContent, key: string): string[] {
  return asStr(c[key])
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Czy widget czyta wpisy z bazy, a nie ręczne pozycje z panelu. Mirror bramki
 * `enabled: source === "dynamic"` z widoku - i JEDYNE miejsce, w którym ta
 * decyzja jest liczona (widok woła tę samą funkcję, więc nie ma drugiego
 * wyrażenia, które mogłoby się rozjechać). Tryb `manual` nie ma żadnego
 * zapytania, więc nie wolno go zgłaszać jako sekcji z danymi: `pricing`
 * w trybie ręcznym rozstrzygnięto identycznie (`pricingUsesPlansSource`).
 */
export function ratedListUsesDynamicSource(c: WidgetContent): boolean {
  return asOneOf(c.source, SOURCES, "manual") === "dynamic";
}

/**
 * Wejście klucza z treści widgetu. Każde wyrażenie jest tym samym wyrażeniem,
 * które liczył widok - `asStr`/`asNum`/`asNumInRange`/`asOneOf` z tego samego
 * wspólnego modułu `@/lib/content-model/contentValue`, te same wartości
 * domyślne i te same klamry.
 */
export function ratedListInput(c: WidgetContent, lang: Lang): RatedListInput {
  return {
    lang,
    cats: csvList(c, "categoriesFilter"),
    excludeCats: csvList(c, "excludeCategories"),
    tagSlugs: csvList(c, "tagsFilter"),
    excludeTagSlugs: csvList(c, "excludeTags"),
    postFormat: asStr(c.postFormatFilter),
    authors: csvList(c, "authorFilter"),
    postIds: csvList(c, "postIdsFilter"),
    excludePostIds: csvList(c, "excludePostIds"),
    orderBy: asOneOf(c.orderBy, ORDER_BY, "last_published"),
    limit: asNumInRange(c.numberOfPosts, 4, 1, 50),
    offset: Math.max(0, asNum(c.postOffset, 0)),
  };
}

/**
 * Wiersze listy dynamicznej.
 *
 * Ciało przeniesione z `RatedListView.tsx` bez zmiany semantyki. Wpieka
 * ZLOKALIZOWANY tytuł i zajawkę w cache'owane pozycje i sortuje po
 * `title_${lang}`, dlatego `lang` MUSI być w kluczu (patrz
 * `localizedQueryKeys.gate.test.ts` - fabryka nie jest na liście `LANG_FREE`).
 */
async function fetchRatedListItems(input: RatedListInput): Promise<RatedListItem[]> {
  const {
    lang,
    cats,
    excludeCats,
    tagSlugs,
    excludeTagSlugs,
    postFormat,
    authors,
    postIds,
    excludePostIds,
    orderBy,
    limit,
    offset,
  } = input;

  const resolveByCategory = async (slugs: string[]) => {
    if (!slugs.length) return null;
    const { data } = await supabase
      .from("post_categories")
      .select("post_id, categories!inner(slug)")
      .in("categories.slug", slugs);
    return new Set((data ?? []).map((r: { post_id: string }) => r.post_id));
  };
  const resolveByTag = async (slugs: string[]) => {
    if (!slugs.length) return null;
    const { data } = await supabase
      .from("post_tags")
      .select("post_id, tags!inner(slug)")
      .in("tags.slug", slugs);
    return new Set((data ?? []).map((r: { post_id: string }) => r.post_id));
  };

  const [incCat, excCat, incTag, excTag] = await Promise.all([
    resolveByCategory(cats),
    resolveByCategory(excludeCats),
    resolveByTag(tagSlugs),
    resolveByTag(excludeTagSlugs),
  ]);

  // Filtr autora MUSI zawezic zapytanie, a nie jego wynik. Filtrowanie po
  // stronie klienta dzialo sie PO `.range(offset, offset+limit-1)`, wiec
  // widget oddawal mniej wierszy niz `numberOfPosts` (a przy autorze spoza
  // pierwszej strony - zero). Rozwiazujemy nazwy na identyfikatory i
  // wkladamy je do zapytania o wpisy. Trzymamy tez avatar_url, zeby
  // renderowac spojny byline (12 px / 20 px) zamiast samego tekstu.
  //
  // IZOLACJA NAJEMCY: `profiles_public` zamiast tabeli `profiles`. Widok
  // zawezony do `public_tenant_id()` wystawia wylacznie kolumny publiczne,
  // wiec filtr "autor o nazwie X" nie ma jak trafic w profil z obszaru
  // roboczego innej firmy (ani ujawnic, ze taki profil istnieje).
  const authorById = new Map<string, ProfileRow>();
  let authorIdFilter: string[] | null = null;
  if (authors.length) {
    const { data: matched } = await supabase
      .from("profiles_public")
      .select(RATED_LIST_PROFILE_COLUMNS)
      .in("display_name", authors);
    // Widok publiczny typuje `id` jako nullowalne - zawezamy raz, zeby
    // dalsza czesc zapytania pracowala na pewnych identyfikatorach.
    const matchedRows = ((matched ?? []) as ProfileRow[]).filter(
      (row): row is ProfileRow & { id: string } => !!row.id,
    );
    for (const p of matchedRows) {
      if (p.display_name) authorById.set(p.id, p);
    }
    authorIdFilter = matchedRows.map((p) => p.id);
    // Zaden profil o takiej nazwie = pusty wynik. Bez tego `.in()` z pusta
    // lista i tak nie zwrocilby nic, ale oszczedzamy round-trip.
    if (authorIdFilter.length === 0) return [];
  }

  let q = supabase.from("posts").select(RATED_LIST_POST_COLUMNS).eq("status", "published");

  if (postFormat && postFormat !== "all") q = q.eq("post_format", postFormat);
  if (postIds.length) q = q.in("id", postIds);
  if (authorIdFilter) q = q.in("author_id", authorIdFilter);

  const includeIds = new Set<string>();
  let haveInclude = false;
  if (incCat) {
    haveInclude = true;
    incCat.forEach((id) => includeIds.add(id));
  }
  if (incTag) {
    if (haveInclude) {
      for (const id of Array.from(includeIds)) if (!incTag.has(id)) includeIds.delete(id);
    } else {
      haveInclude = true;
      incTag.forEach((id) => includeIds.add(id));
    }
  }
  if (haveInclude) {
    if (includeIds.size === 0) return [];
    q = q.in("id", Array.from(includeIds));
  }

  const excludeIds = new Set<string>([...excludePostIds]);
  excCat?.forEach((id) => excludeIds.add(id));
  excTag?.forEach((id) => excludeIds.add(id));
  if (excludeIds.size) q = q.not("id", "in", `(${Array.from(excludeIds).join(",")})`);

  if (orderBy === "title_asc")
    q = q.order(lang === "pl" ? "title_pl" : "title_en", { ascending: true });
  else if (orderBy === "title_desc")
    q = q.order(lang === "pl" ? "title_pl" : "title_en", { ascending: false });
  else q = q.order("published_at", { ascending: false });

  const from = offset;
  const to = from + limit - 1;
  q = q.range(from, to);

  const { data } = await q;
  let rows = (data ?? []) as PostRow[];

  const missingAuthorIds = Array.from(
    new Set(rows.map((r) => r.author_id).filter((x): x is string => !!x)),
  ).filter((id) => !authorById.has(id));
  if (missingAuthorIds.length) {
    const { data: profs } = await supabase
      .from("profiles_public")
      .select(RATED_LIST_PROFILE_COLUMNS)
      .in("id", missingAuthorIds);
    for (const p of (profs ?? []) as ProfileRow[]) {
      if (p.id && p.display_name) authorById.set(p.id, p);
    }
  }
  if (orderBy === "random") rows = [...rows].sort(() => Math.random() - 0.5);

  return rows.map((r) => {
    const profile = r.author_id ? authorById.get(r.author_id) : undefined;
    return {
      title: (lang === "pl" ? r.title_pl : r.title_en) || r.title_pl,
      excerpt: (lang === "pl" ? r.excerpt_pl : r.excerpt_en) || r.excerpt_pl || "",
      author: profile?.display_name || "",
      authorAvatar: profile?.avatar_url || undefined,
      authorHref: `/post/${r.slug}`,
      // Wpisy nie maja oceny w bazie - patrz `showRating` w widoku.
      rating: 0,
      href: `/post/${r.slug}`,
      date: r.published_at || "",
      format: r.post_format || "standard",
    };
  });
}

/**
 * JEDNE `queryOptions` czytane i przez widok, i przez rejestr prefetchu SSR.
 *
 * `lang` NALEŻY do klucza: `queryFn` sortuje po `title_${lang}` i wpieka
 * zlokalizowany tytuł/zajawkę w cache'owane wiersze. Bez języka w kluczu
 * przełączenie PL/EN oddawało poprzedni język aż do wygaśnięcia świeżości
 * (regresja przypięta w `widget-view/__tests__/ratedListRegressions.test.tsx`).
 *
 * Bez `throw` na błędzie - dokładnie jak w widoku: pusta lista jest poprawnym
 * stanem, a rzucenie zamieniłoby brak wpisów w błąd całej sekcji.
 */
export function ratedListQueryOptions(c: WidgetContent, lang: Lang) {
  const input = ratedListInput(c, lang);
  return queryOptions({
    // Korzeń z WIDGET_QUERY_ROOTS - ten sam literał zasila zbiór inwalidacji
    // live (LIVE_INVALIDATED_ROOTS), więc publikacja wpisu odświeża ten widget.
    queryKey: [WIDGET_QUERY_ROOTS.ratedList, input] as const,
    staleTime: RATED_LIST_STALE_MS,
    queryFn: (): Promise<RatedListItem[]> => fetchRatedListItems(input),
  });
}
