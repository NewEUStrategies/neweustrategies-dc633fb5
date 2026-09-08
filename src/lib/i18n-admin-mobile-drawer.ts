// Loaded with its owning surface, outside the public boot closure.
import i18n from "i18next";
const pl = {
  mobileDrawer: {
    admin: {
      badge: "Super-admin",
      title: "Mobilne menu",
      subtitle: "Uporządkuj bloki mobilnego drawera i zdefiniuj pozycje nawigacji.",
      navEmpty: "Brak pozycji - sekcja nawigacji nie pokaże się w drawerze.",
      blockOrder: "Kolejność bloków",
      missingBlocks: "Brakujące bloki: ",
      topTools: "Górny pas narzędzi",
      toolSearch: "Wyszukiwarka",
      toolTheme: "Motyw",
      toolLanguage: "Język",
      navItems: "Pozycje nawigacji",
      add: "Dodaj",
      newItem: "Nowa pozycja",
      save: "Zapisz",
      saved: "Zapisano.",
      saveError: "Błąd zapisu",
      resetDefaults: "Przywróć domyślne",
      labelPl: "Etykieta PL",
      labelEn: "Etykieta EN",
      url: "URL (/ ścieżka lub https://...)",
      icon: "Ikona",
      enabled: "Aktywny",
      remove: "Usuń",
    },
  },
};
const en: typeof pl = {
  mobileDrawer: {
    admin: {
      badge: "Super-admin",
      title: "Mobile menu",
      subtitle: "Reorder mobile drawer blocks and define navigation items.",
      navEmpty: "No items - the navigation section will be hidden in the drawer.",
      blockOrder: "Block order",
      missingBlocks: "Missing blocks: ",
      topTools: "Top tools",
      toolSearch: "Search",
      toolTheme: "Theme",
      toolLanguage: "Language",
      navItems: "Navigation items",
      add: "Add",
      newItem: "New item",
      save: "Save",
      saved: "Saved.",
      saveError: "Save error",
      resetDefaults: "Reset to defaults",
      labelPl: "Label PL",
      labelEn: "Label EN",
      url: "URL (/path or https://...)",
      icon: "Icon",
      enabled: "Enabled",
      remove: "Remove",
    },
  },
};
function register(): void {
  i18n.addResourceBundle("pl", "translation", pl, true, true);
  i18n.addResourceBundle("en", "translation", en, true, true);
}
if (i18n.isInitialized) register();
else i18n.on("initialized", register);
export function ensureI18n(): void {}
