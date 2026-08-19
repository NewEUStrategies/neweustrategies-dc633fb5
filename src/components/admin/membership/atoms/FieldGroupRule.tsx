// Atom: grupa pól z podpisem i kreską (formularz warstwy członkostwa).
//
// Kontrakt dostępności: `<fieldset>` z `<legend>`. Karta warstwy ma cztery takie
// grupy po kilka pól; bez legendy czytnik czyta kilkanaście pól jako jedną
// płaską listę i nie da się usłyszeć, że „surowy JSON" należy do „możliwości",
// a nie do „nazw". Kreska jest dekoracją (`aria-hidden`).
//
// Świadomie NIE scalony z `admin/pricing/atoms/FieldGroup`: tamten ma ramkę,
// ikonę i tonację zależną od rangi warstwy, ten - podpis i kreskę. Scalenie
// zmieniłoby wygląd jednego z paneli.
import type { ReactNode } from "react";

export function FieldGroupRule({ label, children }: { label: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-3">
      <legend className="flex w-full items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        <div className="h-px flex-1 bg-border/60" aria-hidden />
      </legend>
      {children}
    </fieldset>
  );
}
