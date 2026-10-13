// Strażnik drugiej subskrypcji planu i jednorazowego okresu próbnego.
//
// DWA DEFEKTY, JEDNA HISTORIA. Kasa planu nie pytała, czy kupujący ma już
// subskrypcję, ani czy kiedyś dostał trial - `trial_period_days` trafiało do
// KAŻDEJ sesji subskrypcyjnej. Skutki: ponowny zakup zakładał u operatora
// drugą subskrypcję obok pierwszej (dwa obciążenia co cykl za jeden dostęp),
// a cykl „anuluj w trialu → kup ponownie" dawał dostęp bez końca i bez
// płatności.
//
// REGUŁY (decyzja produktowa, ta sama w obu silnikach kasy i w nakładce):
//   1. Subskrypcja planu w stanie ŻYWYM (aktywna, trial, zaległa, nieopłacona,
//      wstrzymana, niedokończona i jeszcze nie wygasła) blokuje kolejny zakup
//      subskrypcji - zmiana planu idzie ścieżką zmiany planu (`/profile/plan`,
//      proracja u operatora), a nie drugim checkoutem.
//   2. Trial dostaje WYŁĄCZNIE ktoś, kto nigdy nie miał subskrypcji planu
//      - w jakimkolwiek stanie poza `incomplete_expired` (pierwsza płatność,
//      która nigdy nie przeszła, nie dała dostępu, więc nie zużywa triala).
//      Liczy się historia subskrypcji, a nie `trial_ends_at`: webhook czyści
//      tę kolumnę przy wyjściu z triala, więc nie jest trwałym śladem.
//   3. Subskrypcje DAROWIZN (`metadata.purpose = "donation"`) nie są planem:
//      nie blokują zakupu i nie zużywają triala. Zakupy jednorazowe (plan
//      `one_time`, treść, bilet) w ogóle nie przechodzą przez tego strażnika.
//
// Źródła są dwa i oba są sprawdzane: lokalny lustrzany wiersz `subscriptions`
// (pod RLS kupującego - jego konto i najemca z SESJI, nigdy z ładunku) oraz
// subskrypcje klienta u operatora, które widzą też okno przed webhookiem
// i historię, której baza nie ma (np. po przepięciu profilu).
//
// Moduł czysty (bez zależności serwerowych), więc ta sama reguła żyje
// w nakładce kasy i w handlerach.
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";

/** Kod odmowy, który UI zamienia w „zmień plan w profilu". */
export const SUBSCRIPTION_EXISTS_ERROR = "subscription_exists" as const;

/** Statusy operatora, w których subskrypcja nadal istnieje i może obciążać. */
export const LIVE_PLAN_SUBSCRIPTION_STATUSES: ReadonlySet<string> = new Set([
  "active",
  "trialing",
  "past_due",
  "unpaid",
  "paused",
  "incomplete",
]);

/** Status subskrypcji, która nigdy nie wystartowała - nie zużywa triala. */
const NEVER_STARTED_STATUSES: ReadonlySet<string> = new Set(["incomplete_expired"]);

export interface PlanSubscriptionRecord {
  status: string | null | undefined;
  /** `metadata.purpose` subskrypcji u operatora (`donation` = nie plan). */
  purpose?: string | null;
}

export interface PlanSubscriptionHistory {
  /** Czy istnieje żywa subskrypcja planu (rodzi drugi checkout = podwójne obciążenie). */
  hasLive: boolean;
  /** Czy kiedykolwiek wystartowała subskrypcja planu (trial już wykorzystany). */
  hadAny: boolean;
}

export function isLivePlanSubscriptionStatus(status: string | null | undefined): boolean {
  return typeof status === "string" && LIVE_PLAN_SUBSCRIPTION_STATUSES.has(status);
}

/** Zbiera historię subskrypcji PLANU (darowizny odpadają). */
export function planSubscriptionHistory(
  records: readonly PlanSubscriptionRecord[],
): PlanSubscriptionHistory {
  let hasLive = false;
  let hadAny = false;
  for (const record of records) {
    if (record.purpose === "donation") continue;
    const status = typeof record.status === "string" ? record.status : "";
    if (isLivePlanSubscriptionStatus(status)) hasLive = true;
    if (status && !NEVER_STARTED_STATUSES.has(status)) hadAny = true;
  }
  return { hasLive, hadAny };
}

/** Łączy historie z dwóch źródeł - wystarczy ślad w którymkolwiek. */
export function mergePlanSubscriptionHistory(
  ...histories: readonly PlanSubscriptionHistory[]
): PlanSubscriptionHistory {
  return {
    hasLive: histories.some((h) => h.hasLive),
    hadAny: histories.some((h) => h.hadAny),
  };
}

/**
 * Historia subskrypcji planu kupującego z lokalnego lustra `subscriptions`.
 *
 * Klient UŻYTKOWNIKA, nie rola serwisowa: polityka „Users can view own
 * subscription" wiąże wiersz z kontem I najemcą sesji (20260831060000), więc
 * zakres pochodzi z sesji, a nie z ładunku. Tabela trzyma wyłącznie
 * subskrypcje planów - darowizny cykliczne żyją w `donations`
 * (`webhookDispatch` kieruje je osobną ścieżką). Środowisko jest jawne:
 * wiersze sandboxa i produkcji leżą w jednej tabeli.
 *
 * Błąd odczytu RZUCA: „nie wiem" nie może oznaczać „nie ma subskrypcji" -
 * fail-open dałby drugie obciążenie i kolejny trial przy pierwszej awarii bazy.
 */
export async function loadLocalPlanSubscriptionHistory(
  supabase: SupabaseClient<Database>,
  input: { userId: string; environment: string },
): Promise<PlanSubscriptionHistory> {
  const { data, error } = await supabase
    .from("subscriptions")
    .select("status")
    .eq("user_id", input.userId)
    .eq("environment", input.environment)
    .limit(100);
  if (error) throw new Error(`subscription history lookup failed: ${error.message}`);
  return planSubscriptionHistory((data ?? []).map((row) => ({ status: row.status })));
}
