// DateTimePicker - popover kalendarz (shadcn Calendar) + selektory godziny i minuty.
// Wartość jest ISO stringiem (UTC) LUB null. Reprezentacja lokalna dla użytkownika,
// zapis do bazy w ISO. Klawisz "Wyczyść" ustawia null (bez limitu czasowego).
//
// Wartość, której `Date` nie umie odczytać, jest traktowana jak brak wartości:
// `format` z date-fns rzuca `RangeError` na `Invalid Date`, więc jeden zły
// string z bazy wywracał cały formularz zamiast pokazać puste pole.
import { useId, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { format } from "date-fns";
import { pl as plLocale, enGB } from "date-fns/locale";
import { CalendarDays, X } from "@/lib/lucide-shim";
import { cn } from "@/lib/utils";
import "@/lib/i18n-datetime-picker";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const HOURS = Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, "0"));
const FIVE_MINUTE_STEPS = Array.from({ length: 12 }, (_, step) =>
  String(step * 5).padStart(2, "0"),
);

/** ISO -> `Date`; pusty albo nieczytelny string daje `null`, nigdy `Invalid Date`. */
function parseIso(value: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

interface DateTimePickerProps {
  /** Identyfikator przycisku-triggera - wiąże `<Label htmlFor>` z kontrolką. */
  id?: string;
  value: string | null;
  onChange: (iso: string | null) => void;
  placeholder?: string;
  clearLabel?: string;
  lang?: "pl" | "en";
  disabled?: boolean;
  className?: string;
  minDate?: Date;
  /** Błąd walidacji rodzica - trafia na przycisk-trigger razem z `aria-describedby`. */
  "aria-invalid"?: boolean;
  /** Identyfikator komunikatu (np. błędu) czytanego razem z nazwą pola. */
  "aria-describedby"?: string;
}

export function DateTimePicker({
  id,
  value,
  onChange,
  placeholder,
  clearLabel,
  lang = "pl",
  disabled,
  className,
  minDate,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
}: DateTimePickerProps) {
  const { t } = useTranslation();
  const timeLabelId = useId();
  const locale = lang === "pl" ? plLocale : enGB;
  const date = useMemo(() => parseIso(value), [value]);
  const selectedHour = date ? String(date.getHours()).padStart(2, "0") : "00";
  const selectedMinute = date ? String(date.getMinutes()).padStart(2, "0") : "00";
  const minutes = FIVE_MINUTE_STEPS.includes(selectedMinute)
    ? FIVE_MINUTE_STEPS
    : [...FIVE_MINUTE_STEPS, selectedMinute].sort((a, b) => Number(a) - Number(b));

  const setDatePart = (next: Date | undefined) => {
    if (!next) return;
    const base = date ?? new Date();
    const merged = new Date(next);
    merged.setHours(base.getHours(), base.getMinutes(), 0, 0);
    onChange(merged.toISOString());
  };

  const setTimePart = (hour: string, minute: string) => {
    const merged = new Date(date ?? new Date());
    merged.setHours(Number(hour), Number(minute), 0, 0);
    onChange(merged.toISOString());
  };

  const setHour = (hour: string) => setTimePart(hour, selectedMinute);
  const setMinute = (minute: string) => setTimePart(selectedHour, minute);

  const resolvedClearLabel = clearLabel ?? t("dateTimePicker.clear", { lng: lang });
  const display = date
    ? format(date, lang === "pl" ? "d MMM yyyy, HH:mm" : "MMM d, yyyy, HH:mm", { locale })
    : (placeholder ?? t("dateTimePicker.placeholder", { lng: lang }));

  return (
    <Popover>
      {/* Czyszczenie jest RODZEŃSTWEM triggera, nie dzieckiem: element
          interaktywny wewnątrz <button> to niepoprawny HTML, czytnik ekranu
          doklejał jego nazwę do nazwy pola, a Spacja na nim otwierała popover. */}
      <div className="relative w-full">
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            disabled={disabled}
            aria-invalid={ariaInvalid}
            aria-describedby={ariaDescribedBy}
            className={cn(
              "h-10 w-full justify-start gap-2 font-normal",
              date ? "pr-9" : "text-muted-foreground",
              className,
            )}
          >
            <CalendarDays className="h-4 w-4 shrink-0 opacity-70" aria-hidden="true" />
            <span className="truncate">{display}</span>
          </Button>
        </PopoverTrigger>
        {date && (
          <button
            type="button"
            aria-label={resolvedClearLabel}
            disabled={disabled}
            onClick={() => onChange(null)}
            className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )}
      </div>
      <PopoverContent
        align="start"
        className="w-[18.5rem] overflow-hidden rounded-xl border-border bg-popover p-0 shadow-lg"
        sideOffset={6}
      >
        <Calendar
          mode="single"
          selected={date ?? undefined}
          onSelect={setDatePart}
          locale={locale}
          weekStartsOn={1}
          disabled={minDate ? { before: minDate } : undefined}
          autoFocus
          className={cn("pointer-events-auto w-full bg-transparent p-3 [--cell-size:2.25rem]")}
          classNames={{
            root: "w-full",
            today:
              "rounded-md ring-1 ring-inset ring-primary/60 text-foreground data-[selected=true]:ring-0",
          }}
        />
        <div className="flex flex-col gap-2 border-t border-border/60 bg-muted/30 p-3">
          <div className="grid grid-cols-[1fr_auto] items-center gap-3">
            <span id={timeLabelId} className="text-xs font-medium text-muted-foreground">
              {t("dateTimePicker.time", { lng: lang })}
            </span>
            {/* `role="group"`: sam `aria-label` na `div` bez roli jest dla
                czytnika ekranu niewidoczny (ARIA zabrania nazwy roli generic). */}
            <div role="group" aria-labelledby={timeLabelId} className="flex items-center gap-1">
              <Select value={selectedHour} onValueChange={setHour}>
                <SelectTrigger
                  className="h-8 w-[4.25rem] rounded-md px-2 font-mono text-sm shadow-none"
                  aria-label={t("dateTimePicker.hour", { lng: lang })}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-56 min-w-[4.25rem]">
                  {HOURS.map((hour) => (
                    <SelectItem key={hour} value={hour} className="font-mono">
                      {hour}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span
                className="select-none text-sm font-semibold text-muted-foreground"
                aria-hidden="true"
              >
                :
              </span>
              <Select value={selectedMinute} onValueChange={setMinute}>
                <SelectTrigger
                  className="h-8 w-[4.25rem] rounded-md px-2 font-mono text-sm shadow-none"
                  aria-label={t("dateTimePicker.minute", { lng: lang })}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-56 min-w-[4.25rem]">
                  {minutes.map((minute) => (
                    <SelectItem key={minute} value={minute} className="font-mono">
                      {minute}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex justify-end gap-1">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8 px-2 text-xs"
              onClick={() => {
                const now = new Date();
                now.setSeconds(0, 0);
                onChange(now.toISOString());
              }}
            >
              {t("dateTimePicker.now", { lng: lang })}
            </Button>
            {date && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-8 px-2 text-xs text-muted-foreground hover:text-destructive"
                onClick={() => onChange(null)}
              >
                {resolvedClearLabel}
              </Button>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
