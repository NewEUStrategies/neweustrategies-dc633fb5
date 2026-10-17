// Słownik dialogu wyboru/tworzenia firmy (`company.*`, PL/EN) - jedyny
// czytelnik to `components/profile/CompanyPickerDialog` na PUBLICZNEJ trasie
// `/profile` (edytor profilu i panel tożsamości).
//
// DLACZEGO OSOBNY PLIK. Do 2026-10-17 gałąź `company.*` siedziała
// w `i18n-admin-extras` (nakładka panelu/CRM, ~64 kB źródeł), a dialog
// rejestrował CAŁĄ tę nakładkę dla swoich 25 napisów. Ta jedna krawędź
// z `profile.index` czyniła słownik panelu publicznym w grafie chunków:
// `check:bundle` liczył 19,7 KB gzip kodu panelu do sumy PUBLIC (kronika
// `scripts/check-bundle-size.ts`, wpis XX). Klucze są PRZENIESIONE, nie
// skopiowane - jedno źródło każdego napisu (`i18nOverlayIntegrity.gate`).
import i18n from "./i18n";

export const companyPl = {
  company: {
    back: "Wróć do wyszukiwania",
    createDesc: "Wymagana jest tylko nazwa. Pozostałe dane możesz uzupełnić później.",
    createNamed: "Dodaj nową firmę:",
    createTitle: "Dodaj nową firmę",
    detach: "Odłącz firmę",
    errors: {
      createFailed: "Nie udało się dodać firmy",
      linkFailed: "Nie udało się przypisać firmy",
      nameRequired: "Nazwa jest wymagana",
    },
    fields: {
      address: "Adres",
      branch: "Oddział / dział",
      city: "Miasto",
      country: "Kraj",
      name: "Nazwa",
      phone: "Telefon",
      postalCode: "Kod pocztowy",
      website: "Strona WWW",
    },
    noMatches: "Brak dopasowań",
    pickDesc: "Wpisz nazwę firmy - podpowiedzi zaciągają się z CRM.",
    pickTitle: "Wybierz firmę",
    save: "Dodaj firmę",
    searchPh: "np. New European Strategies",
    startTyping: "Zacznij pisać, aby zobaczyć firmy",
    toast: {
      created: "Firma dodana",
      detached: "Firma odłączona",
      linked: "Firma przypisana",
    },
  },
};

export const companyEn = {
  company: {
    back: "Back to search",
    createDesc: "Only the name is required. You can fill in the rest later.",
    createNamed: "Add a new company:",
    createTitle: "Add a new company",
    detach: "Detach company",
    errors: {
      createFailed: "Failed to add company",
      linkFailed: "Failed to link company",
      nameRequired: "Name is required",
    },
    fields: {
      address: "Address",
      branch: "Branch / department",
      city: "City",
      country: "Country",
      name: "Name",
      phone: "Phone",
      postalCode: "Postal code",
      website: "Website",
    },
    noMatches: "No matches",
    pickDesc: "Enter a company name - suggestions are pulled from the CRM.",
    pickTitle: "Select a company",
    save: "Add company",
    searchPh: "e.g. New European Strategies",
    startTyping: "Start typing to see companies",
    toast: {
      created: "Company added",
      detached: "Company detached",
      linked: "Company linked",
    },
  },
};

// Explicit registration must survive both Vite and Nitro tree shaking.
// Keep the legacy side-effect import contract, and avoid repeated deep merges.
let registered = false;
export function ensureI18n(): void {
  if (registered) return;
  registered = true;
  i18n.addResourceBundle("pl", "translation", companyPl, true, true);
  i18n.addResourceBundle("en", "translation", companyEn, true, true);
}
ensureI18n();
