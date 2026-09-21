// Napisy widgetu "Zespół (siatka)" (`team-member-grid`) - PL/EN.
//
// DLACZEGO OSOBNA NAKŁADKA, A NIE `lang === "pl" ? … : …` W RENDERERZE.
// Starszy `team-member` trzyma swoje cztery napisy jako bliźniaki w kodzie i
// figuruje przez to w baseline'ie `check:i18n-hardcoded`. Ten widget rysuje
// PEŁNĄ kartotekę osoby (rola, afiliacja, projekty, kontakt, social media),
// czyli kilkanaście etykiet - wpisane w kod dosypałyby do tamtego długu
// kilkanaście pozycji naraz, a bramka `monolingualUserText` wymaga od NOWEGO
// pliku zera. Słownik jest tu więc warunkiem wejścia, nie ozdobą.
//
// JĘZYK NAPISU IDZIE ZA `lang` WIDGETU, NIE ZA JĘZYKIEM INTERFEJSU. Renderer
// woła `t(key, { lng: lang })` (ten sam wzorzec co `PostFeedback` i reszta
// `postExperience.*`), bo w kanwie buildera redaktor przełącza język TREŚCI
// niezależnie od języka panelu - etykieta "Kontakt" musi wtedy pojechać za
// kartą, a nie za paskiem narzędzi.
//
// Prefiks `teamGrid` stoi pod twardą bramką parytetu
// (`src/__tests__/i18nParity.gate.test.ts`): brak klucza po jednej stronie
// czerwieni CI, zamiast wypuścić surowy klucz na publiczną kartę osoby.
import i18n from "./i18n";

export const teamGridPl = {
  teamGrid: {
    // Karta w siatce
    cardHint: "Zobacz pełny profil",
    // Nagłówki sekcji w oknie osoby
    dialog: {
      about: "Biogram",
      role: "Rola w New European Strategies",
      affiliation: "Afiliacja",
      projects: "Przynależność projektowa",
      contact: "Dane kontaktowe",
      social: "Media społecznościowe",
      email: "E-mail",
      phone: "Telefon",
      profileLink: "Zobacz pełny profil eksperta",
      // Opis okna dla czytników ekranu, gdy osoba nie ma wpisanej roli.
      fallbackDescription: "Karta osoby z zespołu",
    },
    // Puste stany widoczne wyłącznie w kanwie buildera - na stronie publicznej
    // widget bez osób nie renderuje niczego (patrz komentarz w rendererze).
    empty: "Dodaj osoby w panelu po prawej stronie.",
  },
};

export const teamGridEn = {
  teamGrid: {
    cardHint: "View full profile",
    dialog: {
      about: "Biography",
      role: "Role at New European Strategies",
      affiliation: "Affiliation",
      projects: "Project affiliation",
      contact: "Contact details",
      social: "Social media",
      email: "Email",
      phone: "Phone",
      profileLink: "View full expert profile",
      fallbackDescription: "Team member card",
    },
    empty: "Add people in the panel on the right.",
  },
};

/** Rejestracja przy ewaluacji modułu; `ensureI18n()` zostaje dla importerów. */
let registered = false;
export function ensureI18n(): void {
  if (registered) return;
  registered = true;
  i18n.addResourceBundle("pl", "translation", teamGridPl, true, true);
  i18n.addResourceBundle("en", "translation", teamGridEn, true, true);
}
ensureI18n();
