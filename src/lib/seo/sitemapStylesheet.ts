// Podpięcie arkusza wyglądu (XSL) do plików mapy strony.
//
// PO CO. Otwarty w przeglądarce plik mapy był surowym drzewem XML („This XML
// file does not appear to have any style information associated with it"):
// adresy nie były linkami, a redakcja nie widziała różnicy między mapą
// poprawną a zepsutą. Instrukcja `<?xml-stylesheet?>` każe przeglądarce
// pokazać ten sam plik jako czytelną stronę (tabela, klikalne adresy, wersje
// językowe, daty) - tak samo robią Yoast, Rank Math i rdzeń WordPressa.
//
// CRAWLER TEGO NIE WIDZI. Googlebot i inne roboty czytają dokument jako XML
// i instrukcję przetwarzania pomijają; treść mapy (adresy, `lastmod`,
// `news:news`) zostaje bajt w bajt ta sama. Przeglądarka bez XSLT (Chrome
// zapowiedział jego wycofanie) pokaże po prostu surowe drzewo, jak dotąd.
//
// Moduł jest mały celowo: importują go generatory map, a sam arkusz
// (`sitemapStylesheetXsl.ts`) czyta wyłącznie jego trasa.

/** Adres arkusza - względny wobec hosta, więc działa na każdej domenie tenanta. */
export const SITEMAP_STYLESHEET_PATH = "/sitemap.xsl";

/** Instrukcja przetwarzania - drugi wiersz każdego pliku mapy. */
export const SITEMAP_STYLESHEET_PI = `<?xml-stylesheet type="text/xsl" href="${SITEMAP_STYLESHEET_PATH}"?>`;

/** Znacznik komentarza z chwilą wygenerowania pliku (czyta go arkusz XSL). */
export const SITEMAP_GENERATED_MARKER = "generated:";

/**
 * Komentarz z chwilą wygenerowania pliku - trzeci wiersz mapy.
 *
 * PO CO. Mapy są generowane NA ŻYWO przy każdym pobraniu, ale z samego pliku
 * nie dało się tego zobaczyć: daty `lastmod` są (i muszą być) datami zmiany
 * TREŚCI, więc przy treści sprzed tygodnia mapa wyglądała na „starą".
 * Komentarz mówi wprost, kiedy plik powstał; arkusz XSL pokazuje to jako
 * „Wygenerowano". Roboty komentarze pomijają, a `lastmod` zostaje prawdziwy -
 * Google ignoruje `lastmod`, który zawsze wskazuje „dzisiaj".
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

/** Prolog pliku mapy: deklaracja XML, arkusz wyglądu i (opcjonalnie) chwila wygenerowania. */
export function sitemapProlog(options: SitemapRenderOptions = {}): string[] {
  const lines = [`<?xml version="1.0" encoding="UTF-8"?>`, SITEMAP_STYLESHEET_PI];
  if (options.generatedAt !== undefined && Number.isFinite(options.generatedAt)) {
    lines.push(sitemapGeneratedComment(options.generatedAt));
  }
  return lines;
}
