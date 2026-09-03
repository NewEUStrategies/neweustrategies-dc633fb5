// JEDEN kontrakt nagłówków cache dla powierzchni, które crawler i czytnik RSS
// odpytują i CACHE'UJĄ na brzegu CDN.
//
// PO CO TO ISTNIEJE. Literał `public, max-age=300, s-maxage=1800,
// stale-while-revalidate=86400` był przepisany w PIĘCIU plikach tras i modułów
// feedowych (`rss[.]xml.ts`, `podcast.rss[.]xml.ts`,
// `podcasts.$show.rss[.]xml.ts`, `lib/tracker/feed.server.ts`,
// `lib/seo/taxonomyFeed.server.ts`). Pięć kopii jednej decyzji to pięć miejsc,
// w których trzeba pamiętać o drugiej połowie kontraktu - a drugiej połowy
// nie miała ŻADNA z nich.
//
// DRUGA POŁOWA KONTRAKTU: kanał PUSTY nie może dostać TTL kanału pełnego.
// Odpowiedź zdegradowana - pusta, bo katalog domen był nieosiągalny albo
// czytnik treści padł i zdegradował do `[]` (patrz `resilient` w
// `publishedContent.server.ts`, które NIE rzuca) - lądowała na brzegu z
// `s-maxage=1800` i `stale-while-revalidate=86400`. Crawler i czytelnik
// dostawali zapamiętaną PUSTKĘ przez pół godziny, a jako „stale" nawet przez
// dobę, długo po tym, jak baza wróciła. Awaria trwająca sekundy utrwalała się
// na 24 godziny, a jedynym lekarstwem było ręczne czyszczenie cache.
//
// Dla KATALOGU PODCASTÓW konsekwencja jest o klasę wyższa niż dla czytnika
// artykułów: Apple Podcasts i Spotify traktują kanał, który oddał 200 z zerem
// pozycji, jako informację „ta audycja nie ma odcinków", a nie jako awarię.
// Utrwalenie takiej odpowiedzi na brzegu to ryzyko wypadnięcia audycji
// z katalogu - awaria cicha, dokładnie tej klasy, którą opisuje
// `lib/podcast/applePodcast.ts`.
//
// Dlatego liczba pozycji jest ARGUMENTEM, a nie szczegółem wywołania: kanał
// pusty rewaliduje się na brzegu co minutę i nigdy nie jest podawany jako
// stale, kanał pełny zostaje przy dotychczasowym, długim TTL.

/**
 * TTL kanału PEŁNEGO - bez zmian względem stanu przed wydzieleniem tego
 * modułu. Czytniki RSS odpytują agresywnie; bez `s-maxage` każde odpytanie
 * schodziłoby do bazy.
 */
export const FEED_CACHE_CONTROL_FULL =
  "public, max-age=300, s-maxage=1800, stale-while-revalidate=86400";

/**
 * TTL kanału RELACJI NA ŻYWO. Relacja starzeje się w minutach, nie w
 * godzinach - dłuższy cache dawałby czytnikowi wpisy z półgodzinnym
 * opóźnieniem. Wydzielone jako stała, bo to JEDYNY uzasadniony wyjątek od
 * `FEED_CACHE_CONTROL_FULL` i nie chcemy, żeby wyglądał na literówkę.
 */
export const LIVE_FEED_CACHE_CONTROL_FULL =
  "public, max-age=60, s-maxage=120, stale-while-revalidate=600";

/**
 * TTL kanału PUSTEGO. `max-age=0` + `must-revalidate` u klienta, minuta na
 * brzegu, ZERO `stale-while-revalidate` - pustka nie może być podawana jako
 * „wystarczająco świeża". Ten sam kształt, co nagłówek indeksu sitemapy,
 * który jest dziś jedyną poprawną odpowiedzią zdegradowaną w repozytorium.
 */
export const FEED_CACHE_CONTROL_EMPTY = "public, max-age=0, s-maxage=60, must-revalidate";

/**
 * Nagłówek `Cache-Control` kanału o zadanej liczbie pozycji.
 *
 * Kanał pusty jest tu traktowany jednakowo, niezależnie od POWODU pustki
 * (awaria czytnika, host podglądowy bez tenanta, redakcja bez treści) -
 * z perspektywy brzegu CDN i crawlera te stany są nierozróżnialne, a koszt
 * krótkiego TTL na kanale, który legalnie nie ma treści, to jedno zapytanie
 * na minutę.
 *
 * @param itemCount liczba pozycji, które kanał faktycznie wyemitował
 * @param whenFull TTL kanału pełnego - domyślnie standardowy; relacja na żywo
 *   podaje tu `LIVE_FEED_CACHE_CONTROL_FULL`
 */
export function feedCacheControl(
  itemCount: number,
  whenFull: string = FEED_CACHE_CONTROL_FULL,
): string {
  return itemCount > 0 ? whenFull : FEED_CACHE_CONTROL_EMPTY;
}

/** Pełny zestaw nagłówków odpowiedzi kanału RSS (typ treści + cache). */
export function rssResponseHeaders(
  itemCount: number,
  whenFull: string = FEED_CACHE_CONTROL_FULL,
): Record<string, string> {
  return {
    "Content-Type": "application/rss+xml; charset=utf-8",
    "Cache-Control": feedCacheControl(itemCount, whenFull),
  };
}
