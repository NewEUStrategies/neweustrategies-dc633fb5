// Stałe używane przez publiczne strony prawne (regulamin, prywatność, zwroty)
// oraz przez komunikaty w checkoucie. Sprzedawcą jest nasz podmiot - Stripe
// pełni rolę operatora płatności obsługującego naliczanie i pobór podatków,
// wsparcie transakcyjne oraz spory i obciążenia zwrotne.
export const LEGAL_ENTITY = "New European Strategies";
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
