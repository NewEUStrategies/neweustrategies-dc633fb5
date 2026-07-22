// Współdzielony pole daty (Popover + Calendar) - zgodne z layoutem i tokenami.
// PL/EN, 6px rounding, kompaktowa wysokość dopasowana do floating inputów.
// Wspiera opcjonalny wybór czasu (withTime) - używane w CRM (follow-upy, filtry).
import { useMemo } from "react";
import { CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import { pl, enUS } from "date-fns/locale";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface DatePickerFieldProps {
  value: Date | undefined;
  onChange: (date: Date | undefined) => void;
  placeholder?: string;
  label?: string;
  className?: string;
  disabled?: boolean;
  /** Pokaż pole godziny obok kalendarza (HH:MM). */
  withTime?: boolean;
  /** Kompaktowa wysokość (h-8) dla gęstych paneli CRM. Domyślnie h-10. */
  size?: "sm" | "md";
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function DatePickerField({
  value,
  onChange,
  placeholder,
  label,
  className,
  disabled,
  withTime = false,
  size = "md",
}: DatePickerFieldProps) {
  const { i18n } = useTranslation();
  const locale = i18n.language === "pl" ? pl : enUS;
  const ph = placeholder ?? (i18n.language === "pl" ? "Wybierz datę" : "Pick a date");

  const timeValue = useMemo(
    () => (value ? `${pad(value.getHours())}:${pad(value.getMinutes())}` : "09:00"),
    [value],
  );

  const heightCls = size === "sm" ? "h-8 text-[13px]" : "h-10";

  const handleDateSelect = (d: Date | undefined) => {
    if (!d) {
      onChange(undefined);
      return;
    }
    if (withTime) {
      const base = value ?? new Date();
      d.setHours(base.getHours(), base.getMinutes(), 0, 0);
    }
    onChange(d);
  };

  const handleTimeChange = (v: string) => {
    const [h, m] = v.split(":").map((n) => Number.parseInt(n, 10));
    if (Number.isNaN(h) || Number.isNaN(m)) return;
    const base = value ? new Date(value) : new Date();
    base.setHours(h, m, 0, 0);
    onChange(base);
  };

  return (
    <div className={cn("space-y-1", className)}>
      {label && <label className="text-xs font-medium text-muted-foreground">{label}</label>}
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            className={cn(
              "w-full justify-start text-left font-normal rounded-[6px]",
              heightCls,
              !value && "text-muted-foreground",
            )}
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {value ? (
              format(value, withTime ? "PPP p" : "PPP", { locale })
            ) : (
              <span>{ph}</span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0 pointer-events-auto" align="start">
          <Calendar
            mode="single"
            selected={value}
            onSelect={handleDateSelect}
            initialFocus
            locale={locale}
            className={cn("p-3 pointer-events-auto")}
          />
          {withTime && (
            <div className="flex items-center gap-2 border-t p-2">
              <label className="text-[11px] text-muted-foreground">
                {i18n.language === "pl" ? "Godzina" : "Time"}
              </label>
              <input
                type="time"
                value={timeValue}
                onChange={(e) => handleTimeChange(e.target.value)}
                className="h-8 flex-1 rounded-[6px] border bg-background px-2 text-[13px]"
              />
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
