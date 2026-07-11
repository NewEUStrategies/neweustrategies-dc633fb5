import i18n from "./i18n";

// Overlay dla sekcji targetowania w panelu reklam (/admin/ads).
// Reszta panelu jest historycznie po polsku - nowe stringi idą przez i18n.

const pl = {
  adsAdmin: {
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
  },
};

const en: typeof pl = {
  adsAdmin: {
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
  },
};

i18n.addResourceBundle("pl", "translation", pl, true, true);
i18n.addResourceBundle("en", "translation", en, true, true);

export {};
