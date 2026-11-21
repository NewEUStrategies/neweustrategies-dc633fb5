// Zasoby i18n dla /admin/settings/site-identity - tytuł i opis serwisu oraz
// mapa ekosystemu SEO (sitemapy, kanały, llms.txt, robots.txt).
import i18n from "@/lib/i18n";

const pl = {
  adminSiteIdentity: {
    pageTitle: "Tytuł i opis serwisu",
    intro:
      "Jedno miejsce, z którego tytuł i opis trafiają do <title>, meta description, kart og:/twitter:, kanałów RSS, llms.txt i danych strukturalnych. Puste pole = wbudowany tekst marki.",
    sectionTexts: "Teksty marki",
    titlePl: "Tytuł serwisu (PL)",
    titleEn: "Tytuł serwisu (EN)",
    descriptionPl: "Opis serwisu (PL)",
    descriptionEn: "Opis serwisu (EN)",
    sectionEcosystem: "Ekosystem SEO",
    ecosystemIntro:
      "Lista układa się sama z rejestru plików i przełączników poniżej. Włączenie dodaje pliki do wyszukiwarek, robots.txt i llms.txt, wyłączenie wycofuje je ze wszystkich naraz. Pliki generują się na żądanie z aktualnej treści, więc po zapisie odświeżają się automatycznie.",
    open: "Otwórz",
    inRobots: "w robots.txt",
    disabledSummary: "Wycofane (wyłączone przełącznikiem): {{names}}.",
    robotsSync:
      'Ten sam plik i te same przełączniki w zakładkach „Tytuł i opis serwisu" oraz „SEO" - zmiana w jednej jest widoczna w drugiej.',
    toggles: {
      rss_enabled: "Kanały RSS",
      news_sitemap_enabled: "Sitemap Google News",
      llms_txt_enabled: "llms.txt dla asystentów AI",
    },
    surfaces: {
      sitemap: {
        label: "Sitemap (indeks)",
        hint: "Spis wszystkich sekcyjnych map - podstawowy adres dla wyszukiwarek.",
      },
      sitemapIndex: {
        label: "Indeks sitemap (alias)",
        hint: "Ten sam indeks pod adresem, którego szukają starsze narzędzia.",
      },
      htmlSitemap: { label: "Mapa strony (HTML)", hint: "Mapa dla czytelników i crawlerów AI." },
      newsSitemap: { label: "Sitemap Google News", hint: "Artykuły z ostatnich 48 godzin." },
      rss: {
        label: "Kanał RSS",
        hint: "Wszystkie analizy - tytuł i opis kanału pochodzą z pól powyżej.",
      },
      podcastRss: { label: "RSS podcastu", hint: "Kanał sieciowy wszystkich podcastów." },
      trackerRss: { label: "RSS trackera UE", hint: "Zmiany w trackerze legislacyjnym." },
      liveRss: { label: "RSS relacji na żywo", hint: "Aktualizacje relacji na żywo." },
      llms: {
        label: "llms.txt",
        hint: "Przewodnik po serwisie dla asystentów AI - używa opisu serwisu.",
      },
      robots: { label: "robots.txt", hint: "Reguły dla crawlerów, w tym polityka crawlerów AI." },
    },
    moreSettings: "Więcej ustawień SEO",
    identityLink: "Tytuł i opis serwisu",
    socialSettings: "Podgląd linków (og:image)",
  },
};

const en = {
  adminSiteIdentity: {
    pageTitle: "Site title and description",
    intro:
      "One place that feeds <title>, the meta description, og:/twitter: cards, RSS feeds, llms.txt and structured data. Empty field = the built-in brand text.",
    sectionTexts: "Brand copy",
    titlePl: "Site title (PL)",
    titleEn: "Site title (EN)",
    descriptionPl: "Site description (PL)",
    descriptionEn: "Site description (EN)",
    sectionEcosystem: "SEO ecosystem",
    ecosystemIntro:
      "This list builds itself from the file registry and the switches below. Turning one on adds its files for search engines, robots.txt and llms.txt; turning it off withdraws them from all three at once. Files are generated on demand from current content, so they refresh automatically after you save.",
    open: "Open",
    inRobots: "in robots.txt",
    disabledSummary: "Withdrawn (switched off): {{names}}.",
    robotsSync:
      'The same file and the same switches on the "Site title and description" and "SEO" tabs - a change on one shows on the other.',
    toggles: {
      rss_enabled: "RSS feeds",
      news_sitemap_enabled: "Google News sitemap",
      llms_txt_enabled: "llms.txt for AI assistants",
    },
    surfaces: {
      sitemap: {
        label: "Sitemap (index)",
        hint: "Lists every section map - the primary address for search engines.",
      },
      sitemapIndex: {
        label: "Sitemap index (alias)",
        hint: "The same index at the address older tools look for.",
      },
      htmlSitemap: { label: "Site map (HTML)", hint: "A map for readers and AI crawlers." },
      newsSitemap: { label: "Google News sitemap", hint: "Articles from the last 48 hours." },
      rss: {
        label: "RSS feed",
        hint: "All analyses - the feed title and description come from the fields above.",
      },
      podcastRss: { label: "Podcast RSS", hint: "Network feed of every podcast." },
      trackerRss: { label: "EU tracker RSS", hint: "Changes in the legislative tracker." },
      liveRss: { label: "Live coverage RSS", hint: "Live coverage updates." },
      llms: {
        label: "llms.txt",
        hint: "A site guide for AI assistants - uses the site description.",
      },
      robots: { label: "robots.txt", hint: "Crawler rules, including the AI-crawler policy." },
    },
    moreSettings: "More SEO settings",
    identityLink: "Site title and description",
    socialSettings: "Link preview (og:image)",
  },
};

/** No-op wołany w komponencie trasy zamiast side-effectowego importu modułu. */
// Explicit registration must survive both Vite and Nitro tree shaking.
// Keep the legacy side-effect import contract, and avoid repeated deep merges.
let registered = false;
export function ensureI18n(): void {
  if (registered) return;
  registered = true;
  i18n.addResourceBundle("pl", "translation", pl, true, true);
  i18n.addResourceBundle("en", "translation", en, true, true);
}
ensureI18n();
