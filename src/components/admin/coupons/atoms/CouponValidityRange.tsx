// Atom: zakres ważności kuponu („od → do").
//
// Brak daty początkowej to „—", brak końcowej to „∞" (kupon bezterminowy).
// Data nieparsowalna NIE wywala wiersza - `toLocaleDateString` oddaje napis
// „Invalid Date", i to jest jedyna informacja, jaką operator dostaje
// o uszkodzonym wierszu. Zachowanie przeniesione bez zmian.
import { formatCouponDate } from "@/lib/billing/couponAdminList";

interface CouponValidityRangeProps {
  from: string | null;
  until: string | null;
  lang: string;
}

export function CouponValidityRange({ from, until, lang }: CouponValidityRangeProps) {
  return (
    <>
      {from ? formatCouponDate(from, lang) : "—"}
      {" → "}
      {until ? formatCouponDate(until, lang) : "∞"}
    </>
  );
}
