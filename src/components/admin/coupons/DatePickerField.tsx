// Współdzielony pole daty (Popover + Calendar) - zgodne z layoutem i tokenami.
// PL/EN, 6px rounding, kompaktowa wysokość dopasowana do floating inputów.
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
}

export function DatePickerField({
  value,
  onChange,
  placeholder,
  label,
  className,
  disabled,
}: DatePickerFieldProps) {
  const { i18n } = useTranslation();
  const locale = i18n.language === "pl" ? pl : enUS;
  const ph = placeholder ?? (i18n.language === "pl" ? "Wybierz datę" : "Pick a date");

  return (
    <div className={cn("space-y-1", className)}>
      {label && (
        <label className="text-xs font-medium text-muted-foreground">{label}</label>
      )}
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            className={cn(
              "w-full justify-start text-left font-normal h-10 rounded-[6px]",
              !value && "text-muted-foreground",
            )}
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {value ? format(value, "PPP", { locale }) : <span>{ph}</span>}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0 pointer-events-auto" align="start">
          <Calendar
            mode="single"
            selected={value}
            onSelect={onChange}
            initialFocus
            locale={locale}
            className={cn("p-3 pointer-events-auto")}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
