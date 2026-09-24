// Zasoby i18n dla KOKPITU SEO (/admin/seo i jego zakładki: kokpit, strona
// główna, karty społecznościowe). Osobna nakładka, a nie dopisek do
// `locale/pl|en.ts`, bo te ekrany mają własny, obszerny słownik komunikatów
// audytu, a rdzeń słownika jest ładowany na KAŻDEJ stronie serwisu - także
// publicznej, gdzie nazwy pól panelu SEO są martwym balastem.
//
// Rejestracja odbywa się przy ewaluacji modułu (addResourceBundle niżej),
// a trasy wołają `ensureI18n()` W KOMPONENCIE - patrz komentarz przy tej
// funkcji na dole pliku.
//
// PARYTET PL/EN jest wymuszony NA ETAPIE KOMPILACJI przez `const en: typeof pl`.
// Bramka `i18nKeyDrift.gate.test.ts` ma próg zero dla całego `admin.*`, więc
// klucz dodany tylko po jednej stronie wywala CI - ten zapis przenosi tę
// porażkę z CI do edytora.
import i18n from "@/lib/i18n";

const pl = {
  adminSeoHub: {
    title: "SEO",
    subtitle:
      "Jedno miejsce, z którego marka wygląda tak samo w Google, w wyszukiwarkach AI i w podglądzie linku na LinkedInie.",
    tabDashboard: "Kokpit",
    tabHomepage: "Strona główna",
    tabSocial: "Karty społecznościowe",
    tabContent: "Treści",
    noResults: "Brak wyników dla tych filtrów.",
    colDescPl: "Opis PL",
    colDescEn: "Opis EN",
    // Dyrektywa protokołu robots - brzmi tak samo po polsku i po angielsku,
    // ale idzie przez słownik, bo literał w JSX-ie omija wszystkie bramki i18n.
    noindexLabel: "noindex",
    tabSearchConsole: "Search Console",

    // --- Kokpit ---
    dashboardIntro:
      "Stan SEO całego serwisu na dziś. Kafelki i listy prowadzą prosto do miejsca, w którym daną rzecz się poprawia.",
    scoreLabel: "Kondycja marki",
    scoreHint: "Wynik liczy problemy strony głównej - to ona odpowiada za wynik na nazwę marki.",
    tileErrors: "Błędy",
    tileWarnings: "Ostrzeżenia",
    tileContent: "Treści",
    tileMissingDesc: "Bez opisu",
    tileDefaultImage: "Domyślna karta",
    sectionBrand: "Marka w wyszukiwarce",
    sectionContent: "Treści",
    sectionShortcuts: "Skróty",
    sectionFoundation: "Fundamenty techniczne",
    foundationIntro:
      "Sprawdzenie na żywo, wykonane teraz na tym adresie - niezależne od raportów zewnętrznych skanerów, które bywają nieświeże.",
    foundationAllGood: "Wszystkie fundamenty odpowiadają poprawnie.",
    foundationState_ok: "OK",
    foundationState_warn: "Uwaga",
    foundationState_fail: "Błąd",
    foundationState_unknown: "Brak danych",
    foundation_sitemap: "Mapa strony (sitemap.xml)",
    foundation_robots: "robots.txt",
    foundation_llms: "llms.txt",
    foundation_htmlLang: "Język dokumentu (atrybut lang)",
    foundationHttp: "Odpowiedź HTTP {{value}} - plik nie jest dostępny.",
    foundationSitemapIndex: "Indeks mapy strony: {{value}} plików sekcji.",
    foundationSitemapUrlset: "Mapa strony: {{value}} adresów.",
    foundationSitemapEmpty: "Mapa strony odpowiada, ale nie zawiera żadnych adresów.",
    foundationSitemapMalformed: "Odpowiedź nie jest mapą strony (brak sitemapindex ani urlset).",
    foundationRobotsSitemaps: "Deklaracje mapy strony w pliku: {{value}}.",
    foundationRobotsNoSitemap: "Plik nie wskazuje mapy strony (brak wpisu Sitemap:).",
    foundationLlmsPresent: "Przewodnik dla asystentów AI jest opublikowany.",
    foundationLlmsDisabled: "Wyłączony w ustawieniach technicznych SEO.",
    foundationLangPresent: 'Strona główna deklaruje lang="{{value}}".',
    foundationLangMissing: "Znacznik html nie ma atrybutu lang.",
    allGood: "Brak problemów - konfiguracja marki jest kompletna.",
    fixIt: "Popraw",
    openHomepage: "Otwórz zakładkę strony głównej",
    openSocial: "Otwórz karty społecznościowe",
    openContent: "Otwórz listę treści",
    contentSummary: "{{done}} z {{total}} treści ma komplet opisów i własną kartę.",
    shortcutRobots: "robots.txt",
    shortcutRobotsHint: "Reguły dla crawlerów, w tym polityka crawlerów AI.",
    shortcutSitemap: "Sitemap",
    shortcutSitemapHint: "Mapa stron i wpisów dla wyszukiwarek.",
    shortcutLlms: "llms.txt",
    shortcutLlmsHint: "Przewodnik po serwisie dla asystentów AI.",
    shortcutSettings: "Ustawienia techniczne",
    shortcutSettingsHint: "Kanały, dane strukturalne, crawlery AI, sufiks tytułów.",
    shortcutRedirects: "Przekierowania",
    shortcutRedirectsHint: "Stare adresy, które mają prowadzić do nowych.",
    open: "Otwórz",
    download: "Pobierz plik",

    // --- Strona główna ---
    homepageIntro:
      "Tak wygląda strona główna po wpisaniu nazwy marki. Nazwa serwisu i tytuł to DWIE różne rzeczy - Google rysuje je w osobnych liniach.",
    sectionIdentity: "Nazwa serwisu",
    siteName: "Nazwa serwisu",
    siteNameHint:
      "Sama marka, bez opisu i bez separatora - np. „New European Strategies”. Trafia do og:site_name oraz WebSite.name, czyli do linii nad niebieskim linkiem w Google. Puste = wbudowana nazwa marki.",
    siteNameAlternate: "Nazwa alternatywna",
    siteNameAlternateHint:
      "Skrót albo druga używana forma nazwy, np. „NES”. Pomaga wyszukiwarce połączyć obie formy w jedną markę. Puste = nie wysyłamy tego sygnału.",
    sectionTexts: "Tytuł i opis",
    titlePl: "Tytuł strony głównej (PL)",
    titleEn: "Tytuł strony głównej (EN)",
    descriptionPl: "Opis strony głównej (PL)",
    descriptionEn: "Opis strony głównej (EN)",
    textsHint: "Puste pole = wbudowany tekst marki. Podgląd poniżej pokazuje wynik na żywo.",
    titleIsH1Hint:
      "Tytuł PL/EN jest równocześnie nagłówkiem H1 strony głównej - jest w kodzie strony i w indeksie Google, ale niewidoczny w layoucie (etykieta logo w nagłówku).",
    sectionPreview: "Podgląd wyniku",
    previewPl: "Wynik po polsku",
    previewEn: "Wynik po angielsku",
    sectionAudit: "Co wymaga uwagi",
    auditIntro:
      "Lista jest liczona z tych samych wartości, które trafiają do <head> - nie z osobnej kopii.",
    auditClean: "Nic nie wymaga uwagi w tym języku.",
    staticHomepageNotice:
      "Stroną główną jest strona z CMS-a i to JEJ własny tytuł SEO wygrywa z polem powyżej. Zmiana tutaj nie będzie widoczna, dopóki nadpisanie na tamtej stronie istnieje.",
    staticHomepageOpen: "Otwórz stronę główną w edytorze",

    // --- Karty społecznościowe ---
    socialIntro:
      "Obrazek i teksty, które zobaczą ludzie po wklejeniu linku na Facebooka, LinkedIna, X, Slacka czy WhatsAppa. Każda z tych sieci przycina tytuł inaczej - podglądy poniżej pokazują ile.",
    sectionCard: "Domyślna karta",
    defaultImage: "Obrazek karty (og:image)",
    defaultImageHint:
      "Zalecany rozmiar {{width}}x{{height}}. Rzeczy ważne trzymaj w środku kadru - X i Google przycinają brzegi. Puste = wbudowany plik marki.",
    imageAlt: "Opis obrazka (og:image:alt)",
    imageAltHint:
      "Czytany przez czytniki ekranu w podglądzie linku i przez scrapery indeksujące obrazy.",
    cardType: "Typ karty na X",
    cardTypeHint:
      "Duża karta zajmuje więcej miejsca w osi czasu i zwykle ma wyższy CTR; mała to kwadrat obok tekstu.",
    cardTypeLarge: "Duża (summary_large_image)",
    cardTypeSmall: "Mała (summary)",
    sectionPreviews: "Podgląd w sieciach",
    previewsHint: "Ten sam obrazek i te same teksty, przycięte według reguł każdej sieci.",
    previewLang: "Język podglądu",
    dimensionsOk: "Wymiary pasują do wszystkich sieci.",
    dimensionsTooSmall:
      "Obrazek jest za mały ({{width}}x{{height}}). Poniżej 600x315 sieci pokazują małą kartę zamiast dużej.",
    dimensionsWrongRatio:
      "Proporcje odbiegają od {{width}}x{{height}} - sieci przytną obrazek, a kadr wypadnie inaczej niż tutaj.",
    dimensionsUnknown: "Nie znamy wymiarów tego pliku - sprawdź kadr w podglądzie obok.",
    sectionSources: "Skąd bierze się karta konkretnej podstrony",
    sourcesHint:
      "Ustawienia z tej zakładki działają wszędzie tam, gdzie strona nie ma własnej okładki.",
    noImage: "Brak obrazka",

    // --- Komunikaty audytu ---
    readOnlyNotice:
      "Te ustawienia zapisuje wyłącznie administrator. Podgląd i audyt działają normalnie - zapis jest wyłączony.",
    severityError: "Błąd",
    severityWarning: "Ostrzeżenie",
    finding: {
      homepageNoindex:
        "Strona główna jest oznaczona jako noindex - wyszukiwarki jej nie pokażą w ogóle.",
      titleMissing: "Tytuł strony głównej jest pusty.",
      titleBrandMissing:
        "Tytuł nie zawiera nazwy „{{brand}}”. Zapytanie o samą nazwę marki ma wtedy słabszy sygnał.",
      titleIsBrandOnly:
        "Tytuł to sama nazwa „{{brand}}”. Dopisz, czym serwis się zajmuje - inaczej strona konkuruje wyłącznie o własną nazwę.",
      titleBrandDuplicated:
        "Nazwa „{{brand}}” występuje w tytule {{count}} razy - jedno wystąpienie wystarczy.",
      titleBrandStripped:
        "Tytuł zaczyna się od „{{brand}}” i separatora. Google rysuje nazwę serwisu w osobnej linii, więc ten prefiks ZDEJMIE - w niebieskim linku zostanie sama reszta tytułu. Przenieś nazwę na koniec tytułu.",
      titleTooLong: "Tytuł ma {{px}}px przy limicie {{limitPx}}px - Google go utnie.",
      titleTooShort: "Tytuł jest krótki ({{px}}px) - zostaje niewykorzystane miejsce w wyniku.",
      descriptionMissing: "Opis jest pusty - wyszukiwarka ułoży fragment sama, z treści strony.",
      descriptionTooLong: "Opis ma {{px}}px przy limicie {{limitPx}}px - zostanie przycięty.",
      descriptionTooShort: "Opis jest krótki ({{px}}px) - warto dopowiedzieć, co serwis oferuje.",
      ogImageMissing: "Brak karty społecznościowej - linki udostępniają się jako goły tekst.",
      ogImageBuiltIn:
        "Używana jest wbudowana karta marki. Własny obrazek 1200x630 wyróżnia link w strumieniu.",
      ogImageAltMissing: "Karta nie ma opisu alternatywnego (og:image:alt).",
      sameAsMissing:
        "Brak profili sameAs (LinkedIn, X, YouTube). To one łączą serwis z profilami marki w grafie wiedzy.",
      publisherLogoMissing: "Brak logo wydawcy w danych strukturalnych.",
      twitterSiteMissing: "Brak uchwytu @ dla X - karty nie wskazują wtedy konta marki.",
    },
  },
};

const en: typeof pl = {
  adminSeoHub: {
    title: "SEO",
    subtitle:
      "One place that makes the brand look the same in Google, in AI search and in a LinkedIn link preview.",
    tabDashboard: "Dashboard",
    tabHomepage: "Homepage",
    tabSocial: "Social cards",
    tabContent: "Content",
    noResults: "No results for these filters.",
    colDescPl: "PL description",
    colDescEn: "EN description",
    noindexLabel: "noindex",
    tabSearchConsole: "Search Console",

    dashboardIntro:
      "Today's SEO state of the whole site. Tiles and lists link straight to the screen where each item is fixed.",
    scoreLabel: "Brand health",
    scoreHint:
      "The score counts homepage problems - that page decides the result for your brand name.",
    tileErrors: "Errors",
    tileWarnings: "Warnings",
    tileContent: "Content",
    tileMissingDesc: "No description",
    tileDefaultImage: "Default card",
    sectionBrand: "Brand in search",
    sectionContent: "Content",
    sectionShortcuts: "Shortcuts",
    sectionFoundation: "Technical foundations",
    foundationIntro:
      "A live check run just now against this address - independent of external scanner reports, which can be stale.",
    foundationAllGood: "Every foundation responds correctly.",
    foundationState_ok: "OK",
    foundationState_warn: "Warning",
    foundationState_fail: "Error",
    foundationState_unknown: "No data",
    foundation_sitemap: "Sitemap (sitemap.xml)",
    foundation_robots: "robots.txt",
    foundation_llms: "llms.txt",
    foundation_htmlLang: "Document language (lang attribute)",
    foundationHttp: "HTTP {{value}} - the file is not available.",
    foundationSitemapIndex: "Sitemap index: {{value}} section files.",
    foundationSitemapUrlset: "Sitemap: {{value}} URLs.",
    foundationSitemapEmpty: "The sitemap responds but contains no URLs.",
    foundationSitemapMalformed: "The response is not a sitemap (no sitemapindex or urlset).",
    foundationRobotsSitemaps: "Sitemap declarations in the file: {{value}}.",
    foundationRobotsNoSitemap: "The file does not point to a sitemap (no Sitemap: entry).",
    foundationLlmsPresent: "The AI assistant guide is published.",
    foundationLlmsDisabled: "Disabled in the technical SEO settings.",
    foundationLangPresent: 'The homepage declares lang="{{value}}".',
    foundationLangMissing: "The html tag has no lang attribute.",
    allGood: "No problems - the brand setup is complete.",
    fixIt: "Fix",
    openHomepage: "Open the homepage tab",
    openSocial: "Open social cards",
    openContent: "Open the content list",
    contentSummary: "{{done}} of {{total}} items have both descriptions and their own card.",
    shortcutRobots: "robots.txt",
    shortcutRobotsHint: "Crawler rules, including the AI-crawler policy.",
    shortcutSitemap: "Sitemap",
    shortcutSitemapHint: "The map of pages and posts for search engines.",
    shortcutLlms: "llms.txt",
    shortcutLlmsHint: "A site guide for AI assistants.",
    shortcutSettings: "Technical settings",
    shortcutSettingsHint: "Feeds, structured data, AI crawlers, title suffix.",
    shortcutRedirects: "Redirects",
    shortcutRedirectsHint: "Old addresses that should lead to new ones.",
    open: "Open",
    download: "Download file",

    homepageIntro:
      "This is how the homepage looks when someone searches your brand name. The site name and the title are TWO different things - Google draws them on separate lines.",
    sectionIdentity: "Site name",
    siteName: "Site name",
    siteNameHint:
      "The brand alone, with no tagline and no separator - e.g. “New European Strategies”. It feeds og:site_name and WebSite.name, the line above the blue link in Google. Empty = the built-in brand name.",
    siteNameAlternate: "Alternate name",
    siteNameAlternateHint:
      "A short form or second spelling of the name, e.g. “NES”. It helps search engines merge both forms into one brand. Empty = the signal is not sent.",
    sectionTexts: "Title and description",
    titlePl: "Homepage title (PL)",
    titleEn: "Homepage title (EN)",
    descriptionPl: "Homepage description (PL)",
    descriptionEn: "Homepage description (EN)",
    textsHint: "An empty field = the built-in brand text. The preview below updates live.",
    titleIsH1Hint:
      "The PL/EN title is also the homepage H1: present in the page source and in Google, but not visible in the layout (it labels the header logo).",
    sectionPreview: "Result preview",
    previewPl: "Polish result",
    previewEn: "English result",
    sectionAudit: "What needs attention",
    auditIntro:
      "The list is computed from the very values that go into <head> - not from a separate copy.",
    auditClean: "Nothing needs attention in this language.",
    staticHomepageNotice:
      "The homepage is a CMS page and ITS own SEO title wins over the field above. A change here stays invisible for as long as that page-level override exists.",
    staticHomepageOpen: "Open the homepage in the editor",

    socialIntro:
      "The image and copy people see when they paste your link into Facebook, LinkedIn, X, Slack or WhatsApp. Each network truncates the title differently - the previews below show by how much.",
    sectionCard: "Default card",
    defaultImage: "Card image (og:image)",
    defaultImageHint:
      "Recommended size {{width}}x{{height}}. Keep anything important in the centre - X and Google crop the edges. Empty = the built-in brand file.",
    imageAlt: "Image description (og:image:alt)",
    imageAltHint: "Read by screen readers in the link preview and by image-indexing crawlers.",
    cardType: "Card type on X",
    cardTypeHint:
      "The large card takes more room in the timeline and usually gets a higher CTR; the small one is a square next to the text.",
    cardTypeLarge: "Large (summary_large_image)",
    cardTypeSmall: "Small (summary)",
    sectionPreviews: "Preview per network",
    previewsHint: "The same image and copy, truncated by each network's own rules.",
    previewLang: "Preview language",
    dimensionsOk: "The dimensions fit every network.",
    dimensionsTooSmall:
      "The image is too small ({{width}}x{{height}}). Below 600x315 networks show a small card instead of a large one.",
    dimensionsWrongRatio:
      "The aspect ratio differs from {{width}}x{{height}} - networks will crop it, so the framing will differ from this preview.",
    dimensionsUnknown: "We do not know this file's dimensions - check the framing in the preview.",
    sectionSources: "Where an individual page's card comes from",
    sourcesHint: "Settings on this tab apply wherever a page has no cover image of its own.",
    noImage: "No image",

    readOnlyNotice:
      "Only an administrator can save these settings. The preview and the audit work as usual - saving is disabled.",
    severityError: "Error",
    severityWarning: "Warning",
    finding: {
      homepageNoindex: "The homepage is marked noindex - search engines will not show it at all.",
      titleMissing: "The homepage title is empty.",
      titleBrandMissing:
        "The title does not contain “{{brand}}”. A search for the bare brand name then has a weaker signal.",
      titleIsBrandOnly:
        "The title is just the name “{{brand}}”. Add what the site is about - otherwise it competes only for its own name.",
      titleBrandDuplicated: "“{{brand}}” appears in the title {{count}} times - once is enough.",
      titleBrandStripped:
        "The title starts with “{{brand}}” and a separator. Google draws the site name on its own line, so it will STRIP that prefix - only the rest of the title stays in the blue link. Move the name to the end of the title.",
      titleTooLong: "The title is {{px}}px against a {{limitPx}}px limit - Google will cut it.",
      titleTooShort: "The title is short ({{px}}px) - it leaves room in the result unused.",
      descriptionMissing:
        "The description is empty - the search engine will compose a snippet itself, from the page body.",
      descriptionTooLong:
        "The description is {{px}}px against a {{limitPx}}px limit - it will be truncated.",
      descriptionTooShort:
        "The description is short ({{px}}px) - it is worth saying more about what the site offers.",
      ogImageMissing: "No social card - links share as bare text.",
      ogImageBuiltIn:
        "The built-in brand card is in use. Your own 1200x630 image stands out in a feed.",
      ogImageAltMissing: "The card has no alternative text (og:image:alt).",
      sameAsMissing:
        "No sameAs profiles (LinkedIn, X, YouTube). These tie the site to the brand's profiles in the knowledge graph.",
      publisherLogoMissing: "No publisher logo in the structured data.",
      twitterSiteMissing: "No @ handle for X - cards then point at no brand account.",
    },
  },
};

export {};

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
