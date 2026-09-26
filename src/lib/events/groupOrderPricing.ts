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
// MIEJSCE PROWADZĄCEGO BYWA TAŃSZE. Benefit planu członka (zniżka albo bilet
// z puli) obniża tylko JEGO miejsce, więc goście płacą więcej niż on. Kod
// kwotowy schodzi wtedy z każdego miejsca do jego własnej ceny: z gościa
// `min(kod, cena gościa)`, z prowadzącego `min(kod, cena prowadzącego)` -
// średnia ceny miejsca zaniżałaby rabat gości (lub zawyżała prowadzącego).
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
  /**
   * Cena miejsca prowadzącego przed rabatem, gdy różni się od miejsc gości.
   * Brak = wszystkie miejsca po tej samej cenie (`totalCents / seats`).
   */
  leadCents?: number;
}

export interface GroupCouponResult {
  discountCents: number;
  finalCents: number;
  /**
   * Rabat kodu kwotowego na jedno miejsce - gdy KAŻDE miejsce dostało ten sam
   * (ekran pokazuje „-20 zł × 3"); `null` dla procentu i dla miejsc, które
   * zeszły różnie (prowadzący tańszy od kodu).
   */
  perSeatCents: number | null;
}

export function groupCouponDiscount(input: GroupCouponInput): GroupCouponResult {
  const seats = Math.max(1, Math.trunc(input.seats));
  if (input.kind !== "fixed") {
    return { discountCents: input.discountCents, finalCents: input.finalCents, perSeatCents: null };
  }
  if (seats === 1) {
    return {
      discountCents: input.discountCents,
      finalCents: input.finalCents,
      perSeatCents: input.discountCents,
    };
  }
  const total = Math.max(0, Math.round(input.totalCents));
  const lead =
    input.leadCents === undefined
      ? null
      : Math.min(Math.max(0, Math.round(input.leadCents)), total);
  const guestUnit =
    lead === null ? Math.floor(total / seats) : Math.floor((total - lead) / (seats - 1));
  // Baza zwraca LEAST(kwota_kodu, suma), więc przy sumie >= cenie miejsca
  // `min(rabat, cena miejsca)` to dokładnie `min(kwota_kodu, cena miejsca)` -
  // kod większy niż cena biletu nie schodzi poniżej zera na żadnym miejscu.
  const code = Math.max(0, Math.round(input.discountCents));
  const perGuest = Math.min(code, guestUnit);
  const perLead = lead === null ? perGuest : Math.min(code, lead);
  const discountCents = Math.min(perLead + perGuest * (seats - 1), total);
  return {
    discountCents,
    finalCents: total - discountCents,
    perSeatCents: perLead === perGuest ? perGuest : null,
  };
}
