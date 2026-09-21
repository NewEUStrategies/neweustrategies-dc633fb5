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

export {};

// Explicit registration must survive both Vite and Nitro tree shaking.
// Keep the legacy side-effect import contract, and avoid repeated deep merges.
let registered = false;
export function ensureI18n(): void {
  if (registered) return;
  registered = true;
  i18n.addResourceBundle("pl", "translation", pl, true, true);
  i18n.addResourceBundle("en", "translation", en, true, true);
}
ensureI18n();
