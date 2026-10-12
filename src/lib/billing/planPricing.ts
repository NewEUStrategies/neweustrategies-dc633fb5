// Wycena planu z katalogu dla kasy - JEDNA reguła dla obu silników checkoutu
// (`checkout.functions.ts` i `stripeCheckout.functions.ts`).
//
// DLACZEGO OSOBNY MODUŁ. Drugi silnik brał cenę (`priceId`) i liczbę sztuk
// prosto z żądania, a kwotę zamówienia z `access_plans.price_cents`. Ręcznie
// złożone żądanie z planem A i ceną `pro_annual` dawało zamówienie na plan A
// opłacone ceną Pro - z rabatem kwotowym dopasowanym do droższego planu
// pierwsza faktura Pro wychodziła na 0 zł (audyt PAY-01). Cena, ilość, kwota
// i tryb sesji są teraz wyprowadzane WYŁĄCZNIE z wiersza planu, w jednym
// miejscu, więc oba silniki nie mogą się w tym rozjechać.
//
// Moduł czysty (bez zależności serwerowych) - korzysta z niego kasa po stronie
// serwera, a testy jednostkowe wołają go bez atrap.
import { catalogPriceForPlan, type CatalogPriceEntry } from "@/lib/billing/catalog";

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

export interface PlanCheckoutPricing {
  /** Wpis katalogu - `entry.priceId` to `lookup_key` ceny u operatora. */
  entry: CatalogPriceEntry;
  /** Liczba sztuk pozycji sesji (miejsca tylko dla planów `perSeat`). */
  quantity: number;
  /** Kwota BRUTTO za wszystkie sztuki, przed kuponem i przed podatkiem. */
  amountCents: number;
  /** Rodzaj zamówienia: plan jednorazowy nie zakłada subskrypcji. */
  kind: "subscription" | "one_time";
  /** Tryb sesji Stripe, który MUSI zgadzać się z typem ceny u operatora. */
  mode: "subscription" | "payment";
}

/**
 * Wycena planu: wpis katalogu, ilość, kwota i tryb sesji. `null`, gdy plan
 * nie ma spójnej ceny katalogowej - kasa odmawia wtedy PRZED rezerwacją
 * kuponu i założeniem zamówienia.
 *
 * Plan jednorazowy (`interval = one_time`) musi trafić w cenę jednorazową,
 * a plan cykliczny w cykliczną. `catalogPriceForPlan` przy braku dokładnej
 * pary (warstwa, cykl) schodzi na pierwszy wpis warstwy - dla planu Pro
 * oznaczonego jako jednorazowy byłaby to subskrypcja miesięczna. Taka
 * rozbieżność nie jest ceną planu, tylko błędem konfiguracji, więc wycena
 * jej nie przepuszcza.
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
  const entry = catalogPriceForPlan({ tier_key: plan.tier_key, interval: plan.interval });
  if (!entry) return null;

  const planOneTime = plan.interval === "one_time";
  const entryOneTime = entry.oneTime === true || entry.interval === "one_time";
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
    amountCents: unitCents * quantity,
    kind,
    mode: kind === "one_time" ? "payment" : "subscription",
  };
}
