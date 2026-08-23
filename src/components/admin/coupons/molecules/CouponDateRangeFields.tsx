// Molekuła: para pól „Od”/„Do” filtrująca zakres raportu.
//
// CO BYŁO W TRASACH. Ten sam układ dwóch `DatePickerField` stał w dwóch
// plikach: `admin.coupons.redemptions.tsx` (dawne 102-105)
// i `admin.coupons.analytics.tsx` (dawne 103-106).
//
// DLACZEGO TO NIE JEST SAM UKŁAD. Wyczyszczenie któregokolwiek pola oddaje
// `undefined`, a to jest OSOBNA decyzja zapytania: w realizacjach znika ogniwo
// `gte`/`lte` (patrz `couponRedemptionsRange`), a w analityce brak daty „od”
// cofa raport do epoki (`new Date(0)`). Molekuła musi więc umieć oddać
// `undefined`, a nie tylko datę - i to jest jej test.
import { DatePickerField } from "@/components/admin/coupons/DatePickerField";

export function CouponDateRangeFields({
  from,
  to,
  onFrom,
  onTo,
  fromLabel,
  toLabel,
}: {
  from: Date | undefined;
  to: Date | undefined;
  onFrom: (value: Date | undefined) => void;
  onTo: (value: Date | undefined) => void;
  fromLabel: string;
  toLabel: string;
}) {
  return (
    <>
      <DatePickerField value={from} onChange={onFrom} label={fromLabel} />
      <DatePickerField value={to} onChange={onTo} label={toLabel} />
    </>
  );
}
