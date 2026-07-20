// DateTimePicker - popover kalendarz (shadcn Calendar) + input godziny.
// Wartość jest ISO stringiem (UTC) LUB null. Reprezentacja lokalna dla użytkownika,
// zapis do bazy w ISO. Klawisz "Wyczyść" ustawia null (bez limitu czasowego).
import { useMemo } from "react";
import { format } from "date-fns";
import { pl as plLocale, enGB } from "date-fns/locale";
import { CalendarIcon, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface DateTimePickerProps {
  value: string | null;
  onChange: (iso: string | null) => void;
  placeholder?: string;
  clearLabel?: string;
  lang?: "pl" | "en";
  disabled?: boolean;
  className?: string;
  minDate?: Date;
}

export function DateTimePicker({
  value,
  onChange,
  placeholder,
  clearLabel,
  lang = "pl",
  disabled,
  className,
  minDate,
}: DateTimePickerProps) {
  const locale = lang === "pl" ? plLocale : enGB;
  const date = useMemo(() => (value ? new Date(value) : null), [value]);
  const timeValue = date ? format(date, "HH:mm") : "";

  const setDatePart = (next: Date | undefined) => {
    if (!next) return;
    const base = date ?? new Date();
    const merged = new Date(next);
    merged.setHours(base.getHours(), base.getMinutes(), 0, 0);
    onChange(merged.toISOString());
  };

  const setTimePart = (raw: string) => {
    if (!raw) return;
    const [h, m] = raw.split(":").map((n) => Number(n));
    const base = date ?? new Date();
    const merged = new Date(base);
    merged.setHours(h || 0, m || 0, 0, 0);
    onChange(merged.toISOString());
  };

  const display = date
    ? format(date, lang === "pl" ? "d MMM yyyy, HH:mm" : "MMM d, yyyy, HH:mm", { locale })
    : (placeholder ?? (lang === "pl" ? "Wybierz datę i godzinę" : "Pick date and time"));

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          className={cn(
            "h-10 w-full justify-start gap-2 font-normal",
            !date && "text-muted-foreground",
            className,
          )}
        >
          <CalendarIcon className="h-4 w-4 shrink-0 opacity-70" aria-hidden="true" />
          <span className="truncate">{display}</span>
          {date && (
            <span
              role="button"
              tabIndex={0}
              aria-label={clearLabel ?? (lang === "pl" ? "Wyczyść" : "Clear")}
              onClick={(e) => {
                e.stopPropagation();
                onChange(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  onChange(null);
                }
              }}
              className="ml-auto flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0" sideOffset={4}>
        <Calendar
          mode="single"
          selected={date ?? undefined}
          onSelect={setDatePart}
          locale={locale}
          weekStartsOn={1}
          disabled={minDate ? { before: minDate } : undefined}
          initialFocus
          className={cn("pointer-events-auto p-3")}
        />
        <div className="flex items-center gap-2 border-t border-border/60 bg-muted/30 p-3">
          <label className="text-xs text-muted-foreground">
            {lang === "pl" ? "Godzina" : "Time"}
          </label>
          <Input
            type="time"
            step={60}
            value={timeValue}
            onChange={(e) => setTimePart(e.target.value)}
            className="h-8 w-[110px] font-mono text-sm"
          />
          <div className="ml-auto flex gap-1">
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
              {lang === "pl" ? "Teraz" : "Now"}
            </Button>
            {date && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-8 px-2 text-xs text-muted-foreground hover:text-destructive"
                onClick={() => onChange(null)}
              >
                {clearLabel ?? (lang === "pl" ? "Wyczyść" : "Clear")}
              </Button>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
