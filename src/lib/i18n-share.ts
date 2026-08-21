// Słownik powierzchni udostępniania i paska czytania (PL/EN).
//
// SKĄD SIĘ WZIĄŁ. Te napisy stały w mapach `COPY = { pl, en }` wpisanych wprost
// w `FloatingShareBar.tsx` i `ReadingHeader.tsx` - dokładnie ten sam dług, który
// `i18n-post-experience.ts` zdjął z pięciu komponentów wpisu. Obiekt z dwoma
// gałęziami językowymi jest dla bramek NIEWIDZIALNY: to nie ternary po języku
// (którego szuka `check:i18n-hardcoded`) ani klucz (którego szuka
// `check:i18n-parity`), więc trzeci język wymagałby dotknięcia komponentów,
// a nie słownika. Nazwy kanałów udostępniania to jedno z trzech miejsc, w których
// literały żyją w tym repo najdłużej.
//
// JĘZYK: napisy paska udostępniania idą w języku ARTYKUŁU (prop `lang`), nie
// interfejsu - udostępniany jest TEN tekst, więc etykieta kanału musi mówić jego
// językiem także wtedy, gdy czytelnik ma interfejs w drugim. Wywołania podają
// jawne `{ lng: lang }` (wzorzec `i18n-post-experience.ts`).
//
// OSOBNA NAKŁADKA, NIE `locale/pl.ts`: rdzeń wchodzi do bundla KAŻDEJ strony,
// a te napisy są potrzebne na treści długiej i w powłoce czytania. Import jako
// efekt uboczny w komponencie trzyma słownik w chunku, który go czyta.
//
// MARKI ZOSTAJĄ LITERAŁAMI: "Facebook", "LinkedIn", "X", "WhatsApp", "Telegram",
// "Reddit" to nazwy własne - nie tłumaczy się ich i nie mają wersji językowej.
// W słowniku są tylko dlatego, że etykieta kanału jest odczytywana z jednego
// miejsca; wartość PL i EN jest tu celowo IDENTYCZNA.
import i18n from "./i18n";

const pl = {
  share: {
    bar: {
      share: "Udostępnij",
      copy: "Skopiuj link",
      copied: "Skopiowano link!",
      toc: "Spis treści",
      tocTitle: "SPIS TREŚCI",
      progress: "Postęp czytania",
      printPdf: "Drukuj / PDF",
      actions: "Akcje",
      read: "przeczytano",
    },
    channel: {
      x: "X",
      facebook: "Facebook",
      linkedin: "LinkedIn",
      mail: "E-mail",
      whatsapp: "WhatsApp",
      telegram: "Telegram",
      reddit: "Reddit",
    },
    header: {
      reading: "aktualnie czytasz",
      search: "Szukaj",
      login: "Zaloguj",
      register: "Zarejestruj",
      profile: "Profil",
      account: "Konto",
      bookmarks: "Zapisane",
      settings: "Ustawienia",
      logout: "Wyloguj",
      lang: "Język",
      menu: "Menu konta",
    },
  },
};

const en = {
  share: {
    bar: {
      share: "Share",
      copy: "Copy link",
      copied: "Link copied!",
      toc: "On this page",
      tocTitle: "ON THIS PAGE",
      progress: "Reading progress",
      printPdf: "Print / PDF",
      actions: "Actions",
      read: "read",
    },
    channel: {
      x: "X",
      facebook: "Facebook",
      linkedin: "LinkedIn",
      mail: "Email",
      whatsapp: "WhatsApp",
      telegram: "Telegram",
      reddit: "Reddit",
    },
    header: {
      reading: "currently reading",
      search: "Search",
      login: "Sign in",
      register: "Sign up",
      profile: "Profile",
      account: "Account",
      bookmarks: "Bookmarks",
      settings: "Settings",
      logout: "Sign out",
      lang: "Language",
      menu: "Account menu",
    },
  },
};

i18n.addResourceBundle("pl", "translation", pl, true, true);
i18n.addResourceBundle("en", "translation", en, true, true);

export {};
