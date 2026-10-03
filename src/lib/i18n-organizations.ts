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

// Rejestracja mieszka W `ensureI18n()`, a nie luzem na poziomie modułu - ten
// sam wzorzec co pozostałe nakładki (`i18n-experts`, `i18n-notifications`).
// Trasa i komponent wołają tę funkcję zamiast side-effectowego importu:
// nazwane wiązanie pozwala splitterowi przenieść słownik do chunka trasy
// (a nie do eager-owego grafu wejściowego), a ponieważ to WYWOŁANIE
// rejestruje słownik, ani Vite, ani Nitro nie wytną go razem z „pustą”
// funkcją. Flaga chroni przed powtórnym głębokim scaleniem przy każdym
// renderze; wywołanie przy imporcie zachowuje stary kontrakt side-effectu.
let registered = false;
export function ensureI18n(): void {
  if (registered) return;
  registered = true;
  i18n.addResourceBundle("pl", "translation", pl, true, true);
  i18n.addResourceBundle("en", "translation", en, true, true);
}
ensureI18n();
