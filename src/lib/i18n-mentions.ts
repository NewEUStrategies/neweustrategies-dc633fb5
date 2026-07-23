import i18n from "./i18n";

// Overlay dla UI @wzmianek (podpowiedzi w kompozytorze komentarza). Backend
// (process_mentions) już generuje notyfikacje - te stringi obsługują wyłącznie
// warstwę interfejsu (typeahead + etykiety dostępności), w PL i EN.

const pl = {
  mentions: {
    // Etykieta listy podpowiedzi (aria) + stan pusty/ładowania.
    listLabel: "Podpowiedzi osób do wspomnienia",
    hint: "Wpisz @, aby wspomnieć osobę",
    loading: "Szukam osób...",
    empty: "Brak pasujących osób",
    // Tekst czytany przez czytniki ekranu przy wyborze osoby.
    inserted: "Wspomniano: {{name}}",
  },
};

const en: typeof pl = {
  mentions: {
    listLabel: "People suggestions to mention",
    hint: "Type @ to mention someone",
    loading: "Searching people...",
    empty: "No matching people",
    inserted: "Mentioned: {{name}}",
  },
};

i18n.addResourceBundle("pl", "translation", pl, true, true);
i18n.addResourceBundle("en", "translation", en, true, true);

export {};

/**
 * No-op wołany w komponencie zamiast side-effectowego importu modułu. Nazwane
 * wiązanie pozwala splitterowi TanStacka utrzymać rejestrację tłumaczeń w
 * chunku konsumenta (rejestracja dzieje się przy ewaluacji modułu, przed
 * renderem), dokładnie jak w pozostałych bundlach i18n-*.
 */
export function ensureI18n(): void {}
