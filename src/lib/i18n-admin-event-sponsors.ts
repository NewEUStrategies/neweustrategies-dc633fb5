// Słownik podmodułu SPONSORZY (Event Builder), PL/EN.
//
// DLACZEGO OSOBNY PLIK. Nakładki i18n są niepodzielne - trasa agendy nie musi
// wciągać etykiet poziomów sponsorskich, a trasa sponsorów nie potrzebuje
// słownika kolizji sesji.
//
// WARTOŚCI STANÓW SĄ WSPÓLNE Z BAZĄ: cztery role sponsora, cztery role kontaktu,
// pięć rodzajów materiałów i trzy rozmiary logo z migracji
// `20260823160000_event_sponsors_companies.sql`.
import i18n from "@/lib/i18n";

export const adminEventSponsorsPl = {
  adminEventSponsors: {
    nav: {
      sectionTitle: "Sponsorzy",
      sponsors: "Firmy",
      tiers: "Poziomy",
    },
    roles: {
      sponsor: "Sponsor",
      partner: "Partner",
      media_partner: "Patron medialny",
      exhibitor: "Wystawca",
    },
    contactRoles: {
      primary: "Kontakt główny",
      marketing: "Marketing",
      billing: "Rozliczenia",
      onsite: "Na miejscu",
    },
    materialKinds: {
      document: "Dokument",
      presentation: "Prezentacja",
      video: "Wideo",
      link: "Link",
      logo_pack: "Paczka logotypów",
    },
    logoSizes: {
      sm: "Małe",
      md: "Średnie",
      lg: "Duże",
    },
    filters: {
      all: "Wszystkie",
      published: "Opublikowane",
      draft: "Szkice",
      search: "Szukaj firmy",
      tier: "Poziom",
      role: "Rola",
    },
    labels: {
      tierLimit: "Limit firm",
      noLimit: "Bez limitu",
      crmDrift: "Dane rozjechały się z CRM",
      snapshotManual: "Migawka ręczna",
      snapshotCrm: "Migawka z CRM",
      contacts: "Kontakty",
      materials: "Materiały",
      booth: "Stanowisko",
      accentColor: "Kolor akcentu",
      benefits: "Korzyści",
      internalNote: "Notatka wewnętrzna",
    },
    actions: {
      addSponsor: "Dodaj firmę",
      addTier: "Dodaj poziom",
      publish: "Opublikuj",
      unpublish: "Wycofaj",
      refreshSnapshots: "Odśwież dane z CRM",
      includeManual: "Nadpisz też migawki ręczne",
    },
    errors: {
      unknown: "Nie udało się zapisać zmian. Spróbuj ponownie.",
      invalidNames: "Podaj nazwę poziomu po polsku i po angielsku.",
      invalidTitles: "Podaj tytuł materiału po polsku i po angielsku.",
      invalidUrl: "Podaj poprawny adres materiału (https:// lub /).",
      invalidKey: "Klucz poziomu może zawierać tylko małe litery, cyfry i podkreślenia.",
      invalidEvent: "Wybierz wydarzenie.",
      invalidCompany: "Wybierz firmę z CRM.",
      invalidRole: "Rola kontaktu musi być jedną z: główny, marketing, rozliczenia, na miejscu.",
      invalidPayload: "Nieprawidłowe dane żądania.",
      notFound: "Nie znaleziono rekordu w tym środowisku.",
      contactNotFound: "Ta osoba nie istnieje w CRM.",
      tierInUse: "Do tego poziomu przypięto jeszcze {{count}} firm(y) - najpierw je przenieś.",
      tierFull: "Poziom dopuszcza {{count}} firm(y), a przypiętych jest już {{total}}.",
      sponsorTierRequired: "Opublikowany sponsor musi mieć przypisany poziom.",
    },
  },
} as const;

export const adminEventSponsorsEn = {
  adminEventSponsors: {
    nav: {
      sectionTitle: "Sponsors",
      sponsors: "Companies",
      tiers: "Tiers",
    },
    roles: {
      sponsor: "Sponsor",
      partner: "Partner",
      media_partner: "Media partner",
      exhibitor: "Exhibitor",
    },
    contactRoles: {
      primary: "Primary contact",
      marketing: "Marketing",
      billing: "Billing",
      onsite: "On site",
    },
    materialKinds: {
      document: "Document",
      presentation: "Presentation",
      video: "Video",
      link: "Link",
      logo_pack: "Logo pack",
    },
    logoSizes: {
      sm: "Small",
      md: "Medium",
      lg: "Large",
    },
    filters: {
      all: "All",
      published: "Published",
      draft: "Drafts",
      search: "Search company",
      tier: "Tier",
      role: "Role",
    },
    labels: {
      tierLimit: "Company limit",
      noLimit: "No limit",
      crmDrift: "Data drifted from CRM",
      snapshotManual: "Manual snapshot",
      snapshotCrm: "CRM snapshot",
      contacts: "Contacts",
      materials: "Materials",
      booth: "Booth",
      accentColor: "Accent colour",
      benefits: "Benefits",
      internalNote: "Internal note",
    },
    actions: {
      addSponsor: "Add company",
      addTier: "Add tier",
      publish: "Publish",
      unpublish: "Unpublish",
      refreshSnapshots: "Refresh from CRM",
      includeManual: "Also overwrite manual snapshots",
    },
    errors: {
      unknown: "The changes could not be saved. Please try again.",
      invalidNames: "Provide the tier name in both Polish and English.",
      invalidTitles: "Provide the material title in both Polish and English.",
      invalidUrl: "Provide a valid material address (https:// or /).",
      invalidKey: "The tier key may only contain lowercase letters, digits and underscores.",
      invalidEvent: "Select an event.",
      invalidCompany: "Select a company from the CRM.",
      invalidRole: "The contact role must be primary, marketing, billing or on site.",
      invalidPayload: "Invalid request payload.",
      notFound: "The record does not exist in this environment.",
      contactNotFound: "This person does not exist in the CRM.",
      tierInUse: "{{count}} company(ies) are still pinned to this tier - move them first.",
      tierFull: "The tier allows {{count}} company(ies) and {{total}} are already pinned.",
      sponsorTierRequired: "A published sponsor must have a tier.",
    },
  },
} as const;

let registered = false;

/** Rejestruje nakładkę raz na sesję - `i18n.exists()` bez niej zwraca fałsz. */
export function ensureSponsorsI18n(): void {
  if (registered) return;
  i18n.addResourceBundle("pl", "translation", adminEventSponsorsPl, true, true);
  i18n.addResourceBundle("en", "translation", adminEventSponsorsEn, true, true);
  registered = true;
}
