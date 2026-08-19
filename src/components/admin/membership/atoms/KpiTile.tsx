// Atom: kafelek licznikowy nagłówka panelu członkostwa.
//
// Kontrakt dostępności: ikona jest dekoracją, więc liczba musi dać się odczytać
// z samej pary etykieta-wartość - dlatego `<dl>` z `<dt>`/`<dd>`, a nie dwa
// luźne `<div>`-y. Czytnik ogłasza „Warstwy: 4 / 6".
//
// Świadomie NIE scalony z `admin/pricing/atoms/PricingKpi` - tamten kafelek ma
// tonację zależną od danych i większą wagę wizualną. Scalenie zmieniłoby wygląd
// jednego z paneli, a to decyzja projektowa, nie porządkowa.
import type { ComponentType } from "react";

type IconType = ComponentType<{ className?: string; "aria-hidden"?: boolean }>;

export function KpiTile({
  icon: Icon,
  label,
  value,
}: {
  icon: IconType;
  label: string;
  value: string;
}) {
  return (
    <dl className="flex items-center gap-3 rounded-md border border-border/60 bg-card px-3 py-2.5">
      <div className="flex h-8 w-8 items-center justify-center rounded-[6px] bg-muted/60 text-muted-foreground">
        <Icon className="h-4 w-4" aria-hidden />
      </div>
      <div className="min-w-0">
        <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</dt>
        <dd className="truncate text-sm font-semibold">{value}</dd>
      </div>
    </dl>
  );
}
