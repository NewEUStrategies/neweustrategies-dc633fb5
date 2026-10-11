// Rejestr powierzchni maszynowych serwisu (sitemapy, feedy, llms.txt).
//
// PRZYCZYNA: każda nowa powierzchnia maszynowa musiała być pamiętana w trzech
// miejscach naraz - w trasie, w robots.txt i w sekcji "Zasoby maszynowe"
// llms.txt. news-sitemap.xml pokazał, jak to się kończy: trasa istniała, ale
// robots.txt deklarował wyłącznie /sitemap.xml, więc feed był NIEODKRYWALNY.
// Rejestr jest jedynym źródłem prawdy, a test kontraktu
// (__tests__/machineSurfaces.contract.test.ts) pilnuje, że:
//   1. każdy wpis ma realny plik trasy w src/routes,
//   2. każda trasa wyglądająca na powierzchnię maszynową jest zarejestrowana,
//   3. llms.txt faktycznie publikuje adresy z rejestru.
// Dzięki temu dopisanie feedu bez ogłoszenia go crawlerom nie przejdzie CI.

export interface MachineSurface {
  /** Ścieżka kanoniczna (bez prefiksu językowego), zawsze od "/". */
  path: string;
  /** Etykieta w llms.txt - dwujęzyczna, bo llms.txt jest jednym plikiem. */
  label: string;
  /** Plik trasy w src/routes, który tę powierzchnię serwuje. */
  routeFile: string;
  /** Adres ma osobny wariant /en (feedy treści); sitemapy są wspólne. */
  localized?: boolean;
  /** Czy adres wymienia llms.txt (robots.txt/llms.txt same siebie nie listują). */
  inLlmsTxt: boolean;
  /**
   * Przełącznik redakcji, którego wyłączenie zamienia trasę w 404 (`rss_enabled`
   * dla każdego kanału RSS, `news_sitemap_enabled` dla Google News). llms.txt
   * nie może ogłaszać adresu, który w tej chwili odpowiada 404 - patrz filtr
   * `include` w `llmsTxtResourceLines`.
   */
  setting?: "rss_enabled" | "news_sitemap_enabled";
}

export const MACHINE_SURFACES: readonly MachineSurface[] = [
  {
    path: "/sitemap.xml",
    label: "Sitemap (indeks) / Sitemap (index)",
    routeFile: "sitemap[.]xml.ts",
    inLlmsTxt: true,
  },
  {
    path: "/sitemap-index.xml",
    label: "Sitemap index (alias)",
    routeFile: "sitemap-index[.]xml.ts",
    inLlmsTxt: false,
  },
  {
    path: "/sitemap",
    label: "Mapa strony HTML / HTML site map",
    routeFile: "sitemap.tsx",
    inLlmsTxt: true,
  },
  {
    path: "/news-sitemap.xml",
    label: "Google News sitemap",
    routeFile: "news-sitemap[.]xml.ts",
    inLlmsTxt: true,
    setting: "news_sitemap_enabled",
  },
  {
    // Arkusz wyglądu map w przeglądarce (XSL) - nie jest treścią dla
    // asystentów AI, więc llms.txt go nie wymienia.
    path: "/sitemap.xsl",
    label: "Arkusz wyglądu map strony / Sitemap stylesheet (XSL)",
    routeFile: "sitemap[.]xsl.ts",
    inLlmsTxt: false,
  },
  {
    path: "/rss.xml",
    label: "RSS - wszystkie analizy / all analyses",
    routeFile: "rss[.]xml.ts",
    localized: true,
    inLlmsTxt: true,
    setting: "rss_enabled",
  },
  {
    path: "/podcast/rss.xml",
    label: "RSS podcastu (kanał sieciowy) / podcast feed (network)",
    routeFile: "podcast.rss[.]xml.ts",
    localized: true,
    inLlmsTxt: true,
    setting: "rss_enabled",
  },
  {
    path: "/tracker/rss.xml",
    label: "RSS trackera legislacyjnego UE / EU policy tracker feed",
    routeFile: "tracker.rss[.]xml.ts",
    localized: true,
    inLlmsTxt: true,
    setting: "rss_enabled",
  },
  {
    path: "/live/rss.xml",
    label: "RSS relacji na żywo / live coverage feed",
    routeFile: "live_.rss[.]xml.ts",
    localized: true,
    inLlmsTxt: true,
    setting: "rss_enabled",
  },
  {
    path: "/llms.txt",
    label: "llms.txt",
    routeFile: "llms[.]txt.ts",
    inLlmsTxt: false,
  },
  {
    path: "/robots.txt",
    label: "robots.txt",
    routeFile: "robots[.]txt.ts",
    inLlmsTxt: false,
  },
];

/**
 * Feedy PER ELEMENT (kategoria, tag, program, konkretny podcast, shard mapy).
 * Nie trafiają do rejestru powierzchni globalnych - nie da się ich wymienić
 * jednym adresem - ale test kontraktu musi wiedzieć, że to nie przeoczenie.
 * Ich odkrywalność zapewnia autodiscovery w <head> danej strony oraz indeks
 * sitemapy.
 */
export const PER_ITEM_FEED_ROUTE_FILES: readonly string[] = [
  "category.$slug.rss[.]xml.ts",
  "tag.$slug.rss[.]xml.ts",
  "programs.$slug.rss[.]xml.ts",
  "podcasts.$show.rss[.]xml.ts",
  "sitemaps.$section.ts",
  // WordPress-owy alias /feed -> 301 na /rss.xml; nie jest osobnym kanałem.
  "feed.ts",
];

/**
 * Czy dany wariant powierzchni (język `null` = adres wspólny, bez wariantu
 * językowego) wolno w tej chwili ogłosić. Domyślnie - każdy zarejestrowany.
 */
export type MachineSurfaceFilter = (surface: MachineSurface, lang: "pl" | "en" | null) => boolean;

/**
 * Powierzchnie ogłaszane w llms.txt, z absolutnymi adresami.
 *
 * `include` (2026-10 audyt powierzchni maszynowych): rejestr mówi, co ISTNIEJE,
 * a nie co w tej chwili odpowiada 200. llms.txt ogłaszał news-sitemapę
 * i kanały RSS bezwarunkowo - także przy wyłączonym `rss_enabled` (każdy kanał
 * to wtedy 404) i przy news-sitemapie bez artykułu (404 „No news articles"),
 * choć indeks sitemapy w tym samym stanie jej nie ogłasza. Trasa podaje tu
 * decyzję o stanie bieżącym; bez filtra (testy kontraktu) lista jest pełna.
 */
export function llmsTxtResourceLines(
  origin: string,
  localizedPath: (path: string, lang: "pl" | "en") => string,
  include: MachineSurfaceFilter = () => true,
): Array<{ label: string; url: string }> {
  const out: Array<{ label: string; url: string }> = [];
  for (const surface of MACHINE_SURFACES) {
    if (!surface.inLlmsTxt) continue;
    if (surface.localized) {
      for (const lang of ["pl", "en"] as const) {
        if (!include(surface, lang)) continue;
        out.push({
          label: `${surface.label} (${lang.toUpperCase()})`,
          url: `${origin}${localizedPath(surface.path, lang)}`,
        });
      }
    } else if (include(surface, null)) {
      out.push({ label: surface.label, url: `${origin}${surface.path}` });
    }
  }
  return out;
}
