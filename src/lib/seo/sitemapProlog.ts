// Prolog plików mapy strony (indeks, shardy sekcji, news-sitemapa).
//
// BEZ ARKUSZA XSLT (2026-11). Do tej pory drugim wierszem każdego pliku była
// instrukcja `<?xml-stylesheet type="text/xsl" href="/sitemap.xsl"?>`, dzięki
// której przeglądarka pokazywała mapę jako tabelę z klikalnymi adresami.
// Chrome wycofuje XSLT z silnika (zapowiedź „Removing XSLT for a more secure
// browser", developer.chrome.com, 2025; wyłączenie w wydaniu stabilnym
// zaplanowane na Chrome 155) i już dziś każdy plik z tą instrukcją otwierał się
// z ostrzeżeniem „Ta witryna używa XSLT; ta funkcja wkrótce zostanie usunięta".
// Po wyłączeniu silnika arkusz nie zadziała w ogóle, a WHATWG zapowiada to samo
// dla pozostałych przeglądarek - więc instrukcja i trasa `/sitemap.xsl` zostały
// usunięte, a NIE zastąpione polyfillem: skrypt wstrzyknięty do `<urlset>`
// byłby obcym elementem w dokumencie, który czytają walidatory Search Console.
//
// Crawler nic nie traci: instrukcję przetwarzania i tak pomijał, treść mapy
// (adresy, `lastmod`, `news:news`) jest bajt w bajt ta sama. Człowiek dostaje
// surowe drzewo XML z komentarzem wskazującym czytelną mapę HTML (`/sitemap`).

/** Ścieżka czytelnej mapy HTML - wskazywana w komentarzu prologu. */
export const HUMAN_SITEMAP_PATH = "/sitemap";

/** Komentarz dla człowieka, który otworzył plik mapy w przeglądarce. */
export const SITEMAP_HUMAN_POINTER = `<!-- Mapa strony dla ludzi / Human-readable site map: ${HUMAN_SITEMAP_PATH} -->`;

/** Znacznik komentarza z chwilą wygenerowania pliku. */
export const SITEMAP_GENERATED_MARKER = "generated:";

/**
 * Komentarz z chwilą wygenerowania pliku.
 *
 * PO CO. Mapy są generowane NA ŻYWO przy każdym pobraniu, ale z samego pliku
 * nie dało się tego zobaczyć: daty `lastmod` są (i muszą być) datami zmiany
 * TREŚCI, więc przy treści sprzed tygodnia mapa wyglądała na „starą".
 * Komentarz mówi wprost, kiedy plik powstał. Roboty komentarze pomijają,
 * a `lastmod` zostaje prawdziwy - Google ignoruje `lastmod`, który zawsze
 * wskazuje „dzisiaj".
 */
export function sitemapGeneratedComment(generatedAt: number): string {
  const iso = new Date(generatedAt).toISOString().replace(/\.\d{3}Z$/, "Z");
  return `<!-- ${SITEMAP_GENERATED_MARKER} ${iso} -->`;
}

/** Opcje wspólne dla generatorów plików mapy. */
export interface SitemapRenderOptions {
  /** Chwila wygenerowania (ms) - trasa podaje `Date.now()`; testy pomijają. */
  generatedAt?: number;
}

/**
 * Prolog pliku mapy: deklaracja XML, wskazówka mapy HTML i (opcjonalnie)
 * chwila wygenerowania. Żadnej instrukcji `<?xml-stylesheet?>` - patrz nagłówek.
 */
export function sitemapProlog(options: SitemapRenderOptions = {}): string[] {
  const lines = [`<?xml version="1.0" encoding="UTF-8"?>`, SITEMAP_HUMAN_POINTER];
  if (options.generatedAt !== undefined && Number.isFinite(options.generatedAt)) {
    lines.push(sitemapGeneratedComment(options.generatedAt));
  }
  return lines;
}
