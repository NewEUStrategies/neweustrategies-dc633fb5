// i18n bundle for archive layout admin + public labels.
import i18n from "./i18n";

const pl = {
  archiveLayout: {
    categoryTab: "Archiwum kategorii",
    tagTab: "Archiwum tagów",
    pageTitleCategory: "Ustawienia archiwum kategorii",
    pageTitleTag: "Ustawienia archiwum tagów",
    pageDescription:
      "Wybierz układ i skonfiguruj sekcje wyświetlane na stronie archiwum. Ustawienia są globalne.",
    layoutHeader: "Wariant układu",
    layoutHint: "Wybierz jeden z 6 gotowych layoutów.",
    livePreview: "Podgląd na żywo",
    livePreviewHint: "Zmiany są widoczne przed zapisaniem",
    variants: {
      "1": "Minimal",
      "2": "Klasyczny",
      "3": "Magazyn",
      "4": "Hero",
      "5": "Ciemny",
      "6": "Bento",
    },
    sections: {
      display: "Wyświetlanie",
      grid: "Siatka wpisów",
      sidebar: "Sidebar",
      hero: "Nagłówek",
      extras: "Dodatkowe sekcje",
    },
    fields: {
      columns: "Liczba kolumn",
      listStyle: "Styl listy",
      postsPerPage: "Wpisy na stronie",
      heroBgStyle: "Tło nagłówka",
      sidebarPosition: "Pozycja sidebara",
      sidebarWidgets: "Widgety w sidebarze (kolejność)",
      showBreadcrumbs: "Pokaż okruszki",
      showHero: "Pokaż nagłówek hero",
      showDescription: "Pokaż opis",
      showFollow: "Pokaż przycisk obserwuj",
      showSidebar: "Pokaż sidebar",
      showFeaturedTop: "Pokaż wyróżniony wpis na górze",
      showRelatedTaxonomies: "Pokaż powiązane kategorie/tagi",
      showPodcasts: "Pokaż powiązane podcasty",
    },
    listStyles: { grid: "Siatka", list: "Lista", masonry: "Masonry" },
    positions: { left: "Lewa", right: "Prawa" },
    heroBg: {
      gradient: "Gradient",
      image: "Zdjęcie",
      solid: "Jednolity",
      pattern: "Wzór",
      mesh: "Mesh",
      minimal: "Minimalny",
    },
    widgets: {
      popular: "Popularne wpisy",
      related: "Powiązane kategorie",
      newsletter: "Newsletter",
      ads: "Reklamy",
    },
    save: "Zapisz ustawienia",
    saving: "Zapisywanie...",
    saved: "Ustawienia zapisane",
    saveError: "Nie udało się zapisać. Spróbuj ponownie.",
    previewOnSite: "Zobacz na stronie",
    breadcrumbs: {
      categories: "Kategorie",
      tags: "Tagi",
    },
    sidebarTitles: {
      popular: "Popularne",
      related: "Powiązane kategorie",
      newsletter: "Newsletter",
      ads: "Reklama",
    },
    moveUp: "W górę",
    moveDown: "W dół",
    toggleWidget: "Włącz/wyłącz",
  },
};

const en: typeof pl = {
  archiveLayout: {
    categoryTab: "Category archive",
    tagTab: "Tag archive",
    pageTitleCategory: "Category archive settings",
    pageTitleTag: "Tag archive settings",
    pageDescription:
      "Choose a layout and configure sections shown on the archive page. Settings are global.",
    layoutHeader: "Layout variant",
    layoutHint: "Pick one of 6 pre-built layouts.",
    livePreview: "Live preview",
    livePreviewHint: "Changes are visible before saving",
    variants: {
      "1": "Minimal",
      "2": "Classic",
      "3": "Magazine",
      "4": "Hero",
      "5": "Dark",
      "6": "Bento",
    },
    sections: {
      display: "Display",
      grid: "Post grid",
      sidebar: "Sidebar",
      hero: "Header",
      extras: "Extra sections",
    },
    fields: {
      columns: "Columns",
      listStyle: "List style",
      postsPerPage: "Posts per page",
      heroBgStyle: "Header background",
      sidebarPosition: "Sidebar position",
      sidebarWidgets: "Sidebar widgets (order)",
      showBreadcrumbs: "Show breadcrumbs",
      showHero: "Show hero header",
      showDescription: "Show description",
      showFollow: "Show follow button",
      showSidebar: "Show sidebar",
      showFeaturedTop: "Show featured post on top",
      showRelatedTaxonomies: "Show related categories/tags",
      showPodcasts: "Show related podcasts",
    },
    listStyles: { grid: "Grid", list: "List", masonry: "Masonry" },
    positions: { left: "Left", right: "Right" },
    heroBg: {
      gradient: "Gradient",
      image: "Image",
      solid: "Solid",
      pattern: "Pattern",
      mesh: "Mesh",
      minimal: "Minimal",
    },
    widgets: {
      popular: "Popular posts",
      related: "Related categories",
      newsletter: "Newsletter",
      ads: "Ads",
    },
    save: "Save settings",
    saving: "Saving...",
    saved: "Settings saved",
    saveError: "Save failed. Please retry.",
    previewOnSite: "Preview on site",
    breadcrumbs: {
      categories: "Categories",
      tags: "Tags",
    },
    sidebarTitles: {
      popular: "Popular",
      related: "Related categories",
      newsletter: "Newsletter",
      ads: "Ad",
    },
    moveUp: "Move up",
    moveDown: "Move down",
    toggleWidget: "Toggle",
  },
};

i18n.addResourceBundle("pl", "translation", pl, true, true);
i18n.addResourceBundle("en", "translation", en, true, true);

export {};

/**
 * No-op wołany w komponencie trasy zamiast side-effectowego importu modułu.
 * Nazwane wiązanie pozwala splitterowi TanStacka przenieść cały bundle
 * tłumaczeń do chunka trasy - side-effectowy import w pliku trasy lądował
 * w eager-owym grafie wejściowym każdej strony. Rejestracja dzieje się przy
 * ewaluacji modułu (przed renderem komponentu), dokładnie jak wcześniej.
 */
export function ensureI18n(): void {}
