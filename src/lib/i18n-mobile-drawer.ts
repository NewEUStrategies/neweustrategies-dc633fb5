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
  },
};

i18n.addResourceBundle("pl", "translation", pl, true, true);
i18n.addResourceBundle("en", "translation", en, true, true);

export {};
