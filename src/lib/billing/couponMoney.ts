/**
 * Semantyka pieniędzy w realizacji kuponu B2B - jedno źródło prawdy dla klienta.
 *
 * `b2b_coupon_redemptions.applied_cents` to RABAT zastosowany do zamówienia, a
 * nie kwota zapłacona. Pisarzem jest checkout:
 *   redeem_b2b_coupon(_applied_cents := couponDiscountCents, _original_cents := originalCents)
 * czyli niezmiennik:
 *   original_cents = applied_cents (rabat) + zapłacone (przychód netto)
 *
 * Nazwa kolumny sugeruje jednak „kwotę po zastosowaniu kuponu", i dokładnie tak
 * przeczytała ją zarówno funkcja `b2b_coupons_analytics`, jak i panel realizacji:
 * kolumny Przychód i Rabat były podmienione, więc kupon o największym rabacie
 * wyglądał na najbardziej dochodowy. Trzymamy więc obliczenia w jednym,
 * nazwanym i przetestowanym miejscu - żeby ta inwersja nie mogła wrócić po cichu
 * przy kolejnym `sum(applied_cents)` wpisanym z pamięci.
 */

/** Minimalny kształt wiersza realizacji potrzebny do rozliczenia kwot. */
export interface CouponRedemptionAmounts {
  /** Rabat zastosowany przy realizacji (grosze/centy). */
  readonly applied_cents: number;
  /** Kwota zamówienia PRZED rabatem. */
  readonly original_cents: number;
}

/** Rabat udzielony przy tej realizacji. */
export function couponDiscountCents(row: CouponRedemptionAmounts): number {
  return row.applied_cents;
}

/**
 * Przychód netto z realizacji = kwota, którą klient faktycznie zapłacił.
 * Zaciskamy do zera: rabat większy od kwoty bazowej byłby danymi niespójnymi,
 * a ujemny „przychód" cicho zaniżałby sumy w raporcie.
 */
export function couponPaidCents(row: CouponRedemptionAmounts): number {
  return Math.max(0, row.original_cents - row.applied_cents);
}

export interface CouponTotals {
  readonly count: number;
  /** Suma kwot przed rabatem. */
  readonly originalCents: number;
  /** Suma udzielonych rabatów. */
  readonly discountCents: number;
  /** Suma kwot zapłaconych (przychód netto). */
  readonly revenueCents: number;
}

/** Agregaty dla listy realizacji (kafle podsumowania + eksport CSV). */
export function sumCouponTotals(rows: readonly CouponRedemptionAmounts[]): CouponTotals {
  let originalCents = 0;
  let discountCents = 0;
  let revenueCents = 0;
  for (const row of rows) {
    originalCents += row.original_cents;
    discountCents += couponDiscountCents(row);
    revenueCents += couponPaidCents(row);
  }
  return { count: rows.length, originalCents, discountCents, revenueCents };
}
