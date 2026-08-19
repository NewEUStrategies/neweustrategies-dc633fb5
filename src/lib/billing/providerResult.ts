// Kontrakt odpowiedzi server fn operatora płatności - i jego rozpakowanie.
//
// DLACZEGO TO ISTNIEJE. Server fn operatora (`cancelStripeSubscription`,
// `resumeStripeSubscription`, `changeStripePlan`,
// `updateStripeSubscriptionSeats`, `createStripePortalSession`) świadomie
// NIE RZUCAJĄ, gdy operator odmówi - zwracają `{ error: "<powód>" }`. To dobra
// decyzja serwerowa: powód odmowy da się pokazać człowiekowi, a wyjątek na
// granicy RPC by go zgubił.
//
// Cena tej decyzji jest jednak taka, że dla `useMutation` z react-query
// odpowiedź `{ error }` to ROZWIĄZANY promise, czyli SUKCES. `onSuccess` odpala
// się normalnie, `onError` nigdy - i karta ogłasza „anulowano" na subskrypcji,
// która dalej jest obciążana. Każde wywołanie musi więc odpakować ładunek
// JAWNIE, a cztery kopie tego sprawdzenia w czterech mutacjach to cztery
// miejsca, w których można je pominąć (i pominięto - patrz dokument wdrożenia).
//
// Moduł jest czysty i bez zależności od Reacta, więc reguła jest testowalna
// osobno od komponentów, które z niej korzystają.

/**
 * Błąd odmowy po stronie operatora. Nosi `code` z ładunku, żeby warstwa UI
 * mogła odróżnić powody wymagające innego komunikatu (np. `no_customer` -
 * „nie masz konta u operatora" - od ogólnej awarii portalu).
 */
export class ProviderCallError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(`provider_error:${code}`);
    this.name = "ProviderCallError";
    this.code = code;
  }
}

/** Arm odmowy w unii zwracanej przez server fn operatora. */
type ProviderRefusal = { error: unknown };

/**
 * Rozpakowuje odpowiedź server fn operatora: sukces przepuszcza, odmowę RZUCA.
 *
 * Wstawiony w `mutationFn` (`.then(unwrapProviderResult)`) sprowadza odmowę
 * operatora i awarię transportu do JEDNEJ ścieżki - `onError`. Dzięki temu
 * „sukces" w `onSuccess` znaczy naprawdę sukces.
 *
 * Typ zwracany ODCINA arm odmowy z unii (`Exclude`), więc `onSuccess` dostaje
 * kształt sukcesu bez ręcznego zawężania - a próba odczytania `result.error`
 * po odpakowaniu nie przejdzie typecheckiem.
 *
 * Puste `error` (np. `{ error: "" }`) NIE jest odmową - server fn zwraca
 * niepusty powód albo nie zwraca pola wcale.
 */
export function unwrapProviderResult<T>(result: T): Exclude<T, ProviderRefusal> {
  if (
    result &&
    typeof result === "object" &&
    "error" in result &&
    (result as ProviderRefusal).error
  ) {
    throw new ProviderCallError(String((result as ProviderRefusal).error));
  }
  return result as Exclude<T, ProviderRefusal>;
}

/**
 * Kod odmowy, jeśli błąd pochodzi od operatora; `null` dla wszystkiego innego
 * (awaria sieci, wyjątek walidacji). Warstwa UI mapuje kod na komunikat.
 */
export function providerErrorCode(error: unknown): string | null {
  return error instanceof ProviderCallError ? error.code : null;
}
