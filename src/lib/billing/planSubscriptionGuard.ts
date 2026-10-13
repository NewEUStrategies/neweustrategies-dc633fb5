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
//      wstrzymana) blokuje kolejny zakup subskrypcji TAM, GDZIE DROGĄ JEST
//      ZMIANA PLANU ALBO ZARZĄDZANIE ISTNIEJĄCĄ - i tylko tam. Relację liczy
//      ta sama reguła, której używa zmiana planu (`catalogSwitchRefusal`
//      z `planSwitch.ts`), więc nakładka nie odsyła do ścieżki, która odmówi:
//        * cel osiągalny zmianą planu   -> blokada, „Zmień plan" (proracja),
//        * ten sam plan                 -> blokada, „Zarządzaj subskrypcją"
//                                          (miejsca, anulowanie),
//        * inny model rozliczenia (Zespół za miejsce <-> plan indywidualny)
//                                       -> OSOBNY ZAKUP, bez blokady. Zmiana
//                                          planu odrzuca to przejście
//                                          (`plan_kind_mismatch` = „wymaga
//                                          nowego zakupu"), a anulowanie
//                                          zostawia status `active` do końca
//                                          okresu - blokada byłaby ślepym
//                                          zaułkiem nawet na rok,
//        * bieżąca cena spoza katalogu  -> blokada (fail-closed) i portal
//                                          operatora - zmiana planu takiej
//                                          ceny nie obsłuży.
//   2. Trial dostaje WYŁĄCZNIE ktoś, kto nigdy nie miał subskrypcji planu,
//      która WYSTARTOWAŁA - także przy osobnym zakupie z reguły 1. Nie liczą
//      się `incomplete` i `incomplete_expired` (pierwsza płatność, która nie
//      przeszła, nie dała dostępu, więc nie zużywa triala). Liczy się historia
//      subskrypcji, a nie `trial_ends_at`: webhook czyści tę kolumnę przy
//      wyjściu z triala, więc nie jest trwałym śladem.
//   3. `incomplete` (porzucone albo nieudane 3DS pierwszej płatności) NIE
//      blokuje - dawniej zamykał kasę na ~23 h z fałszywym „Zmień plan", choć
//      zmiana planu odmawia subskrypcji w tym stanie. Autorytatywna ścieżka
//      u operatora (`createPlanCheckoutSession`) najpierw UNIEWAŻNIA pierwszą
//      fakturę takiej subskrypcji (spóźnione 3DS już nie obciąży karty), a
//      faktura opłacona w międzyczasie oznacza subskrypcję żywą - reguła 1.
//   4. Subskrypcje DAROWIZN (`metadata.purpose = "donation"`) nie są planem:
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
import { catalogEntryByPriceId, type CatalogPriceEntry } from "@/lib/billing/catalog";
import { catalogSwitchRefusal } from "@/lib/billing/planSwitch";

/** Kod odmowy; nakładka dobiera do niego komunikat i ścieżkę (`PlanPurchaseConflict`). */
export const SUBSCRIPTION_EXISTS_ERROR = "subscription_exists" as const;

/**
 * Odmowa sesji, która przegrała wyścig z RÓWNOLEGLE otwartą sesją tego konta
 * (druga karta, ponowione żądanie): zostaje nowsza, ta jest już wygaszona.
 * Tutaj, a nie w module serwerowym, bo kod czyta też nakładka.
 */
export const CHECKOUT_SUPERSEDED_ERROR = "checkout_superseded" as const;

/**
 * Statusy operatora, w których subskrypcja planu trwa i obciąża (albo zaraz
 * obciąży) - te blokują drugi zakup. `incomplete` celowo poza zbiorem
 * (reguła 3): to pierwsza płatność w zawieszeniu, którą kasa unieważnia
 * u operatora, zanim otworzy nową sesję.
 */
export const LIVE_PLAN_SUBSCRIPTION_STATUSES: ReadonlySet<string> = new Set([
  "active",
  "trialing",
  "past_due",
  "unpaid",
  "paused",
]);

/** Pierwsza płatność w zawieszeniu (3DS, przelew) - do unieważnienia u operatora. */
export const PENDING_FIRST_PAYMENT_STATUS = "incomplete" as const;

/** Statusy subskrypcji, która nigdy nie wystartowała - nie zużywają triala. */
const NEVER_STARTED_STATUSES: ReadonlySet<string> = new Set([
  PENDING_FIRST_PAYMENT_STATUS,
  "incomplete_expired",
]);

/**
 * Jak istniejąca żywa subskrypcja ma się do zakupu planu (reguła 1):
 *   * `change_plan` - cel osiągalny zmianą planu (`/profile/plan`),
 *   * `same_plan`   - to jest bieżący plan (`/profile/subscription`),
 *   * `unmanaged`   - bieżąca cena spoza katalogu: tylko portal operatora.
 * Osobny zakup (inny model rozliczenia) NIE jest konfliktem - funkcja
 * `planPurchaseConflict` zwraca wtedy `null`.
 */
export type PlanPurchaseConflict = "change_plan" | "same_plan" | "unmanaged";

/**
 * Relacja bieżącej ceny (`lookup_key` żywej subskrypcji) z ceną zakupu.
 *
 * Bez celu albo z bieżącą ceną spoza katalogu - `unmanaged` (fail-closed):
 * „nie wiem, co to za subskrypcja" nie może znaczyć „kupuj drugą". Bieżąca
 * pozycja jednorazowa (np. miejsce w Decision Labie założone kiedyś jako cena
 * cykliczna) też nie ma ścieżki zmiany planu.
 */
export function planPurchaseConflict(
  currentLookupKey: string | null | undefined,
  target: CatalogPriceEntry | null | undefined,
): PlanPurchaseConflict | null {
  const current = catalogEntryByPriceId(currentLookupKey);
  if (!current || current.oneTime || !target) return "unmanaged";
  const refusal = catalogSwitchRefusal(current, target);
  if (refusal === null) return "change_plan";
  if (refusal === "same_plan") return "same_plan";
  // `plan_kind_mismatch`: zmiana planu mówi „wymaga nowego zakupu" - to jest
  // ten zakup. Inne odmowy dotyczą celu niecyklicznego, który tu nie trafia.
  if (refusal === "plan_kind_mismatch") return null;
  return "unmanaged";
}

export interface PlanSubscriptionRecord {
  status: string | null | undefined;
  /** `metadata.purpose` subskrypcji u operatora (`donation` = nie plan). */
  purpose?: string | null;
  /** `lookup_key` ceny subskrypcji (w lustrze: `subscriptions.price_id`). */
  lookupKey?: string | null;
}

export interface PlanSubscriptionHistory {
  /** Czy żywa subskrypcja planu koliduje z tym zakupem (drugi checkout = podwójne obciążenie). */
  hasLive: boolean;
  /** Czy kiedykolwiek wystartowała subskrypcja planu (trial już wykorzystany). */
  hadAny: boolean;
  /** Najmocniejszy konflikt (dla komunikatu) albo `null`, gdy zakup przechodzi. */
  conflict: PlanPurchaseConflict | null;
}

/** Kolejność ważności konfliktów: komunikat mówi o tym, który blokuje najtwardziej. */
const CONFLICT_WEIGHT: Record<PlanPurchaseConflict, number> = {
  change_plan: 1,
  same_plan: 2,
  unmanaged: 3,
};

export function isLivePlanSubscriptionStatus(status: string | null | undefined): boolean {
  return typeof status === "string" && LIVE_PLAN_SUBSCRIPTION_STATUSES.has(status);
}

/**
 * Zbiera historię subskrypcji PLANU (darowizny odpadają) względem zakupu
 * `target`. Bez celu każda żywa subskrypcja blokuje (`unmanaged`) - wołający,
 * który nie wie, co kupuje, nie dostaje furtki „osobnego zakupu".
 */
export function planSubscriptionHistory(
  records: readonly PlanSubscriptionRecord[],
  target?: CatalogPriceEntry | null,
): PlanSubscriptionHistory {
  let hadAny = false;
  let conflict: PlanPurchaseConflict | null = null;
  for (const record of records) {
    if (record.purpose === "donation") continue;
    const status = typeof record.status === "string" ? record.status : "";
    if (status && !NEVER_STARTED_STATUSES.has(status)) hadAny = true;
    if (!isLivePlanSubscriptionStatus(status)) continue;
    const found = planPurchaseConflict(record.lookupKey, target);
    if (found && (!conflict || CONFLICT_WEIGHT[found] > CONFLICT_WEIGHT[conflict])) {
      conflict = found;
    }
  }
  return { hasLive: conflict !== null, hadAny, conflict };
}

/** Łączy historie z dwóch źródeł - wystarczy ślad w którymkolwiek. */
export function mergePlanSubscriptionHistory(
  ...histories: readonly PlanSubscriptionHistory[]
): PlanSubscriptionHistory {
  let conflict: PlanPurchaseConflict | null = null;
  for (const history of histories) {
    const found = history.conflict;
    if (found && (!conflict || CONFLICT_WEIGHT[found] > CONFLICT_WEIGHT[conflict])) {
      conflict = found;
    }
  }
  return {
    hasLive: histories.some((h) => h.hasLive),
    hadAny: histories.some((h) => h.hadAny),
    conflict,
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
 * wiersze sandboxa i produkcji leżą w jednej tabeli. `price_id` lustra to
 * `lookup_key` ceny (`readIds` w webhooku), więc relację z celem liczy ta
 * sama reguła co u operatora.
 *
 * Błąd odczytu RZUCA: „nie wiem" nie może oznaczać „nie ma subskrypcji" -
 * fail-open dałby drugie obciążenie i kolejny trial przy pierwszej awarii bazy.
 */
export async function loadLocalPlanSubscriptionHistory(
  supabase: SupabaseClient<Database>,
  input: { userId: string; environment: string; target: CatalogPriceEntry | null },
): Promise<PlanSubscriptionHistory> {
  const { data, error } = await supabase
    .from("subscriptions")
    .select("status, price_id")
    .eq("user_id", input.userId)
    .eq("environment", input.environment)
    .limit(100);
  if (error) throw new Error(`subscription history lookup failed: ${error.message}`);
  return planSubscriptionHistory(
    (data ?? []).map((row) => ({ status: row.status, lookupKey: row.price_id })),
    input.target,
  );
}

/**
 * Konflikt zakupu z subskrypcją pokazywaną w nakładce (najnowszy wiersz
 * lustra). Tylko PODPOWIEDŹ przed kliknięciem - serwer liczy to samo na
 * pełnej historii i u operatora.
 */
export function visiblePlanPurchaseConflict(
  existing: { status?: string | null; price_id?: string | null } | null | undefined,
  target: CatalogPriceEntry | null | undefined,
): PlanPurchaseConflict | null {
  if (!existing || !isLivePlanSubscriptionStatus(existing.status)) return null;
  return planPurchaseConflict(existing.price_id, target);
}
