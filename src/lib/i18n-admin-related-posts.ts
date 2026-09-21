// Zasoby i18n trasy /admin/related-posts (konfiguracja + wagi silnika rekomendacji).
import i18n from "@/lib/i18n";

const pl = {
  adminRelatedPosts: {
    pageTitle: "Powiązane wpisy",
    intro:
      "Globalna konfiguracja silnika rekomendacji dla tego obszaru roboczego + analiza sygnałów behawioralnych. Wpisy mogą nadpisać ustawienia indywidualnie.",
    tabs: {
      config: "Konfiguracja",
      engine: "Silnik (wagi)",
      analytics: "Analiza (BI)",
    },
    actions: {
      save: "Zapisz",
      saveWeights: "Zapisz wagi",
      saving: "Zapisywanie…",
    },
    toast: {
      saved: "Zapisano konfigurację powiązanych wpisów",
      noTenant: "Brak obszaru roboczego w kontekście - nie mogę zapisać. Zaloguj się ponownie.",
      tenantLookupFailed: "Nie udało się ustalić obszaru roboczego. Spróbuj ponownie.",
      writeFailed: "Błąd zapisu: {{msg}}",
      notPersisted:
        "Zapis nie został potwierdzony przez bazę - nic nie zmieniono. Odśwież stronę i spróbuj ponownie.",
    },
    fields: {
      enabled: "Włączone",
      enabledHint: "Renderuj sekcję pod wpisami",
      titlePl: "Tytuł (PL)",
      titleEn: "Tytuł (EN)",
      position: "Pozycja",
      afterParagraph: "Po którym paragrafie",
      itemsLimit: "Liczba wpisów",
      layout: "Layout",
      columns: "Kolumny (grid)",
      sourceStrategy: "Strategia źródła",
      layoutPreview: "Podgląd układu",
      layoutPreviewHint: "Kliknij miniaturę, aby wybrać układ",
      showCover: "Pokaż miniaturę",
      showExcerpt: "Pokaż zajawkę",
      showMeta: "Pokaż datę / meta",
      recencyBoostDays: "Bonus świeżości (dni)",
      sliderIntervalMs: "Interwał slidera (ms)",
      sliderAutoplay: "Autoplay",
      minScore: "Minimalny score",
      minScoreHint: "Kandydaci poniżej tej wartości nie wchodzą do listy - filtr jakości.",
      useIdf: "IDF (rzadkie terminy ważą więcej)",
      useIdfHint:
        "Kategoria lub tag dzielony przez WSZYSTKICH kandydatów nie pomaga ich uszeregować, więc waży mniej niż termin rzadki. Rzadkość liczy się w puli kandydatów danego wpisu, nie w całym serwisie. Uwaga: przełącznik zmienia SKALĘ wyniku, więc próg `min_score` może wymagać korekty.",
    },
    position: {
      end: "Na końcu wpisu",
      sidebar: "W sidebarze",
      afterParagraph: "Po paragrafie",
    },
    layout: {
      grid: "Grid",
      list: "Lista",
      slider: "Slider",
      cards: "Karty (kolor + ikona)",
      magazine: "Magazyn (hero + lista)",
      timeline: "Oś czasu",
    },
    source: {
      both: "Kategorie + Tagi",
      categories: "Tylko kategorie",
      tags: "Tylko tagi",
      author: "Ten sam autor",
    },
    engine: {
      heading: "Wagi silnika rekomendacji",
      intro:
        "Skala 0-10. Silnik składa wyniki: wspólne kategorie x waga + wspólne tagi x waga (opcjonalnie IDF) + autor + świeżość + popularność (post_views przez trending_posts) + personalizacja (historia czytania zalogowanego użytkownika, po zgodzie). Dwell czeka na źródło danych i jest wyłączony.",
      categories: "Wspólne kategorie",
      categoriesHint: "Klasyczny sygnał: ile kategorii dzielą wpisy",
      tags: "Wspólne tagi",
      tagsHint: "Bardziej granularne niż kategorie, świetny sygnał dla content-hubów",
      author: "Ten sam autor",
      authorHint: "W strategii „ten sam autor” waga jest podnoszona x4",
      recency: "Świeżość",
      recencyHint: "Bonus dla wpisów opublikowanych w oknie „bonus świeżości”",
      popularity: "Popularność (views)",
      popularityHint:
        "Bonus z odsłon w ostatnich 28 dniach, skalowany względem najpopularniejszego wpisu serwisu. Liczy się z listy 50 najczęściej czytanych - kandydat spoza niej dostaje 0.",
      dwell: "Dwell / czytania",
      dwellHint:
        "Bonus dla wpisów często dodawanych do historii czytania - zadziała, gdy powstanie źródło danych.",
      dwellInactive:
        "Nieaktywne: sygnał wymaga agregatu historii czytania wszystkich czytelników, a ta tabela jest widoczna wyłącznie dla właściciela wierszy. Waga jest zapisana i wróci do gry, gdy powstanie źródło.",
      personalization: "Personalizacja",
      personalizationHint:
        "Dopasowanie do profilu zainteresowań zalogowanego użytkownika (kategorie + tagi z historii). Działa wyłącznie po zgodzie na personalizację i przy braku sygnału GPC.",
    },
    notFound: "Nie znaleziono",
  },
};

const en = {
  adminRelatedPosts: {
    pageTitle: "Related posts",
    intro:
      "Workspace-wide recommendation engine configuration + behavioural signal analytics. Individual posts can override these settings.",
    tabs: {
      config: "Configuration",
      engine: "Engine (weights)",
      analytics: "Analytics (BI)",
    },
    actions: {
      save: "Save",
      saveWeights: "Save weights",
      saving: "Saving…",
    },
    toast: {
      saved: "Related posts configuration saved",
      noTenant: "No workspace in context - cannot save. Please sign in again.",
      tenantLookupFailed: "Could not resolve the workspace. Please try again.",
      writeFailed: "Save failed: {{msg}}",
      notPersisted:
        "The database did not confirm the write - nothing was changed. Reload the page and try again.",
    },
    fields: {
      enabled: "Enabled",
      enabledHint: "Render the section below posts",
      titlePl: "Title (PL)",
      titleEn: "Title (EN)",
      position: "Position",
      afterParagraph: "After which paragraph",
      itemsLimit: "Number of posts",
      layout: "Layout",
      columns: "Columns (grid)",
      sourceStrategy: "Source strategy",
      layoutPreview: "Layout preview",
      layoutPreviewHint: "Click a thumbnail to pick a layout",
      showCover: "Show thumbnail",
      showExcerpt: "Show excerpt",
      showMeta: "Show date / meta",
      recencyBoostDays: "Recency boost (days)",
      sliderIntervalMs: "Slider interval (ms)",
      sliderAutoplay: "Autoplay",
      minScore: "Minimum score",
      minScoreHint: "Candidates below this value are dropped - a quality filter.",
      useIdf: "IDF (rare terms weigh more)",
      useIdfHint:
        "A category or tag shared by EVERY candidate does not help rank them, so it weighs less than a rare one. Rarity is measured within the post's candidate pool, not the whole site. Note: this toggle changes the score SCALE, so `min_score` may need adjusting.",
    },
    position: {
      end: "At the end of the post",
      sidebar: "In the sidebar",
      afterParagraph: "After a paragraph",
    },
    layout: {
      grid: "Grid",
      list: "List",
      slider: "Slider",
      cards: "Cards (colour + icon)",
      magazine: "Magazine (hero + list)",
      timeline: "Timeline",
    },
    source: {
      both: "Categories + Tags",
      categories: "Categories only",
      tags: "Tags only",
      author: "Same author",
    },
    engine: {
      heading: "Recommendation engine weights",
      intro:
        "Scale 0-10. The engine combines: shared categories x weight + shared tags x weight (optionally IDF) + author + recency + popularity (post_views via trending_posts) + personalization (signed-in reader's history, with consent). Dwell is awaiting a data source and is disabled.",
      categories: "Shared categories",
      categoriesHint: "The classic signal: how many categories the posts share",
      tags: "Shared tags",
      tagsHint: "More granular than categories, a great signal for content hubs",
      author: "Same author",
      authorHint: "Under the “same author” strategy this weight is multiplied by 4",
      recency: "Recency",
      recencyHint: "Bonus for posts published inside the recency-boost window",
      popularity: "Popularity (views)",
      popularityHint:
        "Bonus from views over the last 28 days, scaled against the site's most-read post. Drawn from the top 50 most-read - a candidate outside it scores 0.",
      dwell: "Dwell / reads",
      dwellHint:
        "Bonus for posts often added to reading history - will apply once a data source exists.",
      dwellInactive:
        "Inactive: this signal needs an aggregate of every reader's reading history, and that table is visible only to the owner of its rows. The weight is stored and returns once a source exists.",
      personalization: "Personalization",
      personalizationHint:
        "Match against the signed-in reader's interest profile (categories + tags from history). Applies only with personalization consent and no GPC signal.",
    },
    notFound: "Not found",
  },
};

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
