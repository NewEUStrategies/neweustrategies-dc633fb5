// Atom: komórka „Rabat" w tabeli kuponów.
//
// Ta sama pięciolinijkowa interpolacja stała w dwóch plikach tras (lista
// kuponów i kampanie). Atom domyka trzy decyzje o pieniądzach w jednym
// miejscu: procent `null` wypisuje literalne „null%", brak centów udaje
// darmowy kupon („0.00"), a brak waluty zostawia wiszącą liczbę. Wady zostały
// przeniesione świadomie - zgłasza je test, nie poprawia ekstrakcja.
import { formatCouponDiscount } from "@/lib/billing/couponAdminList";
import type { CouponDiscountKind } from "@/lib/billing/coupons";

interface CouponDiscountCellProps {
  kind: CouponDiscountKind;
  percent: number | null;
  cents: number | null;
  currency: string | null;
}

export function CouponDiscountCell({ kind, percent, cents, currency }: CouponDiscountCellProps) {
  return <>{formatCouponDiscount(kind, percent, cents, currency)}</>;
}
