// Język interfejsu Stripe Checkout.
//
// Osadzony checkout renderuje się w ramce Stripe, więc nasze i18n go NIE
// obejmuje - jedynym sposobem na polski formularz jest parametr `locale`
// przekazany przy tworzeniu sesji. Trzymamy go w jednym miejscu, bo używają go
// trzy niezależne ścieżki (plan katalogowy, kwota ad-hoc, darowizna).
export const CHECKOUT_LOCALES = ["pl", "en"] as const;

export type CheckoutLocale = (typeof CHECKOUT_LOCALES)[number];

export const DEFAULT_CHECKOUT_LOCALE: CheckoutLocale = "pl";

/**
 * Normalizuje dowolną wartość języka (np. `i18n.language` w postaci `en-GB`)
 * do jednego z obsługiwanych języków checkoutu. Nigdy nie rzuca - brak
 * dopasowania oznacza język domyślny.
 */
export function normalizeCheckoutLocale(value: unknown): CheckoutLocale {
  if (typeof value !== "string") return DEFAULT_CHECKOUT_LOCALE;
  const base = value.trim().toLowerCase().split("-")[0];
  return CHECKOUT_LOCALES.includes(base as CheckoutLocale)
    ? (base as CheckoutLocale)
    : DEFAULT_CHECKOUT_LOCALE;
}
