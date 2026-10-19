// FABRYKA KLUCZY REACT QUERY KUPONÓW B2B (/admin/coupons).
//
// WŁASNY LITERAŁ, NIE IMPORT `ADMIN_COUPONS_KEY`. `couponQueries.ts` importuje
// klienta React Query (typ) i fabrykę analityki, a ten moduł czyta mapa szyny,
// więc musi być liściem bez importów runtime. Wartość jest identyczna (test
// `hubKeyFactories.test.ts`); S1 zamienia stałą w `couponQueries.ts` na
// re-eksport stąd i jedna definicja zostaje.
//
// `admin()` jest prefiksem katalogów `plans()`/`tiers()` - mutacja kuponu
// unieważnia listę razem z katalogami, tak jak dziś `invalidateCouponQueries`.
export const couponKeys = {
  admin: () => ["admin", "b2b-coupons"] as const,
  /** Katalog planów w formularzu kuponu. */
  plans: () => ["admin", "b2b-coupons", "plans"] as const,
  /** Katalog warstw w formularzu kuponu i kampanii. */
  tiers: () => ["admin", "b2b-coupons", "tiers"] as const,
  campaigns: () => ["admin", "b2b-coupon-campaigns"] as const,
  redemptionsAll: () => ["admin", "b2b-coupon-redemptions"] as const,
  /** Realizacje w zakresie dat (ISO; `null` = bez granicy). */
  redemptions: (fromIso: string | null, toIso: string | null) =>
    ["admin", "b2b-coupon-redemptions", fromIso, toIso] as const,
} as const;
