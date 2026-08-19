// Reguły wskaźników podsumowania newslettera.
//
// PO CO OSOBNO. Te cztery liczby są jedynym miejscem, w którym operator widzi,
// czy lista rośnie. Liczone są po stronie przeglądarki z surowych wierszy, więc
// pomyłka nie wywala się - podaje po prostu inną liczbę, a nikt nie ma jej z
// czym porównać:
//
//   * OKNA CZASOWE. „30 dni" i „poprzednie 30 dni" muszą się nie zachodzić -
//     inaczej wzrost liczy się częściowo sam ze siebie.
//   * WSKAŹNIK POTWIERDZEŃ (opt-in). Dzielenie przez zero przy pustej liście
//     musi dać 100%, nie NaN - „NaN%" w panelu to widoczna awaria, ale 0%
//     sugerowałoby, że NIKT nie potwierdza adresu.
//   * ZMIANA PROCENTOWA ze zera. Wzrost z 0 na cokolwiek to 100%, nie
//     nieskończoność; z 0 na 0 to 0%, nie 100%.
//   * TYLKO POTWIERDZENI liczą się jako subskrybenci - wliczenie „pending"
//     zawyżałoby listę o adresy, które nigdy nie potwierdziły zgody.

export const DAY_MS = 86_400_000;

/**
 * Limit wierszy ściąganych do przeglądarki. Agregacja idzie po stronie klienta,
 * więc limit jest częścią kontraktu: powyżej niego wskaźniki byłyby liczone z
 * URWANEJ próbki i cicho zaniżone.
 */
export const SUBSCRIBER_KPI_LIMIT = 50_000;

export interface SubscriberKpiRow {
  status: string;
  created_at: string;
  confirmed_at: string | null;
  unsubscribed_at: string | null;
}

export interface NewsletterKpis {
  total: number;
  pending: number;
  new30: number;
  growthPct: number;
  unsub30: number;
  unsubDeltaPct: number;
  optInRate: number;
}

/**
 * Zmiana procentowa. Ze zera na cokolwiek to 100% (nie nieskończoność), ze zera
 * na zero to 0% (nie 100%).
 */
export function pctDelta(recent: number, previous: number): number {
  if (previous === 0) return recent > 0 ? 100 : 0;
  return Math.round(((recent - previous) / previous) * 100);
}

/** Czy znacznik czasu wpada w ostatnie 30 dni (licząc od `now`). */
export function within30Days(iso: string | null, now: number): boolean {
  return iso ? now - Date.parse(iso) <= 30 * DAY_MS : false;
}

/**
 * Czy znacznik czasu wpada w POPRZEDNIE 30 dni (31-60 dni temu). Okna nie mogą
 * się zachodzić - inaczej wzrost liczyłby się częściowo sam ze siebie.
 */
export function withinPrevious30Days(iso: string | null, now: number): boolean {
  if (!iso) return false;
  const age = now - Date.parse(iso);
  return age > 30 * DAY_MS && age <= 60 * DAY_MS;
}

/** Wskaźniki podsumowania z surowych wierszy subskrybentów. */
export function computeKpis(rows: readonly SubscriberKpiRow[], now: number): NewsletterKpis {
  const in30 = (iso: string | null) => within30Days(iso, now);
  const in60 = (iso: string | null) => withinPrevious30Days(iso, now);

  // Subskrybentem jest TYLKO potwierdzony adres - „pending" to zgoda, której
  // nikt nie potwierdził.
  const total = rows.filter((r) => r.status === "subscribed").length;
  const pending = rows.filter((r) => r.status === "pending").length;
  const unsub30 = rows.filter((r) => in30(r.unsubscribed_at)).length;
  const unsub60 = rows.filter((r) => in60(r.unsubscribed_at)).length;
  const new30 = rows.filter((r) => in30(r.created_at)).length;
  const new60 = rows.filter((r) => in60(r.created_at)).length;
  const attempted = total + pending;
  // Pusta lista to 100%, nie NaN i nie 0%: nie ma nikogo, kto by nie potwierdził.
  const optInRate = attempted > 0 ? Math.round((total / attempted) * 100) : 100;

  return {
    total,
    pending,
    new30,
    growthPct: pctDelta(new30, new60),
    unsub30,
    unsubDeltaPct: pctDelta(unsub30, unsub60),
    optInRate,
  };
}
