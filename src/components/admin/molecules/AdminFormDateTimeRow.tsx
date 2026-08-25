// Molekuła: opisany wiersz DATY I GODZINY w formularzu panelu.
//
// PO CO. `<input type="datetime-local">` rysuje SYSTEMOWY kalendarz - inny na
// macOS, inny na Windowsie, żaden z nich nie zna naszych tokenów (promień 6 px,
// tryb ciemny, font Red Hat Display). Ta molekuła stawia w tym miejscu nasz
// `DateTimePicker` (Radix Popover + shadcn Calendar), więc kalendarz w panelu
// wygląda tak samo jak każda inna droplista.
//
// WARTOŚĆ JEST ISO (UTC) ALBO PUSTYM STRINGIEM. Pusty string znaczy „nie podano"
// - dokładnie tak, jak w pozostałych wersjach roboczych panelu, gdzie walidacja
// porównuje `trim() === ""`. Zamiana na `null` w tej warstwie zmuszałaby każdy
// szkic do osobnego typu pola.
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Label } from "@/components/ui/label";
import { DateTimePicker } from "@/components/ui/datetime-picker";
import { uiLang } from "@/lib/i18n/format";
import { cn } from "@/lib/utils";

export function AdminFormDateTimeRow({
  id,
  label,
  value,
  onValueChange,
  hint,
  error,
  disabled,
  minDate,
  className,
}: {
  id?: string;
  label: string;
  /** ISO 8601 (UTC) albo `""` dla braku wartości. */
  value: string;
  onValueChange: (value: string) => void;
  hint?: string;
  error?: string | null;
  disabled?: boolean;
  minDate?: Date;
  className?: string;
}) {
  const { i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const reactId = useId();
  const fieldId = id ?? reactId;
  const hintId = hint === undefined ? undefined : `${fieldId}-hint`;
  const errorId = error === null || error === undefined ? undefined : `${fieldId}-err`;

  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={fieldId}>{label}</Label>
      <DateTimePicker
        id={fieldId}
        value={value === "" ? null : value}
        onChange={(iso) => onValueChange(iso ?? "")}
        lang={lang === "en" ? "en" : "pl"}
        disabled={disabled}
        minDate={minDate}
        className={cn(errorId !== undefined && "border-destructive")}
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
