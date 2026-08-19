// Atom: jeden wymiar filtra eksploratora materiałów eksperta.
//
// Wyciągnięty z `ExpertMaterialsExplorer`, bo niesie własną regułę widoczności
// i własne mapowanie „wszystkie -> brak klucza w URL". Jako element wewnątrz
// organizmu ta reguła była nietestowalna osobno, a to ona decyduje o tym, czy
// pasek filtrów pokazuje wymiar, który niczego nie zawęzi.
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** Wartość „wszystkie". Radix nie przyjmuje pustego stringa jako wartości. */
export const FACET_ALL = "__all__";

export function FacetSelect({
  value,
  onChange,
  options,
  allLabel,
  ariaLabel,
  alwaysShow = false,
}: {
  value: string | null;
  onChange: (next: string | null) => void;
  options: { value: string; label: string; count?: number }[];
  allLabel: string;
  ariaLabel: string;
  /** Wymiar szkieletowy - zostaje w pasku nawet pusty (temat, region). */
  alwaysShow?: boolean;
}) {
  if (options.length === 0 && !alwaysShow) return null;
  return (
    <Select
      value={value ?? FACET_ALL}
      onValueChange={(next) => onChange(next === FACET_ALL ? null : next)}
    >
      <SelectTrigger
        aria-label={ariaLabel}
        className="h-9 w-auto min-w-[150px] max-w-[240px] rounded-[6px] bg-muted/30 text-xs"
      >
        <SelectValue placeholder={allLabel} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={FACET_ALL}>{allLabel}</SelectItem>
        {options.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            {opt.label}
            {typeof opt.count === "number" ? ` (${opt.count})` : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
