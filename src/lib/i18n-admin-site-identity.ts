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
      "Wszystkie pliki są generowane na żądanie z aktualnej treści i tych ustawień - po zapisie odświeżają się automatycznie. Otwórz, żeby sprawdzić wynik.",
    open: "Otwórz",
    sitemapIndex: "Indeks sitemap",
    sitemapIndexHint: "Spis wszystkich sekcyjnych sitemap serwisu.",
    sitemap: "Sitemap",
    sitemapHint: "Strony i wpisy - podstawowa mapa dla wyszukiwarek.",
    newsSitemap: "Sitemap Google News",
    newsSitemapHint: "Artykuły z ostatnich 48 godzin.",
    rssPl: "Kanał RSS (PL)",
    rssEn: "Kanał RSS (EN)",
    rssHint: "Tytuł i opis kanału pochodzą z pól powyżej.",
    llms: "llms.txt",
    llmsHint: "Przewodnik po serwisie dla asystentów AI - używa opisu serwisu.",
    robots: "robots.txt",
    robotsHint: "Reguły dla crawlerów, w tym polityka crawlerów AI.",
    moreSettings: "Więcej ustawień SEO",
    moreSettingsHint: "Sufiks tytułów, kanały, dane strukturalne i crawlery AI.",
    socialSettings: "Podgląd linków (og:image)",
    socialSettingsHint: "Domyślna karta udostępniania dla całego serwisu.",
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
      "Every file is generated on demand from current content and these settings, so it refreshes automatically after you save. Open one to check the result.",
    open: "Open",
    sitemapIndex: "Sitemap index",
    sitemapIndexHint: "Lists every section sitemap of the site.",
    sitemap: "Sitemap",
    sitemapHint: "Pages and posts - the primary map for search engines.",
    newsSitemap: "Google News sitemap",
    newsSitemapHint: "Articles from the last 48 hours.",
    rssPl: "RSS feed (PL)",
    rssEn: "RSS feed (EN)",
    rssHint: "The feed title and description come from the fields above.",
    llms: "llms.txt",
    llmsHint: "A site guide for AI assistants - uses the site description.",
    robots: "robots.txt",
    robotsHint: "Crawler rules, including the AI-crawler policy.",
    moreSettings: "More SEO settings",
    moreSettingsHint: "Title suffix, feeds, structured data and AI crawlers.",
    socialSettings: "Link preview (og:image)",
    socialSettingsHint: "The default share card for the whole site.",
  },
};

i18n.addResourceBundle("pl", "translation", pl, true, true);
i18n.addResourceBundle("en", "translation", en, true, true);

/** No-op wołany w komponencie trasy zamiast side-effectowego importu modułu. */
export function ensureI18n(): void {}
