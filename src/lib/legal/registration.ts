// DANE REJESTROWE WYDAWCY I STAŁE PAKIETU ZGODNOŚCI.
//
// PO CO OSOBNY MODUŁ, SKORO TO TEŻ "dane o podmiocie". Bo `lib/legal/entity.ts`
// jest czytany przez `lib/legal/meta.ts`, a ten przez `head()` KAŻDEJ trasy
// prawnej. `head()` jest funkcją EAGER w drzewie tras, więc `entity.ts` ląduje
// w chunku WEJŚCIOWYM serwisu - i ciągnie tam ze sobą każdy swój eksport, który
// jest używany gdziekolwiek indziej (bundler hoistuje moduł współdzielony
// między chunkami do wspólnego przodka, nie wycina z niego eksportów "na
// wyrost").
//
// Numer KRS, NIP, adres sądu rejestrowego i organy nadzoru są potrzebne
// WYŁĄCZNIE w treści dokumentów (`content/statute.ts`, `content/rodo.ts`), czyli
// w chunkach ładowanych leniwie przy wejściu na konkretną stronę prawną.
// Trzymane w `entity.ts` płacił za nie każdy czytelnik każdej strony serwisu -
// także tej, która z dokumentem prawnym nie ma nic wspólnego.
//
// REGUŁA DLA NASTĘPNEJ OSOBY: stała czytana przez `head()` albo przez `meta.ts`
// -> `entity.ts`. Stała czytana wyłącznie przez treść dokumentu -> tutaj.
//
// Dane pochodzą z odpisu pełnego KRS nr 0001195512 (stan na 19.09.2025).

/** Forma prawna wydawcy w obu językach. */
export const LEGAL_ENTITY_FORM = { pl: "fundacja", en: "foundation" } as const;
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
