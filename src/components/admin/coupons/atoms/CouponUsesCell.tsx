// Atom: komórka „Użycia" - licznik realizacji i opcjonalny limit.
//
// Różnica między `null` a `0` jest tu DECYZJĄ, nie kosmetyką: `null` to kupon
// bez limitu (nie wypisujemy nic), a `0` to limit zerowy, który wypisze
// „ / 0". Baza dopuszcza tylko `max_redemptions > 0`, więc „ / 0" na ekranie
// oznacza wiersz, który powstał z pominięciem panelu.
interface CouponUsesCellProps {
  used: number;
  max: number | null;
}

export function CouponUsesCell({ used, max }: CouponUsesCellProps) {
  return (
    <>
      {used}
      {max != null ? ` / ${max}` : ""}
    </>
  );
}
