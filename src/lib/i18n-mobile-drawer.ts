// Słownik szuflady mobilnej (PL/EN) - pas narzędzi, sekcja konta, nawigacja.
// Import jako efekt uboczny w komponentach `components/header/mobile/*`.
//
// PO CO POWSTAŁ. Cała szuflada przekazywała `isPl: boolean` w dół przez cztery
// komponenty, a każdy z nich odtwarzał u siebie
// `const t = (pl, en) => (isPl ? pl : en)` - bliźniaka nazwanego jak funkcja
// tłumacząca. Napisy nie istniały w słowniku, a prop `isPl` niósł przez pół
// drzewa informację, którą każdy komponent może wziąć sam z `useLang()`.
import i18n from "./i18n";

const pl = {
  mobileDrawer: {
    tools: "Narzędzia",
    openSearch: "Otwórz wyszukiwarkę",
    toggleTheme: "Przełącz motyw",
    language: "Język",
    account: "Konto",
    myAccount: "Moje konto",
    signOut: "Wyloguj",
    signIn: "Zaloguj",
    register: "Zarejestruj",
    navigation: "Nawigacja",
    // Panel super-admina konfigurujący tę szufladę (/admin/super/mobile-drawer).
    // Niósł własny bliźniak `t(pl, en)` w dwóch komponentach - te same napisy,
    // dwa razy poza słownikiem.
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

const en = {
  mobileDrawer: {
    tools: "Tools",
    openSearch: "Open search",
    toggleTheme: "Toggle theme",
    language: "Language",
    account: "Account",
    myAccount: "My account",
    signOut: "Sign out",
    signIn: "Sign in",
    register: "Register",
    navigation: "Navigation",
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

i18n.addResourceBundle("pl", "translation", pl, true, true);
i18n.addResourceBundle("en", "translation", en, true, true);

/**
 * No-op wołany w KOMPONENCIE trasy (nie side-effectowym importem w pliku
 * trasy): route splitter przenosi wtedy import razem z komponentem do jego
 * chunku, a rejestracja (addResourceBundle wyżej) uruchamia się przy
 * załadowaniu tego chunku - słownik nie wchodzi do chunku wejściowego
 * KAŻDEJ strony. Wzorzec: i18n-club.ts / i18n-network.ts.
 */
export function ensureI18n(): void {}
