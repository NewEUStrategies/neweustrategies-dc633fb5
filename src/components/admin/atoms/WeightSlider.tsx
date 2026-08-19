import { useId } from "react";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";

interface WeightSliderProps {
  label: string;
  hint: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
}

/**
 * Atom: waga sygnału w skali 0-10 (suwak + odczyt liczbowy).
 *
 * A11y: nazwa idzie na UCHWYT, nie na korzeń.
 *
 * Radix stawia `role="slider"` na uchwycie, a wszystko, co przekażemy do
 * `Slider`, ląduje na korzeniu - elemencie BEZ roli. `aria-labelledby` na
 * korzeniu było więc atrybutem, którego czytnik ekranu nigdy nie czytał:
 * użytkownik słyszał „suwak, 4", bez informacji, którego sygnału dotyczy.
 * `aria-label` przekazany przez `thumbProps` schodzi na uchwyt i nazwa wreszcie
 * dochodzi tam, gdzie stoi rola. Widoczna etykieta zostaje powiązana przez
 * `aria-labelledby` na uchwycie, żeby jej treść i nazwa dostępna nie mogły się
 * rozejść.
 */
export function WeightSlider({
  label,
  hint,
  value,
  onChange,
  min = 0,
  max = 10,
  step = 1,
}: WeightSliderProps) {
  const labelId = useId();
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <Label id={labelId} className="text-sm font-semibold">
            {label}
          </Label>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </div>
        <span className="w-8 shrink-0 text-right font-mono text-sm tabular-nums">{value}</span>
      </div>
      <Slider
        thumbProps={{ "aria-labelledby": labelId }}
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={(values) => onChange(values[0] ?? min)}
      />
    </div>
  );
}
