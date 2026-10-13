// Molekuła: opisany wiersz DATY I GODZINY w formularzu panelu.
//
// PO CO. `<input type="datetime-local">` rysuje SYSTEMOWY kalendarz - inny na
// macOS, inny na Windowsie, żaden z nich nie zna naszych tokenów (promień 6 px,
// tryb ciemny, font Red Hat Display). Ta molekuła stawia w tym miejscu wspólny
// atom `DateInput` (Radix Popover + shadcn Calendar + `TimeInput`) - ten sam,
// którego używają kreator wydarzenia, kody i terminy biletów - więc kalendarz
// w panelu wygląda i mierzy się tak samo jak każde inne pole daty.
//
// WARTOŚĆ JEST ZEGAREM, NIE CHWILĄ (klasa OPS-15). Molekuła przyjmuje i oddaje
// napis `YYYY-MM-DDTHH:mm` - kontrakt pola `datetime-local` - albo pusty napis
// („nie podano"). W jakiej strefie jest ten zegar, wie WYŁĄCZNIE wywołujący:
// każdy formularz, który ją dziś stawia, edytuje chwilę JEDNEGO wydarzenia
// i liczy ją w jego strefie przez `lib/events/eventLocalInput.ts`
// (`eventLocalInput` / `eventLocalInputToIso` z pamięcią chwili z bazy).
// Dotąd wartością był ISO w UTC, a kalendarz czytał go w strefie PRZEGLĄDARKI:
// organizator z Londynu widział kongres warszawski godzinę wcześniej niż ten
// sam termin w kreatorze, a każdy zapis z tego ekranu mógł go przesunąć.
// Podpowiedź pod polem (`hint`) nazywa tę strefę - wywołujący składa ją
// z `eventLocalInputHint`, bo to on zna strefę i chwilę z bazy.
import { useId } from "react";
import { DateInput } from "@/components/ui/date-input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export function AdminFormDateTimeRow({
  id,
  label,
  value,
  onValueChange,
  hint,
  error,
  disabled,
  min,
  className,
}: {
  id?: string;
  label: string;
  /** `YYYY-MM-DDTHH:mm` (zegar w strefie wywołującego) albo `""` dla braku wartości. */
  value: string;
  onValueChange: (value: string) => void;
  /** Podpowiedź pod polem - w formularzach wydarzenia: strefa zegara i noc zmiany czasu. */
  hint?: string;
  error?: string | null;
  disabled?: boolean;
  /** Dolna granica w tej samej postaci co `value` (zegar tej samej strefy). */
  min?: string;
  className?: string;
}) {
  const reactId = useId();
  const fieldId = id ?? reactId;
  const hintId = hint === undefined || hint === "" ? undefined : `${fieldId}-hint`;
  const errorId = error === null || error === undefined ? undefined : `${fieldId}-err`;
  const describedBy = [errorId, hintId].filter((part) => part !== undefined).join(" ") || undefined;

  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={fieldId}>{label}</Label>
      <DateInput
        id={fieldId}
        type="datetime-local"
        value={value}
        min={min === "" ? undefined : min}
        disabled={disabled}
        aria-invalid={errorId === undefined ? undefined : true}
        aria-describedby={describedBy}
        // Ramka błędu na PRZYCISKU pola, nie na opakowaniu atomu - ten sam
        // sygnał co `.input[aria-invalid]` w polach tekstowych.
        className={cn(errorId !== undefined && "[&_[aria-invalid=true]]:border-destructive")}
        onChange={(event) => onValueChange(event.target.value)}
      />
      {errorId === undefined ? null : (
        <p id={errorId} className="pl-1 text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
      {hintId === undefined ? null : (
        <p id={hintId} className="text-xs leading-snug text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}
