// Molecule: pole wyboru wariantu z zamkniętej listy (segmentowany przełącznik).
//
// Powód istnienia: edytory widgetów (accordion i kolejne) potrzebują kontrolki
// "wybierz jeden z 2-4 wariantów", która jest w pełni bezstanowa, klawiaturowa
// i czytelna dla czytników ekranu. Wcześniej takie wybory wklejano inline w
// organizmach, przez co każdy edytor miał inny wygląd i inną dostępność.
import { PropField } from "../atoms/PropField";

export interface VariantOption {
  value: string;
  label: string;
}

interface Props {
  label: string;
  value: string;
  options: ReadonlyArray<VariantOption>;
  onChange: (value: string) => void;
  hint?: string;
}

export function VariantPicker({ label, value, options, onChange, hint }: Props) {
  return (
    <PropField label={label} hint={hint}>
      <div
        role="group"
        aria-label={label}
        className="inline-flex w-full rounded border border-border bg-muted/30 p-0.5"
      >
        {options.map((option) => {
          const active = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(option.value)}
              className={`min-w-0 flex-1 truncate rounded px-2 py-1 text-[11px] transition ${
                active
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </PropField>
  );
}
