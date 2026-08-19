import { useId } from "react";
import { Label } from "@/components/ui/label";
import { clampNumber, type NumberBounds } from "@/lib/admin/panelDraft";

interface PanelRangeFieldProps {
  label: string;
  value: number;
  bounds: NumberBounds;
  onChange: (value: number) => void;
  step?: number;
  /** Odczyt wartości obok etykiety (np. „1,25x", „12px"). */
  readout?: string;
  /** Podpisy skrajnych wartości pod suwakiem - dla przesunięć ujemnych. */
  scaleLabels?: readonly [string, string];
  /** Skrót „wyzeruj" pod suwakiem, między podpisami skrajnymi. */
  resetLabel?: string;
  onReset?: () => void;
  className?: string;
}

/**
 * Atom: suwak ustawienia panelu z odczytem wartości.
 *
 * CO SCALIŁ I CO NAPRAWIŁ. Panele modułu miały piętnaście suwaków w czterech
 * kopiach kodu, a każda inaczej podawała nazwę dostępną: raz `aria-label`
 * zbudowany z nagłówka grupy i wiersza, raz sam `aria-label` po polsku, raz
 * wartość wpisana w tekst etykiety (`Rozmiar napisu (1.25x)`), czyli nazwa
 * kontrolki zmieniała się przy każdym ruchu suwaka - czytnik ekranu ogłaszał
 * wtedy nową nazwę pola zamiast nowej wartości. Atom rozdziela te dwie rzeczy:
 * etykieta jest STAŁA i powiązana z suwakiem przez `htmlFor`, a wartość idzie
 * osobnym odczytem.
 */
export function PanelRangeField({
  label,
  value,
  bounds,
  onChange,
  step = 1,
  readout,
  scaleLabels,
  resetLabel,
  onReset,
  className,
}: PanelRangeFieldProps) {
  const inputId = useId();
  return (
    <div className={className ?? "space-y-1"}>
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={inputId} className="text-xs text-muted-foreground">
          {label}
        </Label>
        {readout ? (
          <span className="text-xs tabular-nums font-medium text-foreground/90">{readout}</span>
        ) : null}
      </div>
      <input
        id={inputId}
        type="range"
        min={bounds.min}
        max={bounds.max}
        step={step}
        value={value}
        onChange={(e) => onChange(clampNumber(e.target.value, bounds, step))}
        className="w-full accent-primary"
      />
      {scaleLabels ? (
        <div className="flex justify-between text-[10px] text-muted-foreground">
          <span>{scaleLabels[0]}</span>
          {resetLabel && onReset ? (
            <button type="button" className="underline hover:text-foreground" onClick={onReset}>
              {resetLabel}
            </button>
          ) : null}
          <span>{scaleLabels[1]}</span>
        </div>
      ) : null}
    </div>
  );
}
