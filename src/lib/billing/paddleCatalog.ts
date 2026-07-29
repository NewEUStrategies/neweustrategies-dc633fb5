// Mapowanie katalogu planów aplikacji (access_plans) na czytelne identyfikatory
// cen u dostawcy płatności. Klucz = `${tier_key}:${interval}` - dzięki temu
// zmiana kwoty po stronie dostawcy nie wymaga migracji, a webhook potrafi
// odwzorować cenę z powrotem na plan w bazie.
//
// Moduł jest czysty (bez zależności serwerowych), więc korzysta z niego zarówno
// przeglądarka (checkout), jak i handler webhooka.

export type PlanBillingInterval = "month" | "year";

export interface PaddlePriceEntry {
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
}

export const PADDLE_CATALOG: readonly PaddlePriceEntry[] = [
  { priceId: "student_monthly", productId: "plan_student", tierKey: "student", interval: "month", rank: 10 },
  { priceId: "educator_monthly", productId: "plan_educator", tierKey: "educator", interval: "month", rank: 20 },
  { priceId: "plus_monthly", productId: "plan_plus", tierKey: "member", interval: "month", rank: 30 },
  { priceId: "plus_yearly", productId: "plan_plus", tierKey: "member", interval: "year", rank: 31 },
  { priceId: "pro_monthly", productId: "plan_pro", tierKey: "pro", interval: "month", rank: 40 },
  { priceId: "pro_yearly", productId: "plan_pro", tierKey: "pro", interval: "year", rank: 41 },
  { priceId: "team_monthly_seat", productId: "plan_team", tierKey: "team", interval: "month", rank: 50, perSeat: true },
] as const;

function normalizeInterval(interval: string | null | undefined): PlanBillingInterval {
  return interval === "year" ? "year" : "month";
}

/** Znajdź cenę dostawcy dla planu z `access_plans`. */
export function paddlePriceForPlan(plan: {
  tier_key?: string | null;
  interval?: string | null;
}): PaddlePriceEntry | null {
  const tier = plan.tier_key ?? "";
  if (!tier) return null;
  const interval = normalizeInterval(plan.interval);
  return (
    PADDLE_CATALOG.find((e) => e.tierKey === tier && e.interval === interval) ??
    PADDLE_CATALOG.find((e) => e.tierKey === tier) ??
    null
  );
}

/** Odwrotne mapowanie: czytelny identyfikator ceny -> wpis katalogu. */
export function catalogEntryByPriceId(priceId: string | null | undefined): PaddlePriceEntry | null {
  if (!priceId) return null;
  return PADDLE_CATALOG.find((e) => e.priceId === priceId) ?? null;
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
