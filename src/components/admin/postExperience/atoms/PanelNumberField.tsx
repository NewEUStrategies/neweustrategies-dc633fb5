import { useId } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { clampNumber, type NumberBounds } from "@/lib/admin/panelDraft";

interface PanelNumberFieldProps {
  label: string;
  value: number;
  bounds: NumberBounds;
  onChange: (value: number) => void;
  /** Podpowiedź pod polem. Wiązana z kontrolką przez `aria-describedby`. */
  hint?: string;
  step?: number;
  disabled?: boolean;
  className?: string;
}

/**
 * Atom: pole liczbowe panelu z etykietą i granicami.
 *
 * CO SCALIŁ I CO NAPRAWIŁ. Panele modułu miały dziesięć kopii tego pola, w
 * trzech różnych zachowaniach: jedna przycinała wartość do granic, druga robiła
 * `parseInt(e.target.value || "0")` czyli NIE przycinała nic (dało się zapisać
 * pozycję 999 w polu z `max=20` i dopiero baza to odrzucała), trzecia liczyła
 * `Math.min/Math.max` na miejscu. Atom zawsze przycina jedną regułą
 * (`clampNumber`), więc UI i warstwa zapisu nie mają dwóch zdań o zakresie.
 *
 * A11y: `<Label>` jest powiązana z polem przez `htmlFor`, a podpowiedź przez
 * `aria-describedby` - w kopiach etykieta stała obok pola bez żadnego
 * powiązania, więc czytnik ekranu czytał samą liczbę.
 */
export function PanelNumberField({
  label,
  value,
  bounds,
  onChange,
  hint,
  step,
  disabled = false,
  className,
}: PanelNumberFieldProps) {
  const inputId = useId();
  const hintId = `${inputId}-hint`;
  return (
    <div className={className}>
      <Label htmlFor={inputId} className="text-xs">
        {label}
      </Label>
      <Input
        id={inputId}
        type="number"
        min={bounds.min}
        max={bounds.max}
        step={step}
        value={value}
        disabled={disabled}
        aria-describedby={hint ? hintId : undefined}
        onChange={(e) => onChange(clampNumber(e.target.value, bounds))}
        className="h-9"
      />
      {hint ? (
        <p id={hintId} className="text-[10px] text-muted-foreground mt-1">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
