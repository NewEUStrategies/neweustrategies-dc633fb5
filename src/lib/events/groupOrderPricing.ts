// Rabat kodu na zamówieniu grupowym (jedno zamówienie za prowadzącego i gości).
//
// KOD KWOTOWY DZIAŁA NA MIEJSCE, NIE NA ZAMÓWIENIE. Baza (`_b2b_coupon_evaluate`)
// liczy rabat od kwoty, którą dostanie - a kasa podaje jej sumę za wszystkie
// miejsca. Kod „-50 zł" zdejmowałby wtedy 50 zł z zamówienia na pięć osób,
// a każdy z pięciu biletów kupiony osobno dostałby po 50 zł. Grupa nie może
// płacić więcej niż te same osoby kupujące pojedynczo.
//
// KOD PROCENTOWY ZOSTAJE BEZ ZMIAN. Procent od sumy to procent od każdego
// miejsca, więc wynik bazy jest już poprawny.
//
// Moduł czysty: bez klienta bazy, bez Reacta - importuje go funkcja serwerowa
// kasy, a testy liczą na nim bez atrap.

export interface GroupCouponInput {
  /** `discount_kind` z bazy: `fixed` albo `percent` (inne traktujemy jak procent). */
  kind: string | null;
  /** Rabat policzony przez bazę od CAŁEJ kwoty zamówienia. */
  discountCents: number;
  /** Kwota po rabacie policzona przez bazę. */
  finalCents: number;
  /** Kwota całego zamówienia przed rabatem (cena miejsca × liczba miejsc). */
  totalCents: number;
  /** Liczba miejsc opłacanych tym zamówieniem (prowadzący + goście). */
  seats: number;
}

export interface GroupCouponResult {
  discountCents: number;
  finalCents: number;
}

export function groupCouponDiscount(input: GroupCouponInput): GroupCouponResult {
  const seats = Math.max(1, Math.trunc(input.seats));
  if (input.kind !== "fixed" || seats === 1) {
    return { discountCents: input.discountCents, finalCents: input.finalCents };
  }
  const total = Math.max(0, Math.round(input.totalCents));
  const unit = Math.floor(total / seats);
  // Baza zwraca LEAST(kwota_kodu, suma), więc przy sumie >= cenie miejsca
  // `min(rabat, cena miejsca)` to dokładnie `min(kwota_kodu, cena miejsca)` -
  // kod większy niż cena biletu nie schodzi poniżej zera na żadnym miejscu.
  const perSeat = Math.max(0, Math.min(Math.round(input.discountCents), unit));
  const discountCents = Math.min(perSeat * seats, total);
  return { discountCents, finalCents: total - discountCents };
}
