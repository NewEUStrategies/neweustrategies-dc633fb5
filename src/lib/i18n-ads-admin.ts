import i18n from "./i18n";

// Słownik panelu reklam (/admin/ads), PL/EN.
//
// STAN ZASTANY. Ten plik był overlayem na jedną sekcję (targetowanie) i mówił to
// wprost: „reszta panelu jest historycznie po polsku". Reszta to były 53 twarde
// napisy w `admin.ads.tsx` przy 15 wywołaniach `t()` oraz trzy mapy etykiet
// w `lib/ads/types.ts` z polskimi wartościami - czyli cały panel zarządzania
// reklamami działał w jednym języku bez względu na wybór interfejsu. Audyt
// modułu 14 nazwał to „mieszanką twardych PL i t()" (pozycja 14.8).
//
// TERAZ. Jedno źródło prawdy dla całego panelu. Mapy w `types.ts` wskazują
// klucze z tego pliku, więc typ `Record<AdPosition, string>` nadal wymusza
// kompletność wariantów enuma, a test pokrycia pilnuje, że każdy klucz istnieje
// w obu językach.

const pl = {
  adsAdmin: {
    title: "Reklamy",
    subtitle: "Sloty reklamowe (HTML/skrypt/grafika) i ich rozmieszczenie na stronach.",
    tabs: {
      slots: "Sloty",
      placements: "Rozmieszczenie",
      stats: "Statystyki",
    },

    // Sekcja targetowania - jedyna, która miała i18n przed 12.08.
    targetingTitle: "Targetowanie",
    targetingHint:
      "Puste pole = brak ograniczenia. Slot z wybranymi kategoriami lub tagami emituje się tylko przy pasującej treści (wystarczy trafienie w kategorię LUB tag).",
    categories: "Kategorie",
    tags: "Tagi",
    languages: "Wersje językowe",
    summaryAll: "Wszyscy",
    summaryCategories: "kat.",
    summaryTags: "tagi",
    columnTargeting: "Targeting",

    positions: {
      headerBanner: "Baner w nagłówku",
      topOfPost: "Nad treścią wpisu",
      midPost: "W środku wpisu (po N paragrafie)",
      bottomOfPost: "Pod treścią wpisu",
      sidebar: "Sidebar",
      inFeed: "W feedzie (co N kart)",
      footerSlideup: "Slide-up w stopce",
    },
    pageTypes: {
      all: "Wszystkie strony",
      home: "Strona główna",
      post: "Wpisy",
      page: "Strony statyczne",
      category: "Kategorie",
      tag: "Tagi",
      archive: "Archiwa",
      search: "Wyniki wyszukiwania",
      event: "Strony wydarzeń",
    },
    kinds: {
      html: "HTML (banner kodowy)",
      script: "Skrypt (np. AdSense)",
      image: "Grafika z linkiem",
    },

    slots: {
      columnName: "Nazwa",
      columnKind: "Typ",
      columnStatus: "Status",
      columnConsent: "Zgoda",
      statusActive: "Aktywny",
      statusPaused: "Wstrzymany",
      consentRequired: "Wymaga",
      consentNotRequired: "Nie",
      addTitle: "Nowy slot",
      editTitle: "Edytuj slot",
      addAction: "Dodaj slot",
      fieldName: "Nazwa",
      fieldKind: "Typ",
      fieldHtml: "Kod HTML",
      fieldClickUrl: "Link kliknięcia",
      fieldAlt: "Alt (dla dostępności)",
      fieldWidth: "Szerokość (px)",
      fieldHeight: "Wysokość (px)",
      fieldActive: "Aktywny",
      fieldNotes: "Notatki wewnętrzne",
      nameRequired: "Nazwa jest wymagana",
      deleteTitle: "Usunąć slot?",
      deleteBody: "Wszystkie powiązane pozycje również znikną.",
    },

    placements: {
      columnPosition: "Pozycja",
      columnPages: "Strony",
      columnActive: "Aktywne",
      addTitle: "Nowa pozycja",
      editTitle: "Edytuj pozycję",
      addAction: "Dodaj pozycję",
      selectSlot: "Wybierz slot",
      selectSlotPlaceholder: "Wybierz slot...",
      fieldPosition: "Pozycja na stronie",
      fieldPageType: "Typ strony",
      fieldAfterParagraph: "Po którym paragrafie",
      fieldDelayMs: "Opóźnienie pojawienia się (ms)",
      fieldDismissible: "Można zamknąć",
      fieldStartsAt: "Aktywne od",
      fieldEndsAt: "Aktywne do",
      fieldActive: "Aktywne",
      deleteTitle: "Usunąć pozycję?",
    },

    stats: {
      impressions: "Wyświetlenia",
      clicks: "Kliknięcia",
      empty: "Brak danych.",
      loading: "Wczytywanie...",
    },

    save: "Zapisz",
    deleteConfirm: "Usuń",
  },
};

const en: typeof pl = {
  adsAdmin: {
    title: "Ads",
    subtitle: "Ad slots (HTML/script/image) and where they are placed on pages.",
    tabs: {
      slots: "Slots",
      placements: "Placements",
      stats: "Statistics",
    },

    targetingTitle: "Targeting",
    targetingHint:
      "Empty field = no restriction. A slot with selected categories or tags serves only on matching content (a category OR tag hit is enough).",
    categories: "Categories",
    tags: "Tags",
    languages: "Language versions",
    summaryAll: "Everyone",
    summaryCategories: "cat.",
    summaryTags: "tags",
    columnTargeting: "Targeting",

    positions: {
      headerBanner: "Header banner",
      topOfPost: "Above post content",
      midPost: "Mid post (after paragraph N)",
      bottomOfPost: "Below post content",
      sidebar: "Sidebar",
      inFeed: "In feed (every N cards)",
      footerSlideup: "Footer slide-up",
    },
    pageTypes: {
      all: "All pages",
      home: "Home page",
      post: "Posts",
      page: "Static pages",
      category: "Categories",
      tag: "Tags",
      archive: "Archives",
      search: "Search results",
      event: "Event pages",
    },
    kinds: {
      html: "HTML (code banner)",
      script: "Script (e.g. AdSense)",
      image: "Image with link",
    },

    slots: {
      columnName: "Name",
      columnKind: "Type",
      columnStatus: "Status",
      columnConsent: "Consent",
      statusActive: "Active",
      statusPaused: "Paused",
      consentRequired: "Required",
      consentNotRequired: "No",
      addTitle: "New slot",
      editTitle: "Edit slot",
      addAction: "Add slot",
      fieldName: "Name",
      fieldKind: "Type",
      fieldHtml: "HTML code",
      fieldClickUrl: "Click URL",
      fieldAlt: "Alt text (accessibility)",
      fieldWidth: "Width (px)",
      fieldHeight: "Height (px)",
      fieldActive: "Active",
      fieldNotes: "Internal notes",
      nameRequired: "Name is required",
      deleteTitle: "Delete the slot?",
      deleteBody: "All related placements will disappear as well.",
    },

    placements: {
      columnPosition: "Position",
      columnPages: "Pages",
      columnActive: "Active",
      addTitle: "New placement",
      editTitle: "Edit placement",
      addAction: "Add placement",
      selectSlot: "Select slot",
      selectSlotPlaceholder: "Select a slot...",
      fieldPosition: "Position on page",
      fieldPageType: "Page type",
      fieldAfterParagraph: "After which paragraph",
      fieldDelayMs: "Appearance delay (ms)",
      fieldDismissible: "Dismissible",
      fieldStartsAt: "Active from",
      fieldEndsAt: "Active until",
      fieldActive: "Active",
      deleteTitle: "Delete the placement?",
    },

    stats: {
      impressions: "Impressions",
      clicks: "Clicks",
      empty: "No data.",
      loading: "Loading...",
    },

    save: "Save",
    deleteConfirm: "Delete",
  },
};

export const adsAdminResources = { pl, en };

i18n.addResourceBundle("pl", "translation", pl, true, true);
i18n.addResourceBundle("en", "translation", en, true, true);

/**
 * No-op wołany w komponencie trasy zamiast side-effectowego importu modułu.
 * Nazwane wiązanie pozwala splitterowi TanStacka przenieść cały bundle
 * tłumaczeń do chunka trasy - side-effectowy import w pliku trasy lądował
 * w eager-owym grafie wejściowym każdej strony. Rejestracja dzieje się przy
 * ewaluacji modułu (przed renderem komponentu), dokładnie jak wcześniej.
 */
export function ensureI18n(): void {}
