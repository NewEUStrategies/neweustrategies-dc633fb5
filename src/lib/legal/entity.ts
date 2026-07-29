// Stałe używane przez publiczne strony prawne (regulamin, prywatność, zwroty)
// oraz przez komunikaty w checkoucie. Nazwa sprzedawcy musi być identyczna
// z danymi w Paddle (Merchant of Record).
export const LEGAL_ENTITY = "New European Strategies";
export const LEGAL_CONTACT_EMAIL = "office@neweuropeanstrategies.com";
export const LEGAL_SITE_URL = "https://neweuropeanstrategies.com";
/** Data ostatniej aktualizacji dokumentów prawnych (ISO, wyświetlana wprost). */
export const LEGAL_UPDATED = "2026-07-30";
/** Liczba dni na odstąpienie / zwrot bez podania przyczyny. */
export const REFUND_WINDOW_DAYS = 30;
export const PADDLE_BUYER_TERMS_URL = "https://www.paddle.com/legal/checkout-buyer-terms";
export const PADDLE_REFUND_POLICY_URL = "https://www.paddle.com/legal/refund-policy";
export const PADDLE_SUPPORT_URL = "https://paddle.net";
/** Zdanie wymagane przez Paddle - ujawnienie roli Merchant of Record. */
export const PADDLE_MOR_DISCLOSURE = {
  pl: "Nasz proces zamówień obsługuje nasz sprzedawca internetowy Paddle.com. Paddle.com jest Merchant of Record (sprzedawcą formalnym) dla wszystkich naszych zamówień. Paddle obsługuje wszystkie zapytania klientów oraz zwroty.",
  en: "Our order process is conducted by our online reseller Paddle.com. Paddle.com is the Merchant of Record for all our orders. Paddle provides all customer service inquiries and handles returns.",
} as const;
