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
    // --- Stan odczytu treści (kokpit i zakładka „Treści") ---
    coverageTruncated:
      "Pokazano {{shown}} z {{total}} treści - liczniki obejmują tylko pobraną część.",
    coverageUnknown:
      "Nie udało się ustalić łącznej liczby treści ({{shown}} pobranych) - liczniki mogą nie obejmować wszystkiego.",
    coveragePartialTag: "częściowe",
    contentReadError:
      "Nie udało się wczytać treści - liczniki i tabela nie pokazują teraz stanu serwisu.",
    contentRetry: "Spróbuj ponownie",
    contentEmpty: "Serwis nie ma jeszcze żadnych wpisów ani stron.",
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
    foundationSitemapIndexValid:
      "Indeks: {{files}} plików sekcji, {{urls}} adresów - każdy plik przechodzi walidację.",
    foundationSitemapUrlsetValid: "Mapa strony: {{urls}} adresów - plik przechodzi walidację.",
    foundationSitemapFilesFailed:
      "Pliki mapy z błędami: {{failed}} z {{total}} - szczegóły w tabeli „Pliki mapy strony”.",
    foundationSitemapFilesWarned:
      "Pliki mapy z ostrzeżeniami: {{warned}} z {{total}} - szczegóły w tabeli „Pliki mapy strony”.",
    foundationSitemapNoData: "Brak danych o mapie strony.",
    // --- Pliki mapy strony (indeks + każdy plik sekcji, walidacja jak w Search Console) ---
    sitemapFilesTitle: "Pliki mapy strony",
    sitemapFilesIntro:
      "Indeks i każdy plik, na który wskazuje, sprawdzone teraz tymi samymi regułami, którymi ocenia je Search Console: schemat sitemaps.org, rozszerzenie Google News, limity i poprawność adresów. Raport Search Console odświeża się z opóźnieniem - ta tabela pokazuje stan bieżący.",
    sitemapRecheck: "Sprawdź ponownie",
    sitemapChecking: "Sprawdzanie…",
    sitemapColFile: "Plik",
    sitemapColState: "Stan",
    sitemapColEntries: "Zawartość",
    sitemapColIssues: "Wynik walidacji",
    sitemapKind_index: "Indeks map",
    sitemapKind_urlset: "Mapa adresów",
    sitemapKind_news: "Google News",
    sitemapKind_unknown: "Nierozpoznany",
    sitemapEntries_index: "plików: {{n}}",
    sitemapEntries_urlset: "adresów: {{n}}",
    sitemapEntries_news: "artykułów: {{n}}",
    sitemapLastmod: "zmiana: {{value}}",
    sitemapNoIssues: "Bez zastrzeżeń",
    sitemapIssuesMore: "i jeszcze {{n}}",
    sitemapIssueLine: "wiersz {{n}}",
    sitemapIssueCount: "wystąpień: {{n}}",
    sitemapIssue_http: "Odpowiedź HTTP {{value}} - plik nie jest dostępny.",
    sitemapIssue_network:
      "Brak odpowiedzi (błąd sieci albo przekroczony czas) - Search Console zgłasza to jako „Ogólny błąd HTTP”.",
    sitemapIssue_contentType: "Typ treści {{value}} zamiast XML.",
    sitemapIssue_emptyBody: "Pusta odpowiedź.",
    sitemapIssue_malformed: "Niepoprawny XML: {{value}}.",
    sitemapIssue_root: "Korzeń „{{value}}” zamiast urlset albo sitemapindex.",
    sitemapIssue_namespace: "Korzeń bez przestrzeni nazw sitemaps.org 0.9.",
    sitemapIssue_undeclaredPrefix: "Prefiks „{{value}}:” bez deklaracji xmlns:{{value}}.",
    sitemapIssue_missingTag: "Brak tagu XML: {{tag}} (tag nadrzędny: {{parent}}).",
    sitemapIssue_duplicateTag: "Powtórzony tag {{tag}} w {{parent}}.",
    sitemapIssue_invalidLoc: "Niepoprawny adres: {{value}}.",
    sitemapIssue_foreignHost: "Adres spoza hosta mapy: {{value}}.",
    sitemapIssue_invalidDate: "Niepoprawna data w {{tag}}: {{value}}.",
    sitemapIssue_futureDate: "Data z przyszłości w {{tag}}: {{value}}.",
    sitemapIssue_invalidChangefreq: "Niepoprawna wartość changefreq: {{value}}.",
    sitemapIssue_invalidPriority: "Niepoprawna wartość priority: {{value}}.",
    sitemapIssue_tooManyEntries: "Wpisów: {{value}} - limit jednego pliku to 50 000.",
    sitemapIssue_tooLarge: "Rozmiar {{value}} B - limit jednego pliku to 50 MB.",
    sitemapIssue_duplicateLoc: "Zduplikowany adres: {{value}}.",
    sitemapIssue_newsTooMany: "Artykułów: {{value}} - limit Google News to 1000.",
    sitemapIssue_newsLanguage: "Kod języka spoza ISO 639: {{value}}.",
    sitemapIssue_newsStale:
      "Metadane Google News przy artykule starszym niż 48 h ({{value}}) - Google zaleca je wtedy zdjąć.",
    sitemapIssue_newsAnchor:
      "Brak artykułów z ostatnich 48 h - plik niesie najnowszy adres ({{value}}) bez metadanych News, zgodnie z wytycznymi Google. Nowe wpisy pojawią się po publikacji.",
    sitemapGoogleLink: "Stan w Google i przesyłanie map",
    // --- Mapy witryn w Google (zakładka Search Console) ---
    gscSitemapsTitle: "Mapy witryn w Google",
    gscSitemapsIntro:
      "Co Google zrobił z mapami strony: kiedy ostatnio je pobrał, czy znalazł błędy i ile adresów odczytał. Po naprawie mapy prześlij ją ponownie - Google pobierze ją od nowa i odświeży raport.",
    gscSubmitIndex: "Prześlij mapę do Google",
    gscResubmit: "Prześlij ponownie",
    gscSubmitting: "Przesyłanie…",
    gscSubmitted:
      "Przesłano do Google: {{value}}. Google pobierze plik w ciągu kilku minut do kilku godzin.",
    gscSubmit_notConfigured: "Konektor Search Console nie jest podłączony.",
    gscSubmit_permission:
      "Konto konektora nie może przesyłać map tej właściwości. W Search Console (Ustawienia → Użytkownicy i uprawnienia) nadaj mu uprawnienie „Pełne” i połącz konektor ponownie z dostępem do zapisu. Do tego czasu prześlij mapę ręcznie: Mapy witryn → sitemap.xml → Prześlij ponownie.",
    gscSubmit_notFound:
      "Google nie zna tej właściwości albo pliku - sprawdź, czy właściwość jest zweryfikowana.",
    gscOpenReport: "Otwórz raport w Search Console",
    gscSitemapsLoadFailed: "Nie udało się odczytać stanu map z Google.",
    gscIndexMissing:
      "Indeks {{value}} nie jest przesłany do tej właściwości - prześlij go, żeby Google czytał wszystkie pliki mapy.",
    gscColSitemap: "Mapa",
    gscColRead: "Odczyt Google",
    gscColState: "Stan",
    gscColUrls: "Adresy",
    gscIndexLabel: "Indeks map",
    gscState_ok: "Sukces",
    gscState_errors: "Błędy: {{n}}",
    gscState_warnings: "Ostrzeżenia: {{n}}",
    gscState_pending: "Czeka na pobranie",
    gscState_never: "Nie pobrano",
    gscNoSitemaps: "Google nie ma jeszcze żadnej mapy tej właściwości.",
    gscSubmitNote:
      "Stan pochodzi z Search Console i odświeża się dopiero po kolejnym pobraniu pliku przez Google - świeżo naprawiona mapa może jeszcze pokazywać stary błąd.",
    foundationRobotsSitemaps: "Deklaracje mapy strony w pliku: {{value}}.",
    foundationRobotsNoSitemap: "Plik nie wskazuje mapy strony (brak wpisu Sitemap:).",
    foundationLlmsPresent: "Przewodnik dla asystentów AI jest opublikowany.",
    foundationLlmsDisabled: "Wyłączony w ustawieniach technicznych SEO.",
    foundationLangPresent: 'Strona główna deklaruje lang="{{value}}".',
    foundationLangMissing: "Znacznik html nie ma atrybutu lang.",
    // --- Origin publiczny tenanta (karta fundamentów, podglądy, linki „na żywo") ---
    foundationCrossHost: "Nie do sprawdzenia z tego hosta - otwórz plik na {{value}}.",
    foundationCrossHostNote:
      "Panel jest otwarty na innym hoście niż {{value}}. Przeglądarka nie odczyta stąd plików tego serwisu, więc karta ich nie ocenia - sprawdź je linkiem „Otwórz”.",
    foundationOriginFailed:
      "Nie udało się ustalić domeny publicznej serwisu, więc karta nie sprawdza plików - inaczej pokazałaby stan plików innego serwisu.",
    foundationOriginRetry: "Spróbuj ponownie",
    noPublicDomain:
      "Ten serwis nie ma jeszcze własnej domeny publicznej. Adresy, linki do walidatorów i stan plików pojawią się po przypisaniu domeny.",
    noPublicDomainHost: "(brak domeny)",
    allGood: "Brak problemów - konfiguracja marki jest kompletna.",
    fixIt: "Popraw",
    openHomepage: "Otwórz zakładkę strony głównej",
    openSocial: "Otwórz karty społecznościowe",
    openContent: "Otwórz listę treści",
    contentSummary: "{{done}} z {{total}} treści ma komplet opisów i własną kartę.",
    shortcutRobotsHint: "Reguły dla crawlerów, w tym polityka crawlerów AI.",
    shortcutSitemapHint: "Mapa stron i wpisów dla wyszukiwarek.",
    shortcutLlmsHint: "Przewodnik po serwisie dla asystentów AI.",
    shortcutSettings: "Ustawienia techniczne",
    shortcutSettingsHint: "Kanały, dane strukturalne, crawlery AI, sufiks tytułów.",
    shortcutRedirects: "Przekierowania",
    shortcutRedirectsHint: "Stare adresy, które mają prowadzić do nowych.",
    sectionFiles: "Pliki generowane",
    filesIntro:
      "Globalne pliki maszynowe serwisu (mapy strony, feedy RSS, llms.txt, robots.txt). Lista idzie z rejestru, z którego korzysta też llms.txt, więc nowy plik globalny pojawia się tu automatycznie. Feedy kategorii, tagów i podcastów oraz części mapy strony są ogłaszane w indeksie mapy i w nagłówku swoich stron.",
    fileOpenEn: "Otwórz EN",
    sectionPrimaryNav: "Kolejność sekcji głównych",
    primaryNavIntro:
      "Sekcje, które strona główna deklaruje w danych strukturalnych jako najważniejsze, w tej kolejności - tę samą listę publikuje llms.txt. Google dobiera sitelinki automatycznie, ze struktury linków serwisu: o tym, które sekcje mają szansę, decydują przede wszystkim linki w menu nagłówka i w stopce (Wygląd → Menu).",
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
    // --- Content read state (dashboard and the "Content" tab) ---
    coverageTruncated:
      "Showing {{shown}} of {{total}} items - the counters cover only the fetched part.",
    coverageUnknown:
      "The total number of items could not be determined ({{shown}} fetched) - the counters may not cover everything.",
    coveragePartialTag: "partial",
    contentReadError:
      "Content could not be loaded - the counters and the table do not show the site's state right now.",
    contentRetry: "Try again",
    contentEmpty: "The site has no posts or pages yet.",
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
    foundationSitemapIndexValid:
      "Index: {{files}} section files, {{urls}} URLs - every file passes validation.",
    foundationSitemapUrlsetValid: "Sitemap: {{urls}} URLs - the file passes validation.",
    foundationSitemapFilesFailed:
      "Sitemap files with errors: {{failed}} of {{total}} - see the “Sitemap files” table.",
    foundationSitemapFilesWarned:
      "Sitemap files with warnings: {{warned}} of {{total}} - see the “Sitemap files” table.",
    foundationSitemapNoData: "No sitemap data.",
    // --- Sitemap files (index + every section file, validated like Search Console) ---
    sitemapFilesTitle: "Sitemap files",
    sitemapFilesIntro:
      "The index and every file it points to, checked just now with the same rules Search Console applies: the sitemaps.org schema, the Google News extension, limits and URL validity. The Search Console report refreshes with a delay - this table shows the current state.",
    sitemapRecheck: "Check again",
    sitemapChecking: "Checking…",
    sitemapColFile: "File",
    sitemapColState: "State",
    sitemapColEntries: "Contents",
    sitemapColIssues: "Validation result",
    sitemapKind_index: "Sitemap index",
    sitemapKind_urlset: "URL sitemap",
    sitemapKind_news: "Google News",
    sitemapKind_unknown: "Unrecognised",
    sitemapEntries_index: "files: {{n}}",
    sitemapEntries_urlset: "URLs: {{n}}",
    sitemapEntries_news: "articles: {{n}}",
    sitemapLastmod: "modified: {{value}}",
    sitemapNoIssues: "No issues",
    sitemapIssuesMore: "and {{n}} more",
    sitemapIssueLine: "line {{n}}",
    sitemapIssueCount: "occurrences: {{n}}",
    sitemapIssue_http: "HTTP {{value}} - the file is not available.",
    sitemapIssue_network:
      "No response (network error or timeout) - Search Console reports this as “General HTTP error”.",
    sitemapIssue_contentType: "Content type {{value}} instead of XML.",
    sitemapIssue_emptyBody: "Empty response.",
    sitemapIssue_malformed: "Invalid XML: {{value}}.",
    sitemapIssue_root: "Root “{{value}}” instead of urlset or sitemapindex.",
    sitemapIssue_namespace: "Root without the sitemaps.org 0.9 namespace.",
    sitemapIssue_undeclaredPrefix:
      "Prefix “{{value}}:” used without an xmlns:{{value}} declaration.",
    sitemapIssue_missingTag: "Missing XML tag: {{tag}} (parent tag: {{parent}}).",
    sitemapIssue_duplicateTag: "Repeated tag {{tag}} in {{parent}}.",
    sitemapIssue_invalidLoc: "Invalid URL: {{value}}.",
    sitemapIssue_foreignHost: "URL outside the sitemap's host: {{value}}.",
    sitemapIssue_invalidDate: "Invalid date in {{tag}}: {{value}}.",
    sitemapIssue_futureDate: "Future date in {{tag}}: {{value}}.",
    sitemapIssue_invalidChangefreq: "Invalid changefreq value: {{value}}.",
    sitemapIssue_invalidPriority: "Invalid priority value: {{value}}.",
    sitemapIssue_tooManyEntries: "Entries: {{value}} - the per-file limit is 50,000.",
    sitemapIssue_tooLarge: "Size {{value}} B - the per-file limit is 50 MB.",
    sitemapIssue_duplicateLoc: "Duplicate URL: {{value}}.",
    sitemapIssue_newsTooMany: "Articles: {{value}} - the Google News limit is 1,000.",
    sitemapIssue_newsLanguage: "Language code outside ISO 639: {{value}}.",
    sitemapIssue_newsStale:
      "Google News metadata on an article older than 48 h ({{value}}) - Google recommends removing it.",
    sitemapIssue_newsAnchor:
      "No articles from the last 48 h - the file carries the newest URL ({{value}}) without News metadata, as Google recommends. New items will appear once published.",
    sitemapGoogleLink: "Status in Google and sitemap submission",
    // --- Sitemaps in Google (Search Console tab) ---
    gscSitemapsTitle: "Sitemaps in Google",
    gscSitemapsIntro:
      "What Google did with the sitemaps: when it last fetched them, whether it found errors and how many URLs it read. After fixing a sitemap, submit it again - Google fetches it anew and refreshes the report.",
    gscSubmitIndex: "Submit sitemap to Google",
    gscResubmit: "Resubmit",
    gscSubmitting: "Submitting…",
    gscSubmitted:
      "Submitted to Google: {{value}}. Google fetches the file within minutes to a few hours.",
    gscSubmit_notConfigured: "The Search Console connector is not connected.",
    gscSubmit_permission:
      "The connector account cannot submit sitemaps for this property. In Search Console (Settings → Users and permissions) give it “Full” permission and reconnect the connector with write access. Until then submit the sitemap manually: Sitemaps → sitemap.xml → Resubmit.",
    gscSubmit_notFound:
      "Google does not know this property or file - check that the property is verified.",
    gscOpenReport: "Open the report in Search Console",
    gscSitemapsLoadFailed: "Could not read the sitemap status from Google.",
    gscIndexMissing:
      "The index {{value}} is not submitted to this property - submit it so Google reads every sitemap file.",
    gscColSitemap: "Sitemap",
    gscColRead: "Google read",
    gscColState: "Status",
    gscColUrls: "URLs",
    gscIndexLabel: "Sitemap index",
    gscState_ok: "Success",
    gscState_errors: "Errors: {{n}}",
    gscState_warnings: "Warnings: {{n}}",
    gscState_pending: "Waiting to be fetched",
    gscState_never: "Not fetched",
    gscNoSitemaps: "Google has no sitemap for this property yet.",
    gscSubmitNote:
      "The status comes from Search Console and refreshes only after Google fetches the file again - a freshly fixed sitemap may still show the old error.",
    foundationRobotsSitemaps: "Sitemap declarations in the file: {{value}}.",
    foundationRobotsNoSitemap: "The file does not point to a sitemap (no Sitemap: entry).",
    foundationLlmsPresent: "The AI assistant guide is published.",
    foundationLlmsDisabled: "Disabled in the technical SEO settings.",
    foundationLangPresent: 'The homepage declares lang="{{value}}".',
    foundationLangMissing: "The html tag has no lang attribute.",
    // --- Tenant's public origin (foundation card, previews, live links) ---
    foundationCrossHost: "Cannot be checked from this host - open the file on {{value}}.",
    foundationCrossHostNote:
      "The panel is open on a host other than {{value}}. The browser cannot read this site's files from here, so the card does not assess them - check them with the “Open” link.",
    foundationOriginFailed:
      "The site's public domain could not be determined, so the card does not check the files - otherwise it would show another site's files.",
    foundationOriginRetry: "Try again",
    noPublicDomain:
      "This site does not have its own public domain yet. Addresses, validator links and file status will appear once a domain is assigned.",
    noPublicDomainHost: "(no domain)",
    allGood: "No problems - the brand setup is complete.",
    fixIt: "Fix",
    openHomepage: "Open the homepage tab",
    openSocial: "Open social cards",
    openContent: "Open the content list",
    contentSummary: "{{done}} of {{total}} items have both descriptions and their own card.",
    shortcutRobotsHint: "Crawler rules, including the AI-crawler policy.",
    shortcutSitemapHint: "The map of pages and posts for search engines.",
    shortcutLlmsHint: "A site guide for AI assistants.",
    shortcutSettings: "Technical settings",
    shortcutSettingsHint: "Feeds, structured data, AI crawlers, title suffix.",
    shortcutRedirects: "Redirects",
    shortcutRedirectsHint: "Old addresses that should lead to new ones.",
    sectionFiles: "Generated files",
    filesIntro:
      "The site's global machine-readable files (sitemaps, RSS feeds, llms.txt, robots.txt). The list comes from the same registry llms.txt uses, so a new global file appears here automatically. Category, tag and podcast feeds and sitemap shards are announced in the sitemap index and in their pages' head.",
    fileOpenEn: "Open EN",
    sectionPrimaryNav: "Main section order",
    primaryNavIntro:
      "The sections the homepage declares in structured data as the most important, in this order - llms.txt publishes the same list. Google picks sitelinks automatically from the site's link structure: which sections stand a chance depends mainly on the links in the header menu and the footer (Appearance → Menu).",
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
