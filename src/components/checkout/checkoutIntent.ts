// Rozgrzewka checkoutu na INTENCJĘ zakupu.
//
// Osobny moduł od `EmbeddedCheckoutFrame`, bo używają go powierzchnie, które
// same ramki nie renderują (przycisk kupna na paywallu, bilet na wydarzenie,
// formularz darowizny, przycisk płatności na /checkout/$planId) - i bo tylko
// dzięki temu plik komponentu eksportuje wyłącznie komponenty (Fast Refresh).
//
// To JEDYNE miejsce z `import()` ramki Stripe: `EmbeddedCheckoutFrame` bierze
// `loadStripeFrame` stąd do swojego `React.lazy`, więc Rollup emituje dokładnie
// jeden leniwy chunk i nie ma drugiej ścieżki, którą SDK operatora mogłoby
// wrócić na ścieżkę bootowania czytelnika (bramka: `check:entry-purity`).
import { preloadStripeSdk } from "@/lib/stripe";

/** Jedna referencja importu dla `React.lazy` i dla rozgrzewki - jeden chunk. */
export const loadStripeFrame = () => import("@/components/checkout/StripeEmbeddedFrame");

let warmed = false;

/**
 * Pobiera chunk ramki i SDK operatora, zanim padnie kliknięcie - na
 * `pointerenter`/`focus` przycisku zakupu. Dla kupującego jest to SZYBSZE niż
 * stan sprzed podziału (wtedy SDK siedziało w entry, ale `js.stripe.com` i tak
 * leciało dopiero po kliknięciu), a czytelnik, który nigdy nie dotknie
 * przycisku, nie płaci nic.
 *
 * Idempotentna i całkowicie best-effort - nigdy nie rzuca i nie raportuje.
 */
export function preloadEmbeddedCheckout(): void {
  if (warmed) return;
  warmed = true;
  void loadStripeFrame().catch(() => {
    // Sieć padła przy samym najechaniu kursorem: pozwól spróbować ponownie.
    warmed = false;
  });
  preloadStripeSdk();
}

/** Propsy zdarzeń do rozlania na przycisku otwierającym checkout. */
export const checkoutIntentHandlers = {
  onPointerEnter: preloadEmbeddedCheckout,
  onFocus: preloadEmbeddedCheckout,
} as const;
