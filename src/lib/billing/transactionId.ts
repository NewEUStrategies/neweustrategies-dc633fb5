// Walidacja numeru transakcji operatora płatności - współdzielona przez
// formularz w profilu (walidacja przed wysyłką) i serwer (twarda bramka).
export const TRANSACTION_ID_PATTERN = /^txn_[a-z0-9]{10,60}$/i;

/** Czy tekst wygląda na identyfikator transakcji (`txn_...`)? */
export function isTransactionId(value: string): boolean {
  return TRANSACTION_ID_PATTERN.test(value.trim());
}

/** Normalizacja tego, co użytkownik wkleił z maila (spacje, wielkość liter). */
export function normalizeTransactionId(value: string): string {
  return value.trim().toLowerCase();
}
