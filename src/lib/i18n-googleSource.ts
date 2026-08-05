// i18n dla badge „Preferowane źródło w Google" (PL/EN). Mały, osobny bundle -
// ładowany tylko przez komponent badge, tak jak i18n-gifting.
import i18n from "./i18n";

const pl = {
  googleSource: {
    badgeTitle: "Wskaż nas jako swoje",
    badgeSub: "preferowane źródło w Google",
    badgeLabel: "Wskaż {{site}} jako swoje preferowane źródło w Wyszukiwarce Google",
  },
};

const en = {
  googleSource: {
    badgeTitle: "Recommend us as your",
    badgeSub: "preferred source on Google",
    badgeLabel: "Recommend {{site}} as your preferred source on Google Search",
  },
};

i18n.addResourceBundle("pl", "translation", pl, true, true);
i18n.addResourceBundle("en", "translation", en, true, true);

export {};
