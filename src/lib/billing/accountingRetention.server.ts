// Retencja dowodów księgowych przy usuwaniu konta (RODO x ustawa o rachunkowości).
//
// Prawo do usunięcia danych (art. 17 RODO) nie sięga danych, które musimy
// przechowywać na podstawie obowiązku prawnego - art. 17 ust. 3 lit. b RODO
// wprost to wyłącza, a art. 74 ust. 2 ustawy o rachunkowości każe trzymać
// dowody księgowe 5 lat od początku roku po roku obrotowym. Do 20260803090002
// `payment_orders.user_id` miało `ON DELETE CASCADE`, więc kasowanie konta
// wynosiło ze sobą całą ewidencję transakcji.
//
// Ten moduł jest aplikacyjną połową rozwiązania: woła anonimizację JAWNIE,
// zanim `auth.admin.deleteUser()` cokolwiek ruszy. Baza ma drugą połowę
// (FK `ON DELETE SET NULL` + trigger `BEFORE DELETE ON auth.users`), więc
// usunięcie konta poza aplikacją też nie zniszczy dowodów. Dwie warstwy, ta
// sama gwarancja - dokładnie jak przy izolacji sandbox/live płatności.
//
// Moduł server-only (klucz service role).

/** Bilans anonimizacji jednego konta. */
export interface AccountingRetentionResult {
  /** Zamówienia zachowane jako dowód księgowy, pozbawione danych osobowych. */
  retained: number;
  /** Porzucone szkice checkoutu usunięte razem z kontem (bez wartości dowodowej). */
  discarded: number;
}

function toCount(source: Record<string, unknown>, key: string): number {
  const value = source[key];
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

/**
 * Odcina dane osobowe od zamówień usuwanego konta, zachowując substancję
 * księgową (kwoty, waluty, daty, identyfikatory transakcji u operatora).
 *
 * **Rzuca przy każdej awarii - z kontraktu.** `deleteMyAccount` wywołuje to
 * przed `deleteUser`, więc rzucenie zatrzymuje usuwanie konta. Tak ma być:
 * pominięcie tego kroku oznaczałoby, że FK zabiera wiersze zamówień albo
 * zostawia na nich adres e-mail osoby, która właśnie skorzystała z prawa do
 * usunięcia danych. Oba skutki są nie do naprawienia po fakcie.
 */
export async function retainAccountingEvidence(userId: string): Promise<AccountingRetentionResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data, error } = await supabaseAdmin.rpc("anonymize_payment_orders_for_user", {
    p_user_id: userId,
  });
  if (error) {
    throw new Error(`accounting retention: order anonymisation failed: ${error.message}`);
  }

  const payload = data && typeof data === "object" && !Array.isArray(data) ? data : {};
  return {
    retained: toCount(payload, "retained"),
    discarded: toCount(payload, "discarded"),
  };
}
