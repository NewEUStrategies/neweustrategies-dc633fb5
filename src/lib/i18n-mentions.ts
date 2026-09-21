import i18n from "./i18n";

// Overlay dla UI @wzmianek (podpowiedzi w kompozytorze komentarza). Backend
// (process_mentions) już generuje notyfikacje - te stringi obsługują wyłącznie
// warstwę interfejsu (typeahead + etykiety dostępności), w PL i EN.

const pl = {
  mentions: {
    // Etykieta listy podpowiedzi (aria) + stan pusty/ładowania.
    listLabel: "Podpowiedzi osób i firm do wspomnienia",
    hint: "Wpisz @, aby wspomnieć osobę albo firmę",
    loading: "Szukam osób i firm...",
    empty: "Brak pasujących osób lub firm",
    person: "Osoba",
    organization: "Firma",
    // Tekst czytany przez czytniki ekranu przy wyborze celu.
    inserted: "Wspomniano: {{name}}",
    // Wizytówka pod wzmianką w treści (dymek po najechaniu).
    noProfile: "Nie znaleziono takiego profilu.",
    viewProfile: "Zobacz profil",
    verified: "Profil zweryfikowany",
    viewOrg: "Zobacz organizację",
  },
};

const en: typeof pl = {
  mentions: {
    listLabel: "People and company suggestions to mention",
    hint: "Type @ to mention a person or company",
    loading: "Searching people and companies...",
    empty: "No matching people or companies",
    person: "Person",
    organization: "Company",
    inserted: "Mentioned: {{name}}",
    noProfile: "No such profile found.",
    viewProfile: "View profile",
    verified: "Verified profile",
    viewOrg: "View organisation",
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
