export const LEGAL_ENTITY_KRS = "0001195512";
export const LEGAL_ENTITY_NIP = "7011278375";
export const LEGAL_ENTITY_ADDRESS = "ul. Tytusa Chałubińskiego 8, 00-613 Warszawa, Polska";
/** Sąd rejestrowy prowadzący akta podmiotu. */
export const LEGAL_ENTITY_COURT = {
  pl: "Sąd Rejonowy dla m.st. Warszawy w Warszawie, XII Wydział Gospodarczy Krajowego Rejestru Sądowego",
  en: "District Court for the Capital City of Warsaw in Warsaw, 12th Commercial Division of the National Court Register",
} as const;
/** Organy sprawujące nadzór nad fundacją (ustawa z 6 kwietnia 1984 r. o fundacjach). */
export const LEGAL_ENTITY_SUPERVISION = {
  pl: "Minister Spraw Wewnętrznych i Administracji oraz Prezydent m.st. Warszawy",
  en: "the Minister of the Interior and Administration and the Mayor of the City of Warsaw",
} as const;
/** Data ustanowienia aktem notarialnym, data statutu i data wpisu do KRS. */
export const LEGAL_ENTITY_FOUNDED = "2025-01-30";
export const LEGAL_ENTITY_STATUTE_DATE = "2025-02-03";
export const LEGAL_ENTITY_REGISTERED = "2025-09-19";

/** Organ nadzorczy właściwy dla administratora (RODO art. 77). */
export const SUPERVISORY_AUTHORITY = {
  pl: "Prezes Urzędu Ochrony Danych Osobowych, ul. Stawki 2, 00-193 Warszawa",
  en: "President of the Personal Data Protection Office (UODO), ul. Stawki 2, 00-193 Warsaw, Poland",
} as const;

/** Adres, pod którym zalogowany użytkownik zarządza zgodami i danymi. */
export const PRIVACY_HUB_PATH = "/profile/privacy";

/**
 * Data wydania PAKIETU ZGODNOŚCI: RODO, zarządzanie prywatnością, przetwarzanie
 * danych, komunikacja i marketing, kluby dyskusyjne, moderacja treści,
 * wydarzenia i bilety, subskrypcje oraz przejrzystość AI.
 *
 * Osobna stała, a nie bump `LEGAL_UPDATED`: regulamin, polityka prywatności
 * i polityka zwrotów NIE zmieniły w tym wydaniu ani jednego zdania, a data
 * „ostatnia aktualizacja" jest dla czytelnika informacją o TREŚCI, nie o dacie
 * wdrożenia repozytorium. Przesunięcie jej na wszystkich dokumentach naraz
 * kasowałoby jedyny sygnał, po którym da się poznać, że dokument realnie się
 * zmienił - a w sporze to jest sygnał dowodowy.
 */
export const COMPLIANCE_PACK_UPDATED = "2026-09-14";

/**
 * Data ostatniej zmiany TREŚCI polityki komunikacji i marketingu - osobno od
 * pakietu (ta sama zasada co wyżej: pozostałe dokumenty pakietu nie zmieniły
 * się ani jednym zdaniem). 2026-10-22 (I9d-Y2, decyzja właściciela
 * 2026-10-21, wariant (a)): pomiar otwarć i kliknięć tylko za zgodą
 * obejmującą pomiar, wersja treści przy każdej zgodzie, osobne wyłączenie
 * pomiaru bez rezygnacji z newslettera. 2026-10-23 (I9d-Y2b, decyzje
 * właściciela 2026-10-23: D1 wariant (b), D2): zgoda na pomiar ma osobne,
 * domyślnie niezaznaczone pole i własną treść, działa dopiero po
 * potwierdzeniu przyciskiem przez właściciela skrzynki i tylko u aktywnego
 * subskrybenta; koniec subskrypcji kończy zgodę na pomiar. Gdy wdrożenie
 * przypadnie później - wpisać dzień wdrożenia (data mówi o treści, którą
 * czytelnik widzi).
 */
export const COMMUNICATIONS_UPDATED = "2026-10-23";
