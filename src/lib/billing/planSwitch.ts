// Zestawienie ścieżek zmiany planu wyprowadzone z lookup_key (czytelnego
// identyfikatora ceny u operatora), a NIE z kwoty w bazie: kwota może się
// różnić po stronie operatora, natomiast lookup_key i ranga katalogu są
// stabilne między sandboxem a produkcją. Dzięki temu „wyżej/niżej" na stronie
// planu znaczy dokładnie to samo, co proracja liczona przy zmianie subskrypcji.
//
// JEDNA REGUŁA „NA CO WOLNO PRZEŁĄCZYĆ" DLA UI I SERWERA. Do audytu SUB-14
// filtr celów żył wyłącznie w komponentach (trzy różne kopie), a serwer
// (`changeStripePlan`) sprawdzał tylko, czy lookup_key istnieje w katalogu -
// wywołanie z pominięciem UI przełączało na plan nieaktywny w najemcy, na
// `decision_lab_seat` albo z planu Zespół (za miejsce) na plan indywidualny.
// Teraz `planSwitchRefusal` jest tym samym predykatem w obu miejscach: UI nie
// pokaże celu, którego serwer nie przyjmie, a serwer nie przyjmie celu,
// którego UI by nie pokazało.
//
// Moduł czysty (bez zależności serwerowych i UI) - dzięki temu testowalny i
// współdzielony przez widok profilu, kartę operatora i bramkę serwerową
// (`planSwitch.server.ts`, `subscriptionProvider.server.ts`).
import {
  BILLING_CATALOG,
  catalogEntryByPriceId,
  catalogPriceForPlan,
  type CatalogPriceEntry,
} from "@/lib/billing/catalog";
import type { AccessPlan } from "@/lib/billing/types";

export type PlanSwitchDirection = "upgrade" | "downgrade";

/** Minimalny kształt planu, jakiego potrzebuje reguła (wiersz `access_plans`). */
export interface SwitchablePlan {
  active: boolean;
  interval: string | null;
  tier_key: string | null;
}

export interface PlanSwitchOption<P extends SwitchablePlan = AccessPlan> {
  plan: P;
  /** Czytelny identyfikator ceny u operatora (Stripe `lookup_key`). */
  lookupKey: string;
  entry: CatalogPriceEntry;
  direction: PlanSwitchDirection;
}

export interface PlanSwitchBoardModel {
  /** lookup_key bieżącego planu - null, gdy brak subskrypcji lub planu w katalogu. */
  currentLookupKey: string | null;
  currentEntry: CatalogPriceEntry | null;
  upgrades: PlanSwitchOption[];
  downgrades: PlanSwitchOption[];
}

/**
 * Powód odmowy zmiany planu. Kody są kontraktem serwera (lecą w błędzie do UI),
 * więc nie zmieniamy ich nazw bez przejrzenia wywołujących.
 * - `plan_not_found`      - plan nieaktywny (nie zdradzamy, że istnieje),
 * - `plan_not_recurring`  - przepustka/zakup jednorazowy, nie cykl,
 * - `plan_not_switchable` - brak ŚCISŁEGO odpowiednika (tier, interwał)
 *                            w katalogu albo pozycja jednorazowa (Decision Lab),
 * - `plan_kind_mismatch`  - przejście między planem za miejsce (Zespół)
 *                            a indywidualnym: zmienia model rozliczenia
 *                            i organizację, więc wymaga nowego zakupu,
 * - `same_plan`           - cel jest bieżącą ceną.
 */
export type PlanSwitchRefusal =
  | "plan_not_found"
  | "plan_not_recurring"
  | "plan_not_switchable"
  | "plan_kind_mismatch"
  | "same_plan";

/** Plany rozliczane cyklicznie - jednorazowe zakupy nie są ścieżką zmiany. */
const RECURRING = new Set<string>(["two_weeks", "month", "quarter", "year"]);

/**
 * Pozycja katalogu, NA KTÓRĄ da się przełączyć dany plan - dopasowanie ŚCISŁE
 * po parze (tier, interwał). `catalogPriceForPlan` ma fallback „pierwsza cena
 * tieru", który przy zakupie jest wygodny, ale przy zmianie planu podmieniłby
 * np. plan „Partner roczny" na cenę dwutygodniową: klient wybrałby jedno,
 * a operator obciążałby za drugie.
 */
export function switchEntryForPlan(plan: {
  tier_key?: string | null;
  interval?: string | null;
}): CatalogPriceEntry | null {
  if (!plan.tier_key || !plan.interval || !RECURRING.has(plan.interval)) return null;
  return (
    BILLING_CATALOG.find(
      (e) => !e.oneTime && e.tierKey === plan.tier_key && e.interval === plan.interval,
    ) ?? null
  );
}

/**
 * Reguła na poziomie KATALOGU (bieżąca cena -> cena docelowa). Woła ją także
 * operacja u dostawcy na ŻYWYM stanie subskrypcji, więc odmowa nie zależy od
 * tego, czy lustro w bazie zdążyło się odświeżyć.
 */
export function catalogSwitchRefusal(
  current: CatalogPriceEntry,
  target: CatalogPriceEntry | null,
): PlanSwitchRefusal | null {
  if (!target || target.oneTime || !RECURRING.has(target.interval)) return "plan_not_switchable";
  if (current.priceId === target.priceId) return "same_plan";
  if (Boolean(current.perSeat) !== Boolean(target.perSeat)) return "plan_kind_mismatch";
  return null;
}

/**
 * Czy plan jest legalnym celem samoobsługowej zmiany względem bieżącej ceny.
 * `null` = wolno. Bez bieżącej ceny (`current === null`) sprawdzamy wyłącznie
 * sam plan - tak liczy się lista wejścia (pierwszy zakup), nie zmiana.
 */
export function planSwitchRefusal(
  plan: SwitchablePlan,
  current: CatalogPriceEntry | null,
): PlanSwitchRefusal | null {
  if (!plan.active) return "plan_not_found";
  if (!plan.interval || !RECURRING.has(plan.interval)) return "plan_not_recurring";
  const entry = switchEntryForPlan(plan);
  if (!entry) return "plan_not_switchable";
  return current ? catalogSwitchRefusal(current, entry) : null;
}

/**
 * Legalne cele zmiany planu w kolejności wejściowej (UI podaje plany po
 * `sort_order`, serwer czyta je w tej samej kolejności). Dwa plany najemcy na
 * tę samą parę (tier, interwał) dają JEDEN cel - pierwszy wygrywa po obu
 * stronach, więc wybór w UI i rozstrzygnięcie serwera wskazują ten sam wiersz.
 */
export function switchTargets<P extends SwitchablePlan>(
  plans: readonly P[],
  current: CatalogPriceEntry | null,
): PlanSwitchOption<P>[] {
  const seen = new Set<string>();
  const options: PlanSwitchOption<P>[] = [];
  for (const plan of plans) {
    if (planSwitchRefusal(plan, current) !== null) continue;
    const entry = switchEntryForPlan(plan);
    if (!entry || seen.has(entry.priceId)) continue;
    seen.add(entry.priceId);
    // Brak bieżącego planu = wszystko jest wejściem „w górę" (pierwszy zakup).
    const direction: PlanSwitchDirection =
      current && entry.rank < current.rank ? "downgrade" : "upgrade";
    options.push({ plan, lookupKey: entry.priceId, entry, direction });
  }
  return options;
}

/**
 * Dzieli aktywne plany na ścieżkę w górę i w dół względem bieżącego lookup_key.
 * Plany, których serwer by nie przyjął (`planSwitchRefusal`), są pomijane -
 * pokazanie ich kończyłoby się błędem po kliknięciu.
 */
export function buildPlanSwitchBoard(
  plans: readonly AccessPlan[],
  currentPlan: AccessPlan | null | undefined,
): PlanSwitchBoardModel {
  const currentEntry = currentPlan ? catalogPriceForPlan(currentPlan) : null;
  const currentLookupKey = currentEntry?.priceId ?? null;

  const options = switchTargets(plans, currentEntry);
  const upgrades = options.filter((o) => o.direction === "upgrade");
  const downgrades = options.filter((o) => o.direction === "downgrade");

  upgrades.sort((a, b) => a.entry.rank - b.entry.rank);
  downgrades.sort((a, b) => b.entry.rank - a.entry.rank);

  return { currentLookupKey, currentEntry, upgrades, downgrades };
}

/** Czy dany lookup_key jest znany katalogowi (bezpieczeństwo wywołania zmiany). */
export function isKnownLookupKey(lookupKey: string | null | undefined): boolean {
  return catalogEntryByPriceId(lookupKey) !== null;
}

/** Kody wyniku, w których dopłata nie przeszła, a zmiana NIE weszła w życie. */
const PAYMENT_OUTCOMES = new Set(["payment_failed", "payment_requires_action"]);

/**
 * Klucz komunikatu dla odmowy zmiany planu / liczby miejsc / wznowienia.
 * Odmowa dopłaty dostaje WŁASNY komunikat („zmiana nie weszła, opłać
 * fakturę"), bo ogólne „nie udało się" przy pobranej próbie płatności
 * sugeruje awarię, a klient ma tu konkretny krok do wykonania.
 */
export function paymentOutcomeMessageKey(code: string | null | undefined): string | null {
  if (!isPaymentOutcomeCode(code)) return null;
  return code === "payment_requires_action"
    ? "profile.subscription.payment.requiresAction"
    : "profile.subscription.payment.failed";
}

/** Czy kod wyniku to odmowa dopłaty (zmiana nie weszła, czeka faktura operatora). */
export function isPaymentOutcomeCode(
  code: string | null | undefined,
): code is "payment_failed" | "payment_requires_action" {
  return !!code && PAYMENT_OUTCOMES.has(code);
}

/**
 * Odmowy DOMENOWE z własnym komunikatem. Ogólne „nie udało się, spróbuj
 * ponownie" przy pauzie poboru ustawionej przez operatora odsyłało klienta do
 * ponowień, które nigdy nie przejdą - tę pauzę przy nieopłaconym okresie
 * zdejmuje wyłącznie operator (`resumeProviderSubscription`).
 */
// `Map`, nie literał obiektu: kod pochodzi z treści błędu, a `"toString"`
// trafiłby w prototyp i oddał funkcję zamiast klucza.
const DOMAIN_REFUSAL_KEYS: ReadonlyMap<string, string> = new Map([
  ["subscription_paused_by_operator", "profile.subscription.pausedByOperator"],
]);

export function subscriptionRefusalMessageKey(code: string | null | undefined): string | null {
  return (code && DOMAIN_REFUSAL_KEYS.get(code)) || null;
}
