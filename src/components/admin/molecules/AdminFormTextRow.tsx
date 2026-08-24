// Molekuła: JEDEN opisany wiersz tekstowy w formularzu panelu.
//
// PO CO. Blok `Label + Input + podpowiedź` jest w panelu przeklejony kilkadziesiąt
// razy, a różni się czterema wartościami: `id`, etykietą, limitem znaków i liczbą
// wierszy. Blok przeklejony to blok, w którym pomyłka jest niewidoczna na ekranie:
// pole opisane etykietą angielską zapisujące treść do polskiego klucza wersji
// roboczej wygląda dokładnie tak jak poprawne. Jedno wejście = jedno miejsce na tę
// pomyłkę.
//
// DLACZEGO NIE `ClubDialogTextRow`. Tamta molekuła przyjmuje KLUCZE słownika
// i sama dociąga `i18n-clubs-admin` - jest więc związana z jednym obszarem panelu.
// Ta przyjmuje GOTOWE napisy, dokładnie jak `AdminCatalogRow`, bo klucze każdego
// modułu mieszkają w innym pliku i18n i molekuła nie ma prawa o nich wiedzieć.
//
// LICZNIK ZNAKÓW POJAWIA SIĘ TYLKO PRZY LIMICIE i tylko gdy pole jest bliskie
// granicy. Licznik świecący od pierwszej litery uczy redaktora go ignorować,
// a wtedy nie zauważy go w momencie, w którym naprawdę ma znaczenie.
import { useId } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/** Od jakiego wypełnienia limitu pokazujemy licznik znaków. */
const COUNTER_THRESHOLD = 0.8;

export function AdminFormTextRow({
  id,
  label,
  value,
  onValueChange,
  hint,
  placeholder,
  maxLength,
  rows,
  type,
  inputMode,
  monospace,
  disabled,
  autoFocus,
  error,
  className,
}: {
  /** Brak = identyfikator generowany; podany wygrywa (test celuje w stały). */
  id?: string;
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  hint?: string;
  placeholder?: string;
  maxLength?: number;
  /** Obecne = pole wielolinijkowe o tej liczbie wierszy. */
  rows?: number;
  /** Typ pola HTML jednolinijkowego (`number`, `datetime-local`, `url`). */
  type?: string;
  inputMode?: "numeric" | "decimal" | "text";
  /** Klucz techniczny i kolor heksadecymalny czyta się monospace'em. */
  monospace?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  /** Gotowy komunikat błędu - wiąże `aria-invalid` i `aria-describedby`. */
  error?: string | null;
  className?: string;
}) {
  const reactId = useId();
  const fieldId = id ?? reactId;
  const hintId = hint === undefined ? undefined : `${fieldId}-hint`;
  const errorId = error === null || error === undefined ? undefined : `${fieldId}-err`;
  const describedBy = [errorId, hintId].filter((part) => part !== undefined).join(" ") || undefined;

  const showCounter =
    maxLength !== undefined && value.length >= Math.floor(maxLength * COUNTER_THRESHOLD);

  const shared = {
    id: fieldId,
    value,
    maxLength,
    placeholder,
    disabled,
    "aria-invalid": errorId === undefined ? undefined : true,
    "aria-describedby": describedBy,
    className: cn(monospace === true && "font-mono text-xs", errorId && "border-destructive"),
    onChange: (event: { target: { value: string } }) => onValueChange(event.target.value),
  };

  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={fieldId}>{label}</Label>
        {showCounter ? (
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {value.length}/{maxLength}
          </span>
        ) : null}
      </div>
      {rows === undefined ? (
        <Input {...shared} type={type} inputMode={inputMode} autoFocus={autoFocus} />
      ) : (
        <Textarea {...shared} rows={rows} />
      )}
      {errorId === undefined ? null : (
        <p id={errorId} className="mt-1.5 pl-1 text-xs text-destructive" role="alert">
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
