// Stałe używane przez publiczne strony prawne (regulamin, prywatność, zwroty)
// oraz przez komunikaty w checkoucie. Sprzedawcą jest nasz podmiot - Stripe
// pełni rolę operatora płatności obsługującego naliczanie i pobór podatków,
// wsparcie transakcyjne oraz spory i obciążenia zwrotne.
export const LEGAL_ENTITY = "New European Strategies";
/**
 * PEŁNE DANE IDENTYFIKACYJNE WYDAWCY - wymagane, a nie ozdobne.
 *
 * `LEGAL_ENTITY` to nazwa handlowa i tak zostaje w zdaniach („dane przetwarza
 * New European Strategies"). Nie jest jednak identyfikacją podmiotu w rozumieniu
 * art. 13 ust. 1 lit. a RODO, art. 5 ustawy o świadczeniu usług drogą
 * elektroniczną ani art. 12 ust. 1 ustawy o prawach konsumenta - te przepisy
 * wymagają formy prawnej, adresu siedziby, numeru w rejestrze i numeru NIP.
 * Dane pochodzą z odpisu pełnego KRS nr 0001195512 (stan na 19.09.2025).
 */
export const LEGAL_ENTITY_FULL = "Fundacja New European Strategies";
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
/** Data ustanowienia aktem notarialnym oraz data statutu i data wpisu do KRS. */
export const LEGAL_ENTITY_FOUNDED = "2025-01-30";
export const LEGAL_ENTITY_STATUTE_DATE = "2025-02-03";
export const LEGAL_ENTITY_REGISTERED = "2025-09-19";
export const LEGAL_CONTACT_EMAIL = "office@neweuropeanstrategies.com";
export const LEGAL_SITE_URL = "https://neweuropeanstrategies.com";
/** Data ostatniej aktualizacji dokumentów prawnych (ISO, wyświetlana wprost). */
export const LEGAL_UPDATED = "2026-07-30";
/**
 * Data wydania PAKIETU ZGODNOŚCI: RODO, zarządzanie prywatnością, przetwarzanie
 * danych, komunikacja i marketing, kluby dyskusyjne, moderacja treści oraz
 * wydarzenia i bilety.
 *
 * Osobna stała, a nie bump `LEGAL_UPDATED`: regulamin, polityka prywatności
 * i polityka zwrotów NIE zmieniły w tym wydaniu ani jednego zdania, a data
 * „ostatnia aktualizacja" jest dla czytelnika informacją o TREŚCI, nie o dacie
 * wdrożenia repozytorium. Przesunięcie jej na wszystkich dokumentach naraz
 * kasowałoby jedyny sygnał, po którym da się poznać, że dokument realnie się
 * zmienił - a w sporze to jest sygnał dowodowy.
 */
export const COMPLIANCE_PACK_UPDATED = "2026-09-14";
/** Adres, pod którym zalogowany użytkownik zarządza zgodami i danymi. */
export const PRIVACY_HUB_PATH = "/profile/privacy";
/** Organ nadzorczy właściwy dla administratora (RODO art. 77). */
export const SUPERVISORY_AUTHORITY = {
  pl: "Prezes Urzędu Ochrony Danych Osobowych, ul. Stawki 2, 00-193 Warszawa",
  en: "President of the Personal Data Protection Office (UODO), ul. Stawki 2, 00-193 Warsaw, Poland",
} as const;
/** Liczba dni na odstąpienie / zwrot bez podania przyczyny. */
export const REFUND_WINDOW_DAYS = 30;
/** Warunki kupującego operatora płatności (Stripe / Link). */
export const PAYMENT_PROVIDER_BUYER_TERMS_URL = "https://stripe.com/legal/consumer";
/** Kanał wsparcia dla płatności - prowadzony przez nas; spory i zwroty realizuje operator. */
export const PAYMENT_PROVIDER_SUPPORT_URL = `mailto:${LEGAL_CONTACT_EMAIL}`;
/** Nazwa operatora płatności widoczna w treściach prawnych. */
export const PAYMENT_PROVIDER_NAME = "Stripe";
/** Deskryptor widoczny na wyciągu bankowym kupującego obok naszej nazwy. */
export const PAYMENT_PROVIDER_STATEMENT_DESCRIPTOR = "LINK.COM*";
/**
 * Ujawnienie rzeczywistego modelu rozliczeń: sprzedawcą jest nasz podmiot,
 * a Stripe działa jako operator płatności - nalicza,
 * pobiera i rozlicza podatek dla kupujących w ok. 80 krajach, obsługuje
 * oszustwa, spory i obciążenia zwrotne oraz wsparcie transakcyjne.
 */
export const PAYMENT_PROVIDER_DISCLOSURE = {
  pl: `Sprzedawcą jest ${LEGAL_ENTITY}. Płatności obsługuje nasz operator płatności, Stripe, który nalicza, pobiera i rozlicza podatek od sprzedaży w Twojej jurysdykcji (obsługuje ponad 80 krajów), a także zajmuje się zapobieganiem oszustwom, sporami i obciążeniami zwrotnymi (chargeback) oraz wsparciem transakcyjnym. Na wyciągu z konta lub karty obok naszej nazwy zobaczysz dopisek ${PAYMENT_PROVIDER_STATEMENT_DESCRIPTOR}. Obsługę produktową, reklamacje i pytania o usługę prowadzimy my.`,
  en: `The seller is ${LEGAL_ENTITY}. Payments are processed by our payment provider, Stripe, which calculates, collects and remits sales tax for your jurisdiction (covering more than 80 countries), and also handles fraud prevention, disputes and chargebacks as well as transactional support. Your bank or card statement will show ${PAYMENT_PROVIDER_STATEMENT_DESCRIPTOR} next to our name. We handle product support and complaints ourselves.`,
} as const;
