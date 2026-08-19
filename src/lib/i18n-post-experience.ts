// Słownik doświadczenia czytelnika wpisu (PL/EN) - pasek cytatu, cytowanie
// analizy, nawigacja dossier, opinia o materiale i akcja pobrania.
//
// SKĄD SIĘ WZIĄŁ. Wszystkie te napisy stały w mapach `COPY = { pl, en }`
// wpisanych wprost w komponenty. Żadna bramka ich nie widziała: to nie ternary
// po języku (którego szuka `check:i18n-hardcoded`) ani klucz (którego szuka
// `check:i18n-parity`), tylko obiekt - tekst istniał wyłącznie w kodzie i nikt
// nie wiedział, że istnieje. Trzeci język wymagałby dotknięcia pięciu
// komponentów, a nie jednego pliku.
//
// JĘZYK: te napisy idą w języku ARTYKUŁU, nie interfejsu. Cytowanie i cytat
// dotyczą TEJ treści, więc muszą mówić jej językiem także wtedy, gdy czytelnik
// ma interfejs w drugim. Wywołania podają jawne `{ lng: lang }`.
//
// OSOBNA NAKŁADKA, NIE `locale/pl.ts`: rdzeń wchodzi do bundla KAŻDEJ strony,
// a te napisy są potrzebne wyłącznie na wpisie. Import jako efekt uboczny
// w komponencie trzyma słownik w chunku, który go czyta (wzorzec
// `i18n-tts-player.ts`).
import i18n from "./i18n";

const pl = {
  postExperience: {
    quoteShare: {
      region: "Udostępnij zaznaczony cytat",
      shareX: "Udostępnij cytat na X",
      shareLinkedin: "Udostępnij na LinkedIn",
      copy: "Kopiuj cytat",
      copied: "Skopiowano cytat",
    },
    citation: {
      heading: "Cytuj tę analizę",
      copy: "Kopiuj",
      copied: "Skopiowano",
      copyAria: "Kopiuj cytowanie w formacie",
    },
    series: {
      series: "Dossier",
      part: "część",
      of: "z",
      prev: "Poprzednia część",
      next: "Następna część",
    },
    feedback: {
      question: "Czy ta analiza była przydatna?",
      yes: "Tak, przydatna",
      no: "Nie",
      thanks: "Dziękujemy za opinię.",
    },
    actions: {
      download: "Pobierz artykuł",
    },
  },
};

const en = {
  postExperience: {
    quoteShare: {
      region: "Share selected quote",
      shareX: "Share quote on X",
      shareLinkedin: "Share on LinkedIn",
      copy: "Copy quote",
      copied: "Quote copied",
    },
    citation: {
      heading: "Cite this analysis",
      copy: "Copy",
      copied: "Copied",
      copyAria: "Copy citation in format",
    },
    series: {
      series: "Dossier",
      part: "part",
      of: "of",
      prev: "Previous part",
      next: "Next part",
    },
    feedback: {
      question: "Was this analysis useful?",
      yes: "Yes, useful",
      no: "No",
      thanks: "Thank you for your feedback.",
    },
    actions: {
      download: "Download article",
    },
  },
};

i18n.addResourceBundle("pl", "translation", pl, true, true);
i18n.addResourceBundle("en", "translation", en, true, true);

export {};
