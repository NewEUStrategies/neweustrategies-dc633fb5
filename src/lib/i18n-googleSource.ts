// i18n dla badge „Preferowane źródło w Google" (PL/EN). Mały, osobny bundle -
// ładowany tylko przez komponent badge, tak jak i18n-gifting.
import i18n from "./i18n";

const pl = {
  googleSource: {
    badgeTitle: "Preferowane źródło",
    badgeSub: "Ustaw nas w Google",
    badgeLabel: "Ustaw {{site}} jako preferowane źródło w Wyszukiwarce Google",
  },
};

const en = {
  googleSource: {
    badgeTitle: "Preferred source",
    badgeSub: "Set us in Google",
    badgeLabel: "Set {{site}} as a preferred source in Google Search",
  },
};

i18n.addResourceBundle("pl", "translation", pl, true, true);
i18n.addResourceBundle("en", "translation", en, true, true);

export {};
