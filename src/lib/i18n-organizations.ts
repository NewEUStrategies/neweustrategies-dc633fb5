import i18n from "./i18n";

// Pakiet i18n publicznego profilu organizacji (/organization/$slug).
//
// PO CO OSOBNA NAKŁADKA. Organizacja jest termem taksonomii, ale jej strona nie
// jest archiwum: ma tożsamość (logo, branża, adres WWW), ludzi i dopiero potem
// listę treści. Klucze archiwum nie opisują żadnej z tych rzeczy, a wciągnięcie
// ich do rdzenia obciążyłoby każdą stronę serwisu słownikiem jednej trasy.
// Rejestrowana jako nakładka na bazowe i18n - importuje ją trasa i komponenty
// profilu (bramka `check:i18n-overlay-imports` tego pilnuje).

const pl = {
  organization: {
    // Nagłówek
    tagline: "Profil organizacji",
    breadcrumb: "Organizacje",
    // Pigułki meta - renderują się WYŁĄCZNIE przy niepustej wartości
    branch: "Branża",
    website: "Strona WWW",
    postsCount_one: "{{count}} publikacja",
    postsCount_few: "{{count}} publikacje",
    postsCount_many: "{{count}} publikacji",
    postsCount_other: "{{count}} publikacji",
    // Sekcje
    aboutHeading: "O organizacji",
    peopleHeading: "Osoby",
    verified: "Profil zweryfikowany",
    postsHeading: "Publikacje",
    postsEmpty: "Nie ma jeszcze publikacji powiązanych z tą organizacją.",
    // SEO
    seoDescriptionFallback: "{{name}} - profil organizacji w New European Strategies.",
    seoTitleSuffix: "organizacja",
    pageSuffix: "strona {{page}}",
    loadFailed: "Nie udało się załadować profilu organizacji",
  },
};

const en = {
  organization: {
    tagline: "Organization profile",
    breadcrumb: "Organizations",
    branch: "Industry",
    website: "Website",
    postsCount_one: "{{count}} publication",
    postsCount_other: "{{count}} publications",
    aboutHeading: "About",
    peopleHeading: "People",
    verified: "Verified profile",
    postsHeading: "Publications",
    postsEmpty: "No publications linked to this organization yet.",
    seoDescriptionFallback: "{{name}} - organization profile at New European Strategies.",
    seoTitleSuffix: "organization",
    pageSuffix: "page {{page}}",
    loadFailed: "Couldn't load the organization profile",
  },
};

i18n.addResourceBundle("pl", "translation", pl, true, true);
i18n.addResourceBundle("en", "translation", en, true, true);

export {};

/**
 * No-op wołany w komponencie zamiast side-effectowego importu modułu - ten sam
 * wzorzec co `i18n-experts`. Nazwane wiązanie pozwala splitterowi przenieść
 * słownik do chunka trasy, zamiast trzymać go w eager-owym grafie wejściowym.
 */
export function ensureI18n(): void {}
