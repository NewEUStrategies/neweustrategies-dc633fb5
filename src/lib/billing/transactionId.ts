// Walidacja numeru transakcji operatora płatności - współdzielona przez
// formularz w profilu (walidacja przed wysyłką) i serwer (twarda bramka).
//
// Stripe: PaymentIntent (`pi_`), sesja Checkout (`cs_`), faktura (`in_`),
// obciążenie (`ch_`). `txn_` pozostaje dla identyfikatorów historycznych
// (sprzed migracji z Paddle).
export const TRANSACTION_ID_PATTERN = /^(pi_|cs_|in_|ch_|txn_)[A-Za-z0-9]{8,80}$/;

/** Czy tekst wygląda na identyfikator transakcji dostawcy płatności? */
export function isTransactionId(value: string): boolean {
  return TRANSACTION_ID_PATTERN.test(value.trim());
}

/**
 * Normalizacja tego, co użytkownik wkleił z maila (tylko białe znaki) -
 * identyfikatory Stripe są wrażliwe na wielkość liter, więc NIE wolno ich
 * zmieniać na małe/duże litery.
 */
export function normalizeTransactionId(value: string): string {
  return value.trim();
}
