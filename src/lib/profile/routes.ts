// Kanoniczne adresy paneli profilu - JEDNO źródło prawdy dla nawigacji,
// wyszukiwarki wewnętrznej, powiadomień i e-maili transakcyjnych.
//
// PO CO. Konsolidacja IA (§10 prywatność, §11 finanse) zamieniła dwie trasy
// w przekierowania: `/profile/subscription` -> `/profile/plan` oraz
// `/profile/orders` -> `/profile/payments`. Same przekierowania wystarczyłyby,
// żeby nic nie umarło - ale nie wystarczą, żeby było dobrze: adres wklejony
// w e-mailu transakcyjnym albo w powiadomieniu push żyje miesiącami i za każdym
// razem kosztuje użytkownika dodatkowy przeskok (a nas - kolejną rundę
// nawigacji, w której nie wiadomo, która wersja jest tą prawdziwą).
//
// Moduł jest CZYSTY (bez Reacta, bez klienta bazy), więc importuje się go
// zarówno w kodzie przeglądarki, jak i w server functions składających treść
// powiadomień.

/** Plan i subskrypcja: status, aktywny plan, portal operatora, zmiana planu. */
export const PROFILE_PLAN_PATH = "/profile/plan";

/**
 * Wejście do portalu operatora płatności z maila - STAŁY adres aplikacji, który
 * dopiero po otwarciu (przez zalogowanego właściciela) tworzy świeżą sesję
 * portalu i przekierowuje. Sesja portalu żyje kilka minut, więc wysłana w mailu
 * wprost przestawała działać, zanim adresat zdążył ją kliknąć.
 *
 * Plik trasy to `profile_.portal.tsx` (poza powłoką `/profile`): powłoka dla
 * gościa rysuje ekran 401 z linkiem do `/login`, który po zalogowaniu wraca na
 * stronę główną - wejście z maila logowałoby więc w próżnię. Własna bramka trasy
 * otwiera logowanie w miejscu i kontynuuje otwarcie portalu.
 */
export const PROFILE_PORTAL_PATH = "/profile/portal";

/** Płatności i faktury: scalona historia, zamówienia, dokumenty, odzyskanie faktury. */
export const PROFILE_PAYMENTS_PATH = "/profile/payments";

/** Dane do faktury (nabywca). */
export const PROFILE_BILLING_PATH = "/profile/billing";

/** Hub członkostwa: warstwa praw, benefity, miejsca w organizacji. */
export const PROFILE_MEMBERSHIP_PATH = "/profile/membership";

/** Prywatność i dane: widoczność, kontakt, zgody, eksport i usunięcie konta. */
export const PROFILE_PRIVACY_PATH = "/profile/privacy";

/** Bezpieczeństwo konta: hasło, e-mail, sesje, dwuskładnikowe. */
export const PROFILE_SECURITY_PATH = "/profile/security";
