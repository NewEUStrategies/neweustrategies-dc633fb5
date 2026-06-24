// Command palette i18n bundle (PL/EN). Loaded once on import.
import i18n from "./i18n";

const pl = {
  palette: {
    placeholder: "Wyszukaj strony, akcje, ustawienia...",
    empty: "Brak wyników dla \"{{q}}\".",
    empty_hint: "Spróbuj innej frazy lub kategorii.",
    suggestions: "Popularne",
    type_to_search: "Wpisz co najmniej 2 znaki, aby przeszukać treści.",
    loading: "Szukam treści...",
    sections: {
      navigation: "Nawigacja",
      admin: "Administracja",
      settings: "Ustawienia",
      appearance: "Wygląd",
      account: "Konto",
      actions: "Akcje",
      content: "Treści",
    },
    shortcut_hint: "Otwórz: ⌘K / Ctrl+K",
  },
};
const en = {
  palette: {
    placeholder: "Search pages, actions, settings...",
    empty: "No results for \"{{q}}\".",
    empty_hint: "Try a different phrase or category.",
    suggestions: "Popular",
    type_to_search: "Type at least 2 characters to search content.",
    loading: "Searching content...",
    sections: {
      navigation: "Navigation",
      admin: "Admin",
      settings: "Settings",
      appearance: "Appearance",
      account: "Account",
      actions: "Actions",
      content: "Content",
    },
    shortcut_hint: "Open: ⌘K / Ctrl+K",
  },
};

i18n.addResourceBundle("pl", "translation", pl, true, true);
i18n.addResourceBundle("en", "translation", en, true, true);
