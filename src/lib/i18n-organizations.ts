import i18n from "./i18n";
import { ORGANIZATION_PAGE_COPY } from "./queries/organizationTerm";

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
    // Z mapy `head()`: ten sam okruszek stoi w JSON-LD `BreadcrumbList`.
    breadcrumb: ORGANIZATION_PAGE_COPY.pl.breadcrumb,
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
    // Komunikat degradacji i tytuł ekranu błędu trasy. Teksty `head()` (tytuł,
    // opis zastępczy, numer strony) NIE mieszkają tutaj: `head()` nie ma `t()`
    // - patrz `ORGANIZATION_PAGE_COPY` w `queries/organizationTerm.ts`.
    loadFailed: "Nie udało się załadować profilu organizacji",
  },
};

const en = {
  organization: {
    tagline: "Organization profile",
    breadcrumb: ORGANIZATION_PAGE_COPY.en.breadcrumb,
    branch: "Industry",
    website: "Website",
    postsCount_one: "{{count}} publication",
    postsCount_other: "{{count}} publications",
    aboutHeading: "About",
    peopleHeading: "People",
    verified: "Verified profile",
    postsHeading: "Publications",
    postsEmpty: "No publications linked to this organization yet.",
    loadFailed: "Couldn't load the organization profile",
  },
};

/**
 * Jawna rejestracja wołana w komponencie - ten sam wzorzec co `i18n-experts`.
 * Nazwane wiązanie pozwala splitterowi przenieść słownik do chunka trasy,
 * a wywołanie w komponencie trzyma rejestrację przy życiu także wtedy, gdy
 * Vite albo Nitro wytrzęsą efekt uboczny modułu. Do 2026-10-02 `ensureI18n()`
 * był tu pustą funkcją, a słownik rejestrował wyłącznie efekt uboczny importu
 * - jedyna nakładka z tym starym wzorcem (audyt, wydanie 12).
 */
let registered = false;
export function ensureI18n(): void {
  if (registered) return;
  registered = true;
  i18n.addResourceBundle("pl", "translation", pl, true, true);
  i18n.addResourceBundle("en", "translation", en, true, true);
}
ensureI18n();
