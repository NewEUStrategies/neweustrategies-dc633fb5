// Loaded with its owning surface, outside the public boot closure.
import i18n from "i18next";
const pl = {
  searchOverlay: {
    placeholder: "Czego dzisiaj szukasz?",
    dialogLabel: "Wyszukiwarka",
    viewAllFor: "Zobacz wszystkie wyniki dla ",
    startTyping: "Zacznij pisać, aby wyszukać artykuły",
    hint: "Wpisz frazę - użyj cudzysłowów dla dokładnej frazy lub „-” aby wykluczyć słowo.",
    clear: "Wyczyść",
    close: "Zamknij",
    noResults: "Brak wyników",
    resultsLabel: "Wyniki wyszukiwania",
    tabs: {
      posts: "Wpisy",
      topics: "Tematyka",
      clubs: "Kluby",
      people: "Osoby",
      experts: "Eksperci",
      ariaLabel: "Kategorie wyników",
    },
    footerNavigate: "nawiguj",
    footerOpen: "otwórz",
    footerClose: "zamknij",
  },
};
const en: typeof pl = {
  searchOverlay: {
    placeholder: "What are you looking for today?",
    dialogLabel: "Search",
    viewAllFor: "View all results for ",
    startTyping: "Start typing to search articles",
    hint: 'Type a phrase - use quotation marks for an exact phrase, or "-" to exclude a word.',
    clear: "Clear",
    close: "Close",
    noResults: "No results",
    resultsLabel: "Search results",
    tabs: {
      posts: "Posts",
      topics: "Topics",
      clubs: "Clubs",
      people: "People",
      experts: "Experts",
      ariaLabel: "Result categories",
    },
    footerNavigate: "navigate",
    footerOpen: "open",
    footerClose: "close",
  },
};
function register(): void {
  i18n.addResourceBundle("pl", "translation", pl, true, true);
  i18n.addResourceBundle("en", "translation", en, true, true);
}
if (i18n.isInitialized) register();
else i18n.on("initialized", register);
export function ensureI18n(): void {}
