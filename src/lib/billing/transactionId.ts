// Walidacja numeru transakcji operatora płatności - współdzielona przez
// formularz w profilu (walidacja przed wysyłką) i serwer (twarda bramka).
//
// Stripe: PaymentIntent (`pi_`), sesja Checkout (`cs_`), faktura (`in_`),
// obciążenie (`ch_`). `txn_` pozostaje dla identyfikatorów historycznych
// (sprzed migracji z Paddle).
//
// CZŁON TRYBU. Identyfikator sesji Checkout niesie po prefiksie człon trybu
// konta: `cs_test_<...>` w piaskownicy i `cs_live_<...>` na koncie
// produkcyjnym. Wcześniejszy wzorzec dopuszczał po prefiksie wyłącznie znaki
// alfanumeryczne, więc odrzucał KAŻDY prawdziwy numer sesji - mimo że `cs_`
// był w nim wymieniony jako obsługiwany, a `invoice.server.ts` ma dla niego
// osobną gałąź. Człon trybu jest opcjonalny (identyfikatory sprzed jego
// wprowadzenia nadal istnieją) i dopuszczony WYŁĄCZNIE dla `cs_`: `pi_`,
// `in_`, `ch_` i `txn_` nigdy go nie mają, więc podkreślnik w nich dalej
// jest sygnałem, że to nie jest numer transakcji.
export const TRANSACTION_ID_PATTERN = /^(?:cs_(?:test_|live_)?|pi_|in_|ch_|txn_)[A-Za-z0-9]{8,80}$/;

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
