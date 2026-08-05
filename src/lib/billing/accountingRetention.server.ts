// Retencja dowodów przy usuwaniu konta (RODO x ustawa o rachunkowości).
//
// Prawo do usunięcia danych (art. 17 RODO) nie sięga danych, które musimy
// przechowywać na podstawie obowiązku prawnego - art. 17 ust. 3 lit. b RODO
// wprost to wyłącza, a art. 74 ust. 2 ustawy o rachunkowości każe trzymać
// dowody księgowe 5 lat od początku roku po roku obrotowym.
//
// Domykane są DWA przeciwne naruszenia, każde w innej tabeli:
//
//   * `payment_orders` (do 20260803090002): `user_id` miało `ON DELETE
//     CASCADE`, więc kasowanie konta wynosiło ze sobą całą ewidencję
//     transakcji - dowody GINĘŁY;
//   * `user_purchases` (do 20260805090100): `user_id` był `uuid NOT NULL`
//     BEZ klucza obcego, więc nigdy nie kaskadował - i właśnie dlatego umknął
//     audytowi CASCADE. Po usunięciu konta wiersz ZOSTAWAŁ z surowym
//     identyfikatorem osoby, bez podstawy prawnej i bez terminu (art. 5 ust. 1
//     lit. e RODO).
//
// Ten moduł jest aplikacyjną połową rozwiązania: woła anonimizację JAWNIE,
// zanim `auth.admin.deleteUser()` cokolwiek ruszy. Baza ma drugą połowę (FK
// `ON DELETE SET NULL` na obu tabelach + trigger `BEFORE DELETE ON auth.users`),
// więc usunięcie konta poza aplikacją też nie zostawi ani surowego
// identyfikatora, ani dziury w dowodach. Dwie warstwy, ta sama gwarancja -
// dokładnie jak przy izolacji sandbox/live płatności.
//
// Jedno RPC, nie dwa: `anonymize_accounting_evidence_for_user` obejmuje obie
// tabele w JEDNEJ transakcji. Dwa wywołania oznaczałyby okno, w którym
// zamówienia są już pseudonimizowane, a zakupy wciąż noszą identyfikator -
// i awaria w tym oknie zostawiłaby naruszenie w danych.
//
// Moduł server-only (klucz service role).

/** Bilans anonimizacji jednej tabeli dowodowej. */
export interface RetentionTally {
  /** Wiersze zachowane jako dowód księgowy, pozbawione danych osobowych. */
  retained: number;
  /** Wiersze bez wartości dowodowej, usunięte razem z kontem. */
  discarded: number;
}

/** Bilans anonimizacji jednego konta, po tabelach. */
export interface AccountingRetentionResult {
  /** Zamówienia (`payment_orders`) - ewidencja transakcji. */
  orders: RetentionTally;
  /** Uprawnienia zakupowe (`user_purchases`) - dowody zakupu dostępu. */
  purchases: RetentionTally;
  /** Łączna liczba zachowanych dowodów - to trafia do komunikatu dla użytkownika. */
  retainedTotal: number;
}

function toCount(source: Record<string, unknown>, key: string): number {
  const value = source[key];
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toTally(value: unknown): RetentionTally {
  const record = toRecord(value);
  return { retained: toCount(record, "retained"), discarded: toCount(record, "discarded") };
}

/**
 * Odcina dane osobowe od dowodów usuwanego konta, zachowując ich substancję
 * księgową (kwoty, waluty, daty, identyfikatory transakcji u operatora,
 * przedmiot uprawnienia).
 *
 * **Rzuca przy każdej awarii - z kontraktu.** `deleteMyAccount` wywołuje to
 * przed `deleteUser`, więc rzucenie zatrzymuje usuwanie konta. Tak ma być:
 * pominięcie tego kroku oznaczałoby albo dziurę w dowodach księgowych, albo
 * osierocony identyfikator osoby, która właśnie skorzystała z prawa do
 * usunięcia danych. Oba skutki są nie do naprawienia po fakcie.
 */
export async function retainAccountingEvidence(userId: string): Promise<AccountingRetentionResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data, error } = await supabaseAdmin.rpc("anonymize_accounting_evidence_for_user", {
    p_user_id: userId,
  });
  if (error) {
    throw new Error(`accounting retention: evidence anonymisation failed: ${error.message}`);
  }

  const payload = toRecord(data);
  // Zgodność w tył: przed 20260805090100 funkcja zwracała płaskie
  // {retained, discarded} znaczące „zamówienia". Nowy kształt ma gałęzie.
  const orders = "orders" in payload ? toTally(payload.orders) : toTally(payload);
  const purchases = toTally(payload.purchases);

  return {
    orders,
    purchases,
    retainedTotal: orders.retained + purchases.retained,
  };
}
