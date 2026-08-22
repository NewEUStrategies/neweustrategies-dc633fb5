// Mapowanie katalogu planów aplikacji (access_plans) na czytelne identyfikatory
// cen u dostawcy płatności. Klucz = `${tier_key}:${interval}` - dzięki temu
// zmiana kwoty po stronie dostawcy nie wymaga migracji, a webhook potrafi
// odwzorować cenę z powrotem na plan w bazie.
//
// Moduł jest czysty (bez zależności serwerowych), więc korzysta z niego zarówno
// przeglądarka (checkout), jak i handler webhooka.

export type PlanBillingInterval = "two_weeks" | "month" | "quarter" | "year" | "one_time";

export interface CatalogPriceEntry {
  /** external_id ceny u dostawcy. */
  priceId: string;
  /** external_id produktu u dostawcy. */
  productId: string;
  tierKey: string;
  interval: PlanBillingInterval;
  /** Ranga do wykrywania upgrade/downgrade (wyższa = wyższy plan). */
  rank: number;
  /** Rozliczenie za miejsce (seat) - checkout pozwala wybrać ilość. */
  perSeat?: boolean;
  /**
   * Cena jednorazowa (bez cyklu rozliczeniowego). Sesja checkoutu wybiera tryb
   * po `price.type`, więc pozycja jednorazowa nie zakłada subskrypcji ani
   * zdarzeń `customer.subscription.*` - patrz `createPlanCheckoutSession`.
   */
  oneTime?: boolean;
  /**
   * Cena rośnie schodkowo z liczbą miejsc: po osiągnięciu progu WSZYSTKIE
   * miejsca liczą się po niższej stawce (`tiers_mode: "volume"` u operatora),
   * nie tylko nadwyżka ponad próg. Wartości progu i stawki są w
   * `access_plans.volume_threshold_seats` / `volume_price_cents`, bo to katalog
   * aplikacji jest źródłem prawdy o kwotach - tutaj stoi wyłącznie deklaracja,
   * że dana cena ma być u operatora założona jako schodkowa.
   */
  volumeTiered?: boolean;
}

export const BILLING_CATALOG: readonly CatalogPriceEntry[] = [
  {
    priceId: "student_monthly",
    productId: "plan_student",
    tierKey: "student",
    interval: "month",
    rank: 10,
  },
  {
    priceId: "educator_monthly",
    productId: "plan_educator",
    tierKey: "educator",
    interval: "month",
    rank: 20,
  },
  {
    priceId: "plus_monthly",
    productId: "plan_plus",
    tierKey: "member",
    interval: "month",
    rank: 30,
  },
  { priceId: "plus_annual", productId: "plan_plus", tierKey: "member", interval: "year", rank: 31 },
  { priceId: "pro_monthly", productId: "plan_pro", tierKey: "pro", interval: "month", rank: 40 },
  { priceId: "pro_annual", productId: "plan_pro", tierKey: "pro", interval: "year", rank: 41 },
  {
    priceId: "team_monthly_seat",
    productId: "plan_team",
    tierKey: "team",
    interval: "month",
    rank: 50,
    perSeat: true,
    // Katalog v6.1: rabat wolumenowy od 11 miejsc. Bez tej flagi operator
    // liczyłby każde miejsce po stawce podstawowej, a rabat z cennika byłby
    // obietnicą bez mechanizmu.
    volumeTiered: true,
  },
  // Decision Lab: miejsce w cyklu dla podmiotu spoza partnerstwa. Produkt
  // jednorazowy, nie próg w drabince - zakup nie nadaje żadnej rangi
  // (`decision_lab` świadomie nie ma odpowiednika w `membership_tiers`).
  {
    priceId: "decision_lab_seat",
    productId: "product_decision_lab",
    tierKey: "decision_lab",
    interval: "one_time",
    rank: 0,
    oneTime: true,
  },
  // Partner Biznesowy: subskrypcja dla firm (zamiast sprzedaży reklam - AUP
  // operatora). Trzy cykle; dłuższy cykl = wyższa ranga (jak plus/pro yearly).
  {
    priceId: "business_2w",
    productId: "plan_business",
    tierKey: "business",
    interval: "two_weeks",
    rank: 60,
  },
  {
    priceId: "business_monthly",
    productId: "plan_business",
    tierKey: "business",
    interval: "month",
    rank: 61,
  },
  {
    priceId: "business_quarterly",
    productId: "plan_business",
    tierKey: "business",
    interval: "quarter",
    rank: 62,
  },
] as const;

function normalizeInterval(interval: string | null | undefined): PlanBillingInterval {
  if (
    interval === "two_weeks" ||
    interval === "quarter" ||
    interval === "year" ||
    interval === "one_time"
  ) {
    return interval;
  }
  return "month";
}

/** Znajdź cenę dostawcy dla planu z `access_plans`. */
export function catalogPriceForPlan(plan: {
  tier_key?: string | null;
  interval?: string | null;
}): CatalogPriceEntry | null {
  const tier = plan.tier_key ?? "";
  if (!tier) return null;
  const interval = normalizeInterval(plan.interval);
  return (
    BILLING_CATALOG.find((e) => e.tierKey === tier && e.interval === interval) ??
    BILLING_CATALOG.find((e) => e.tierKey === tier) ??
    null
  );
}

/** Odwrotne mapowanie: czytelny identyfikator ceny -> wpis katalogu. */
export function catalogEntryByPriceId(
  priceId: string | null | undefined,
): CatalogPriceEntry | null {
  if (!priceId) return null;
  return BILLING_CATALOG.find((e) => e.priceId === priceId) ?? null;
}

/** Kierunek zmiany planu: upgrade rozliczamy od razu, downgrade od nowego okresu. */
export function planChangeDirection(
  fromPriceId: string | null | undefined,
  toPriceId: string | null | undefined,
): "upgrade" | "downgrade" | "same" {
  const from = catalogEntryByPriceId(fromPriceId);
  const to = catalogEntryByPriceId(toPriceId);
  if (!from || !to || from.priceId === to.priceId) return "same";
  return to.rank > from.rank ? "upgrade" : "downgrade";
}
