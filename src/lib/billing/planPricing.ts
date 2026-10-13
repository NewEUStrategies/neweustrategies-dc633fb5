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
// WYŁĄCZNIE DOKŁADNA PARA (warstwa, cykl). `catalogPriceForPlan` z `catalog.ts`
// służy interfejsowi i przy braku pary schodzi na PIERWSZY wpis warstwy, a cykl
// spoza słownika czyta jako miesiąc. W kasie to była cena za coś innego: plan
// „Pro kwartalny" otwierał subskrypcję `pro_monthly` (co miesiąc, inną kwotą),
// „Biznes roczny" - `business_2w` (co dwa tygodnie), a zamówienie zapisywało
// kwotę planu. Rozjazd wychodził dopiero po pobraniu pieniędzy (przegląd
// PAY-01, 0.1). Kasa bierze więc wpis wyłącznie dla DOKŁADNEJ pary i odmawia
// w każdym innym przypadku.
//
// Moduł czysty (bez zależności serwerowych) - korzysta z niego kasa po stronie
// serwera, a testy jednostkowe wołają go bez atrap.
import {
  BILLING_CATALOG,
  type CatalogPriceEntry,
  type PlanBillingInterval,
} from "@/lib/billing/catalog";

/** Górny limit miejsc w jednym zamówieniu - ten sam, co limit pozycji sesji. */
export const MAX_PLAN_SEATS = 100;

/** Kolumny `access_plans`, z których liczy się wycena. */
export interface PlanPricingRow {
  tier_key?: string | null;
  interval?: string | null;
  price_cents?: number | null;
  volume_threshold_seats?: number | null;
  volume_price_cents?: number | null;
}

/** Cykl ceny w słowniku operatora (Stripe zna wyłącznie day/week/month/year). */
export interface StripeRecurringCycle {
  interval: "day" | "week" | "month" | "year";
  intervalCount: number;
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
   * `interval_count`); `null` dla planu jednorazowego.
   */
  recurring: StripeRecurringCycle | null;
}

/**
 * Cykl rozliczeniowy ceny u operatora dla cyklu planu. Stripe zna wyłącznie
 * day/week/month/year, więc interwały aplikacji mapują się na krotności:
 * `two_weeks` -> week x2, `quarter` -> month x3. Ten sam słownik zakłada ceny
 * w `catalogSync.server.ts` (`billingCycle`) - kasa sprawdza nim, czy cena pod
 * kluczem nadal rozlicza się w cyklu planu. `null` = cena jednorazowa.
 */
export function stripeRecurringForInterval(
  interval: PlanBillingInterval,
): StripeRecurringCycle | null {
  switch (interval) {
    case "one_time":
      return null;
    case "two_weeks":
      return { interval: "week", intervalCount: 2 };
    case "quarter":
      return { interval: "month", intervalCount: 3 };
    case "year":
      return { interval: "year", intervalCount: 1 };
    case "month":
      return { interval: "month", intervalCount: 1 };
  }
}

/**
 * Wpis katalogu dla DOKŁADNEJ pary (warstwa, cykl) planu - bez schodzenia na
 * pierwszy wpis warstwy i bez czytania nieznanego cyklu jako miesiąca.
 */
export function exactCatalogEntryForPlan(plan: {
  tier_key?: string | null;
  interval?: string | null;
}): CatalogPriceEntry | null {
  const tier = plan.tier_key ?? "";
  const interval = plan.interval ?? "";
  if (!tier || !interval) return null;
  return BILLING_CATALOG.find((e) => e.tierKey === tier && e.interval === interval) ?? null;
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
 * i jest docinana do 1..100. Próg wolumenowy (katalog v6.1: Zespół od
 * 11 miejsc po 79 zł) przecenia WSZYSTKIE miejsca - cena u operatora jest
 * schodkowa w trybie `volume` (patrz `catalogSync.server.ts`), więc kwota
 * zamówienia musi liczyć tak samo, inaczej klient zobaczy w kasie inną kwotę
 * niż na fakturze.
 */
export function planCheckoutPricing(
  plan: PlanPricingRow,
  seats?: number | null,
): PlanCheckoutPricing | null {
  const entry = exactCatalogEntryForPlan(plan);
  if (!entry) return null;

  const planOneTime = entry.interval === "one_time";
  const entryOneTime = entry.oneTime === true;
  if (planOneTime !== entryOneTime) return null;

  const requestedSeats = typeof seats === "number" && Number.isFinite(seats) ? seats : 1;
  const quantity = entry.perSeat ? Math.min(Math.max(requestedSeats, 1), MAX_PLAN_SEATS) : 1;

  const baseUnitCents = Number(plan.price_cents ?? 0);
  const volumeThreshold = Number(plan.volume_threshold_seats ?? 0);
  const volumeUnitCents = Number(plan.volume_price_cents ?? 0);
  const unitCents =
    entry.perSeat && volumeThreshold >= 2 && quantity >= volumeThreshold
      ? volumeUnitCents
      : baseUnitCents;

  const kind = planOneTime ? "one_time" : "subscription";
  return {
    entry,
    quantity,
    unitCents,
    amountCents: unitCents * quantity,
    kind,
    mode: kind === "one_time" ? "payment" : "subscription",
    recurring: stripeRecurringForInterval(entry.interval),
  };
}
