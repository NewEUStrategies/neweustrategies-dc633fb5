// Zakładki panelu kuponów B2B - REGUŁA PODŚWIETLENIA wyjęta z layoutu
// (`src/routes/admin.coupons.tsx`, linia 51 przed ekstrakcją).
//
// PO CO OSOBNY MODUŁ NA JEDEN WARUNEK. `pathname === to` kontra
// `pathname.startsWith(to)` to nie kosmetyka: adres listy („/admin/coupons")
// jest PREFIKSEM wszystkich pozostałych zakładek, więc bez `exact` każda
// podstrona podświetlałaby DWIE zakładki naraz. Odwrotnie: gdyby `exact`
// dostały też kampanie, ich podstrona („/admin/coupons/campaigns/xyz") nie
// podświetlałaby żadnej. Warunek jest przemienny wyłącznie z pozoru i dlatego
// ma własną tabelę przypadków w teście.
//
// GRANICA WARSTW: zero Reacta, zero i18n - opis zakładki niesie ADRES, nie
// napis (etykiety zostają tam, gdzie jest język interfejsu).

/** Opis zakładki w części, od której zależy podświetlenie. */
export interface CouponTabTarget {
  to: string;
  /** Dopasowanie DOKŁADNE zamiast prefiksowego - konieczne dla adresu listy. */
  exact?: boolean;
}

/** Adresy czterech zakładek, w kolejności wyświetlania. */
export const COUPON_TAB_TARGETS: readonly CouponTabTarget[] = [
  { to: "/admin/coupons", exact: true },
  { to: "/admin/coupons/campaigns" },
  { to: "/admin/coupons/redemptions" },
  { to: "/admin/coupons/analytics" },
];

/** Czy zakładka jest bieżąca dla podanego adresu. */
export function isCouponTabActive(tab: CouponTabTarget, pathname: string): boolean {
  return tab.exact ? pathname === tab.to : pathname.startsWith(tab.to);
}
