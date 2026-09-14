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
  /**
   * Sygnał nie ma za sobą danych - suwak jest wyłączony i opisany powodem.
   *
   * Panel NIE MOŻE pokazywać pokrętła, za którym nic nie stoi: dokładnie ta
   * klasa defektu unieruchomiła cały silnik v2 (siedem wag zapisywanych do
   * bazy, których render nie czytał). Ta sama zasada stoi już przy polu „po
   * którym akapicie" (`afterParagraphEnabled` w `relatedPosts/panelRules`).
   */
  disabledReason?: string | null;
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
  disabledReason = null,
}: WeightSliderProps) {
  const labelId = useId();
  const hintId = useId();
  const inert = !!disabledReason;
  return (
    <div className={`space-y-2 ${inert ? "opacity-60" : ""}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <Label id={labelId} className="text-sm font-semibold">
            {label}
          </Label>
          <p className="text-xs text-muted-foreground">{hint}</p>
          {inert && (
            <p id={hintId} className="mt-0.5 text-xs font-medium text-amber-600">
              {disabledReason}
            </p>
          )}
        </div>
        <span className="w-8 shrink-0 text-right font-mono text-sm tabular-nums">{value}</span>
      </div>
      <Slider
        thumbProps={{
          "aria-labelledby": labelId,
          // Powód wyłączenia idzie na UCHWYT, tam gdzie stoi rola `slider` -
          // tą samą drogą co nazwa. Na korzeniu czytnik ekranu by go nie przeczytał.
          ...(inert ? { "aria-describedby": hintId } : {}),
        }}
        min={min}
        max={max}
        step={step}
        value={[value]}
        disabled={inert}
        onValueChange={(values) => onChange(values[0] ?? min)}
      />
    </div>
  );
}
