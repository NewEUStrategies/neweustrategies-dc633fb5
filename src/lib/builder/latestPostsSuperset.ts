// NADZBIÓR NAJNOWSZYCH WPISÓW - jeden odczyt `posts` i jeden `profiles_public`
// na render SSR dla wszystkich widgetów „najnowsze opublikowane bez filtrów".
//
// DLACZEGO. Produkcja stoi na Workers-for-Platforms: niemal każde żądanie
// trafia na ZIMNY izolat z pustym `edgeTtlCache`, Supabase jest w eu-west-1,
// a Worker ma tylko 6 równoległych połączeń wychodzących. Strona główna miała
// nad zgięciem ~8 round-tripów do `posts` (dwie karty post-listy, hero-slider,
// lista `ranked`, okładki-fallbacki slidera, kolejne listy niżej) - każdy pod
// WŁASNYM kluczem cache, choć wszystkie pytały o to samo: najnowsze
// opublikowane wpisy, tylko w innym oknie. Post-listy z bylinem dokładały do
// tego SZEREGOWY odczyt `profiles_public`, a autorzy slajdów jeszcze jeden.
// `ServerSectionGate` czeka na KAŻDE zapytanie sekcji, więc hero kończył się
// ~700 ms po treści strony: bramkę wyznaczał najwolniejszy sąsiad w kolejce
// do sześciu połączeń, a Speed Index liczy właśnie ten czas odpowiedzi.
//
// JAK. Widget bez filtrów, sortujący po `published_at` malejąco, którego okno
// (offset + limit) mieści się w pojemności nadzbioru, czyta wycinek JEDNEGO
// memoizowanego odczytu 20 najnowszych wpisów (kolumny = suma kolumn
// post-listy i slidera), a byline - z JEDNEGO memoizowanego odczytu profili
// wszystkich autorów nadzbioru. Klucze react-query i klucze `edgeTtlCache`
// widgetów zostają bez zmian: owijają teraz szybszy fetcher.
//
// DLACZEGO TO JEST DOKŁADNE, A NIE PRZYBLIŻONE. Nadzbiór to prefiks TEJ SAMEJ
// kolejności (`status = published`, `deleted_at IS NULL`, `published_at`
// malejąco), o którą pytałby widget. Okno mieszczące się w pojemności jest więc
// wycinkiem prefiksu; gdy nadzbiór wrócił krótszy niż pojemność, zawiera
// WSZYSTKIE opublikowane wpisy i wycinek jest dokładny także za jego końcem.
// Slider nie filtruje `deleted_at` jawnie, ale SSR czyta zawsze jako anon,
// a polityka „Public reads published posts" (20260625160054) wymaga
// `deleted_at IS NULL` - wynik jest identyczny.
//
// TYLKO SERWER. Wołający bramkują ścieżkę `import.meta.env.SSR && typeof
// window === "undefined"` (stała Vite pierwsza, więc gałąź i ten moduł znikają
// z bundla klienta). Przeglądarka pyta jak dotąd - tam nie ma ani zimnego
// izolatu, ani limitu połączeń Workera, a refetch po inwalidacji live ma trafić
// w wiersze jednego widgetu. Każdy filtr, inne sortowanie albo okno poza
// pojemnością = dotychczasowe zapytanie widgetu bez żadnej zmiany; błąd odczytu
// nadzbioru też (awaria wygląda wtedy dokładnie tak, jak przed tą zmianą).
import { supabase } from "@/integrations/supabase/client";
import { edgeTtlCache, peekEdgeTtlCache } from "@/lib/ssrCache";

/**
 * Pojemność nadzbioru. 20 = sufit `limit` slidera (`sliderPostsLimit`), więc
 * każdy slider bez filtrów mieści się zawsze; post-lista (limit do 100) - gdy
 * offset + limit <= 20, czyli w każdym układzie strony głównej.
 */
export const LATEST_POSTS_SUPERSET_LIMIT = 20;

/** TTL obu odczytów - ten sam co kluczy widgetów, które je owijają. */
const LATEST_POSTS_SUPERSET_TTL_MS = 60_000;

const LATEST_POSTS_SUPERSET_KEY = "builder:latest-posts:v1";

/**
 * DOKŁADNA suma `POST_LIST_COLUMNS` (postListQuery.ts) i `SLIDER_POST_COLUMNS`
 * (sliderPostsQuery.ts) - kolumny slidera są podzbiorem kolumn post-listy
 * (test `latestPostsSuperset.test.ts` pilnuje równości zbiorów). Literał, nie
 * złożenie: bramka kontraktu TS <-> SQL czyta `select` wprost.
 */
export const LATEST_POSTS_SUPERSET_COLUMNS =
  "id, slug, title_pl, title_en, excerpt_pl, excerpt_en, cover_image_url, published_at, post_format, author_id, is_sponsored, sponsored_kind, sponsored_affiliate";

/** Suma kolumn `profiles_public`, które czytają `attachAuthorNames` i `fetchSliderAuthors`. */
const LATEST_SUPERSET_AUTHOR_COLUMNS = "id, display_name, first_name, last_name, avatar_url, slug";

/** Wiersz nadzbioru: pełny wiersz bazy w kolumnach `LATEST_POSTS_SUPERSET_COLUMNS`. */
export type LatestPostRow = {
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
  is_sponsored: boolean | null;
  sponsored_kind: string | null;
  sponsored_affiliate: boolean | null;
};

/** Profil autora nadzbioru (suma kolumn obu bylinów). */
export type LatestSupersetAuthorRow = {
  id: string;
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
  slug: string | null;
};

/** Nazwy kolumn z literału `select` ("a, b, c" -> ["a", "b", "c"]), w kolejności literału. */
export function selectColumnNames(columns: string): string[] {
  return columns
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
}

/**
 * Wiersze nadzbioru zrzutowane na kolumny widgetu, w kolejności jego literału
 * `select` - DOKŁADNIE kształt, który PostgREST oddałby na zapytanie widgetu
 * (bez pól spoza listy, nowe obiekty: wpis nadzbioru w L1 nie jest
 * współdzielony przez referencję z wpisami widgetów).
 */
export function projectLatestPostRows<T>(rows: readonly LatestPostRow[], columns: string): T[] {
  const names = selectColumnNames(columns);
  return rows.map((row) => {
    const source: Readonly<Record<string, unknown>> = row;
    return Object.fromEntries(names.map((name) => [name, source[name]])) as T;
  });
}

/**
 * Czy widget o oknie [offset, offset + limit) da się obsłużyć wycinkiem
 * nadzbioru. Sam rachunek okna - filtry i sortowanie sprawdza wołający, bo
 * tylko on zna swoje wejście.
 */
export function latestPostsSupersetCovers(offset: number, limit: number): boolean {
  return offset >= 0 && limit >= 0 && offset + limit <= LATEST_POSTS_SUPERSET_LIMIT;
}

/**
 * 20 najnowszych opublikowanych wpisów - JEDEN odczyt na izolat i minutę,
 * dzielony (single-flight) przez wszystkie widgety renderu. Błąd RZUCA i nie
 * trafia do cache; wołający wraca wtedy do własnego zapytania.
 *
 * BEZ SERVE-STALE (`serveStale: false`). Nadzbiór czytają wyłącznie fetchery
 * kluczy widgetów (`builder:post-list:*`, `builder:slider-*`), które same
 * serwują nieświeże wpisy i odświeżają je w tle. Gdyby i nadzbiór oddał
 * nieświeże wiersze, odświeżenie widgetu zapisałoby je jako świeże: nowo
 * opublikowany (albo zdjęty) wpis docierałby na stronę o cały cykl później,
 * a wiek danych mógł sięgnąć 2 × 5 × TTL. Po TTL nadzbiór czyta więc bazę
 * (jednym lotem dla wszystkich widgetów) - tak, jak przed nim robił każdy
 * widget z osobna.
 */
export function fetchLatestPostsSuperset(): Promise<LatestPostRow[]> {
  return edgeTtlCache(
    LATEST_POSTS_SUPERSET_KEY,
    LATEST_POSTS_SUPERSET_TTL_MS,
    async () => {
      const { data, error } = await supabase
        .from("posts")
        .select(LATEST_POSTS_SUPERSET_COLUMNS)
        .eq("status", "published")
        .is("deleted_at", null)
        .order("published_at", { ascending: false })
        .limit(LATEST_POSTS_SUPERSET_LIMIT);
      if (error) throw error;
      return (data ?? []) as LatestPostRow[];
    },
    { serveStale: false },
  );
}

/**
 * Nadzbiór, jeśli LEŻY już w L1 izolatu (świeży albo w oknie serve-stale) -
 * bez pobierania. Autorzy slajdów pytają tak, bo ich klucz powstaje z wierszy
 * slidera: slider bez filtrów rozgrzał nadzbiór chwilę wcześniej, a slider
 * filtrowany nie może płacić za odczyt nadzbioru, którego nie potrzebuje.
 */
function peekLatestPostsSuperset(): Promise<LatestPostRow[] | undefined> {
  return peekEdgeTtlCache<LatestPostRow[]>(LATEST_POSTS_SUPERSET_KEY, LATEST_POSTS_SUPERSET_TTL_MS);
}

/** Posortowane, zdeduplikowane id autorów nadzbioru - klucz wspólnego odczytu profili. */
export function latestSupersetAuthorIds(rows: readonly LatestPostRow[]): string[] {
  return Array.from(
    new Set(rows.map((r) => r.author_id).filter((x): x is string => Boolean(x))),
  ).sort();
}

/**
 * Profile autorów - memoizowane po POSORTOWANEJ liście id. Post-listy i slider
 * podają tu id autorów CAŁEGO nadzbioru, więc wszystkie byline renderu dzielą
 * jeden odczyt (zamiast jednego na widget). Błąd RZUCA i nie trafia do cache.
 * Bez serve-stale z tego samego powodu co `fetchLatestPostsSuperset`: woła go
 * fetcher klucza widgetu albo autorów slajdów.
 */
export function fetchLatestSupersetAuthors(
  ids: readonly string[],
): Promise<LatestSupersetAuthorRow[]> {
  const sorted = Array.from(new Set(ids.filter(Boolean))).sort();
  if (sorted.length === 0) return Promise.resolve([]);
  return edgeTtlCache(
    `builder:latest-posts-authors:v1:${sorted.join(",")}`,
    LATEST_POSTS_SUPERSET_TTL_MS,
    async () => {
      const { data, error } = await supabase
        .from("profiles_public")
        .select(LATEST_SUPERSET_AUTHOR_COLUMNS)
        .in("id", sorted);
      if (error) throw error;
      return (data ?? []) as LatestSupersetAuthorRow[];
    },
    { serveStale: false },
  );
}

/**
 * ROZGRZANIE W PIERWSZEJ FALI LOADERA STRONY GŁÓWNEJ (tylko serwer, bez
 * czekania).
 *
 * Nadzbiór nie zależy od niczego, co loader czyta: to „20 najnowszych
 * opublikowanych wpisów" tenanta hosta. Widgety pytają o niego dopiero po
 * trzech szeregowych falach (ustawienia -> strona -> treść kanwy), czyli na
 * zimnym izolacie daleko od eu-west-1 już po wspólnym terminie widgetów nad
 * zgięciem - sekcja z hero idzie wtedy strumieniem za powłoką, a razem z nią
 * odkrycie obrazu LCP. Start zaraz po trybie strony głównej sprawia, że gdy
 * widgety o niego zapytają, wiersze leżą już w L1 izolatu albo są w locie
 * (single-flight). Wołający pomija tryb „najnowsze wpisy" (tam treścią jest
 * archiwum, nadzbioru nikt nie czyta).
 *
 * TYLKO WPISY, bez profili autorów: profile czyta pierwszy widget z bylinem
 * (ten sam wspólny odczyt, single-flight). Profile w rozgrzewce trafiały na
 * kanwach bez bylinu w próżnię, a przy limicie 6 połączeń Workera zajmowały
 * miejsce w fali, w której lecą odczyty krytyczne.
 *
 * ZA ODPOWIEDZIĄ (`runAfterResponse`): rozgrzewka jest jedynym właścicielem
 * swojego lotu, dopóki nie dołączy do niego widget. Lot ucięty razem
 * z domknięciem odpowiedzi nigdy by się nie rozstrzygnął, a kolejne żądania
 * tego izolatu dołączałyby do niego bez terminu (`serveStale: false`
 * kieruje je właśnie do lotu). Błąd jest połykany - widgety wracają wtedy do
 * własnych zapytań.
 */
export function warmLatestPostsSuperset(): void {
  if (!(import.meta.env.SSR && typeof window === "undefined")) return;
  const work = fetchLatestPostsSuperset().then(
    () => undefined,
    () => undefined,
  );
  // Import dynamiczny, jak `completeAfterResponse` w `ssrCache.ts`: ten moduł
  // jest współdzielony z klientem, statyczna krawędź wciągnęłaby .server.
  void import("@/lib/http/waitUntil.server")
    .then((m) => m.runAfterResponse(work))
    .catch(() => undefined);
}

/**
 * Profile podanych autorów ze wspólnego odczytu nadzbioru albo `null`, gdy nie
 * da się ich tak obsłużyć dokładnie (nadzbioru nie ma w L1, któryś autor spoza
 * nadzbioru, błąd odczytu) - wołający pyta wtedy jak dotąd. Wynik zawiera
 * WYŁĄCZNIE profile z `authorIds`, czyli te same wiersze, które oddałoby
 * `.in("id", authorIds)`.
 */
export async function latestSupersetAuthorsFor(
  authorIds: readonly string[],
): Promise<LatestSupersetAuthorRow[] | null> {
  if (authorIds.length === 0) return null;
  const superset = await peekLatestPostsSuperset();
  if (!superset) return null;
  const supersetAuthors = latestSupersetAuthorIds(superset);
  const known = new Set(supersetAuthors);
  if (!authorIds.every((id) => known.has(id))) return null;
  const profiles = await fetchLatestSupersetAuthors(supersetAuthors).catch((): null => null);
  if (!profiles) return null;
  const wanted = new Set(authorIds);
  return profiles.filter((p) => wanted.has(p.id));
}
