// Atom: jedna pozycja pól własnych wpisu (ikona + etykieta + wartość).
//
// POWSTAŁ Z DWÓCH KOPII JSX w `CustomMetaList` - wariantu `inline` i `stacked`.
// Kopie nie tylko powtarzały strukturę, ale RÓŻNIŁY SIĘ KONTRAKTEM DOSTĘPNOŚCI:
// wariant `stacked` używał `<dt>/<dd>` (nazwa powiązana z wartością semantycznie),
// a wariant `inline` - `<span class="sr-only">` z dwukropkiem, więc czytnik
// ekranu dostawał w jednym miejscu listę definicji, a w drugim ciąg tekstu.
// Jeden atom z jawnym `variant` domyka to na jedną decyzję.
import type { ComponentType, SVGProps } from "react";

export interface MetaValueItemProps {
  /** Ikona jako DEKORACJA - nazwę pola niesie etykieta tekstowa. */
  icon: ComponentType<SVGProps<SVGSVGElement> & { className?: string }>;
  label: string;
  value: string;
  variant: "inline" | "stacked";
}

export function MetaValueItem({ icon: Icon, label, value, variant }: MetaValueItemProps) {
  if (variant === "stacked") {
    return (
      <div className="flex items-start gap-2">
        <Icon className="w-4 h-4 mt-0.5 text-brand shrink-0" aria-hidden />
        <div className="min-w-0">
          <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</dt>
          <dd className="font-semibold text-foreground truncate">{value}</dd>
        </div>
      </div>
    );
  }
  return (
    <li className="inline-flex items-center gap-1.5">
      <Icon className="w-3.5 h-3.5 text-brand" aria-hidden />
      <span className="sr-only">{label}: </span>
      <span className="font-semibold text-foreground">{value}</span>
      <span className="text-muted-foreground">{label}</span>
    </li>
  );
}
