// Wycena planu z katalogu dla kasy - JEDNA reguła dla obu silników checkoutu
// (`checkout.functions.ts` i `stripeCheckout.functions.ts`).
//
// DLACZEGO OSOBNY MODUŁ. Drugi silnik brał cenę (`priceId`) i liczbę sztuk
// prosto z żądania, a kwotę zamówienia z `access_plans.price_cents`. Ręcznie
// złożone żądanie z planem A i ceną `pro_annual` dawało zamówienie na plan A
// opłacone ceną Pro - z rabatem kwotowym dopasowanym do droższego planu
// pierwsza faktura Pro wychodziła na 0 zł (audyt PAY-01). Cena, ilość, kwota,
// rodzaj zamówienia i tryb sesji są teraz wyprowadzane WYŁĄCZNIE z wiersza
// planu, w jednym miejscu, więc oba silniki nie mogą się w tym rozjechać.
//
// WYŁĄCZNIE DOKŁADNA PARA (warstwa, cykl). Pozycję, ilość, próg wolumenowy
// i kwotę liczy `catalogPlanQuote` z `catalog.ts` (ta sama reguła, z której
// korzysta synchronizacja katalogu - audyt SUB-05), a cykl ceny u operatora -
// `catalogRecurringFor` (jeden słownik dla zakładania ceny i dla kontroli
// w kasie). Ten moduł dokłada to, czego katalog nie wie o zamówieniu: rodzaj
// zamówienia i tryb sesji wynikające z planu, ze sprawdzeniem, że plan
// jednorazowy trafia w cenę jednorazową, a cykliczny w cykliczną (przegląd
// PAY-01, 0.0/0.1).
//
// Moduł czysty (bez zależności serwerowych) - korzysta z niego kasa po stronie
// serwera, a testy jednostkowe wołają go bez atrap.
import {
  catalogPlanQuote,
  catalogRecurringFor,
  type CatalogPriceEntry,
  type CatalogRecurring,
} from "@/lib/billing/catalog";

// Dokładna para i limit miejsc żyją w `catalog.ts` (wspólne z synchronizacją
// katalogu i wyceną `catalogPlanQuote`); tu re-eksport, żeby kasa i testy
// wyceny miały całą regułę pod jednym adresem.
export { exactCatalogEntryForPlan, MAX_PLAN_SEATS } from "@/lib/billing/catalog";

/** Kolumny `access_plans`, z których liczy się wycena. */
export interface PlanPricingRow {
  tier_key?: string | null;
  interval?: string | null;
  price_cents?: number | null;
  volume_threshold_seats?: number | null;
  volume_price_cents?: number | null;
}

export interface PlanCheckoutPricing {
  /** Wpis katalogu - `entry.priceId` to `lookup_key` ceny u operatora. */
  entry: CatalogPriceEntry;
  /** Liczba sztuk pozycji sesji (miejsca tylko dla planów `perSeat`). */
  quantity: number;
  /** Stawka za JEDNĄ sztukę po progu wolumenowym - tyle ma liczyć cena u operatora. */
  unitCents: number;
  /** Kwota BRUTTO za wszystkie sztuki, przed kuponem i przed podatkiem. */
  amountCents: number;
  /** Rodzaj zamówienia: plan jednorazowy nie zakłada subskrypcji. */
  kind: "subscription" | "one_time";
  /** Tryb sesji Stripe, który MUSI zgadzać się z typem ceny u operatora. */
  mode: "subscription" | "payment";
  /**
   * Cykl, który MUSI mieć cena u operatora (`recurring.interval` +
   * `interval_count`, słownik `catalogRecurringFor`); `null` dla planu
   * jednorazowego. Kasa sprawdza go przed sesją (`catalogCycleMismatch`).
   */
  recurring: CatalogRecurring | null;
}

/**
 * Wycena planu: wpis katalogu, ilość, kwota, rodzaj zamówienia, tryb sesji
 * i oczekiwany cykl ceny. `null`, gdy plan nie ma spójnej ceny katalogowej -
 * kasa odmawia wtedy PRZED rezerwacją kuponu i założeniem zamówienia.
 *
 * Plan jednorazowy (`interval = one_time`) musi trafić w cenę jednorazową,
 * a plan cykliczny w cykliczną. Przy dokładnej parze to zachodzi z definicji
 * katalogu; sprawdzenie zostaje jako drugi zamek na wypadek wpisu katalogu
 * z flagą `oneTime` niezgodną z cyklem.
 *
 * Liczba miejsc z żądania liczy się wyłącznie dla wpisów `perSeat`
 * i jest docinana do 1..100 (`catalogPlanQuote`). Próg wolumenowy (katalog
 * v6.1: Zespół od 11 miejsc po 79 zł) przecenia WSZYSTKIE miejsca - cena
 * u operatora jest schodkowa w trybie `volume` (patrz `catalogSync.server.ts`),
 * więc kwota zamówienia musi liczyć tak samo, inaczej klient zobaczy w kasie
 * inną kwotę niż na fakturze.
 */
export function planCheckoutPricing(
  plan: PlanPricingRow,
  seats?: number | null,
): PlanCheckoutPricing | null {
  const quote = catalogPlanQuote(plan, seats);
  if (!quote) return null;
  const { entry } = quote;

  const planOneTime = entry.interval === "one_time";
  const entryOneTime = entry.oneTime === true;
  if (planOneTime !== entryOneTime) return null;

  const kind = planOneTime ? "one_time" : "subscription";
  return {
    ...quote,
    kind,
    mode: kind === "one_time" ? "payment" : "subscription",
    recurring: catalogRecurringFor(entry),
  };
}
