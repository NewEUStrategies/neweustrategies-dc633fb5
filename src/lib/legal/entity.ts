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
// Pozostałe dane rejestrowe (KRS, NIP, adres, sąd, organy nadzoru, daty)
// mieszkają w `lib/legal/registration.ts` - czyta je WYŁĄCZNIE treść dokumentów,
// więc nie mają czego szukać w module, który przez `meta.ts` i `head()` ląduje
// w chunku wejściowym każdej strony. Uzasadnienie w nagłówku tamtego pliku.

export const LEGAL_CONTACT_EMAIL = "office@neweuropeanstrategies.com";
export const LEGAL_SITE_URL = "https://neweuropeanstrategies.com";
/** Data ostatniej aktualizacji dokumentów prawnych (ISO, wyświetlana wprost). */
export const LEGAL_UPDATED = "2026-07-30";
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
