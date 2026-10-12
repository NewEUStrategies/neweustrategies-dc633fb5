import { useId, useState } from "react";
import type { ComponentProps } from "react";
import { useTranslation } from "react-i18next";
import { format, isValid, parseISO } from "date-fns";
import { pl, enGB } from "date-fns/locale";
import { CalendarDays, X } from "@/lib/lucide-shim";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { TimeInput } from "@/components/ui/time-input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import "@/lib/i18n-datetime-picker";

type DateInputProps = Omit<
  ComponentProps<"input">,
  "type" | "onChange" | "value" | "defaultValue" | "ref"
> & {
  type: "date" | "datetime-local";
  value?: string | null;
  onChange?: (event: { target: { value: string } }) => void;
};

export function DateInput({
  type,
  value,
  onChange,
  className,
  id,
  name,
  disabled,
  required,
  min,
  max,
  placeholder,
  title,
  "aria-label": ariaLabel,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
}: DateInputProps) {
  const { t, i18n } = useTranslation();
  const timeId = useId();
  const [open, setOpen] = useState(false);
  const lang = i18n.language?.startsWith("en") ? "en" : "pl";
  const locale = lang === "en" ? enGB : pl;
  const parse = (input: string | number | null | undefined) => {
    if (typeof input !== "string" || !input) return undefined;
    const result = parseISO(input);
    return isValid(result) ? result : undefined;
  };
  const date = parse(value);
  const lower = parse(min);
  const upper = parse(max);
  const time = date ? format(date, "HH:mm") : "00:00";
  const commit = (next: Date | undefined, nextTime = time) => {
    // Preserve local date strings and the existing caller's persistence conversion.
    const result = next
      ? `${format(next, "yyyy-MM-dd")}${type === "datetime-local" ? `T${nextTime}` : ""}`
      : "";
    onChange?.({ target: { value: result } });
  };
  return (
    <div className={cn("platform-date-input relative min-w-0", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            disabled={disabled}
            title={title}
            aria-label={ariaLabel}
            aria-invalid={ariaInvalid}
            aria-describedby={ariaDescribedBy}
            aria-required={required || undefined}
            className={cn(
              "platform-field w-full min-w-0 justify-start font-normal",
              date ? "pr-9" : "text-muted-foreground",
            )}
          >
            <CalendarDays aria-hidden="true" />
            <span className="min-w-0 truncate">
              {date
                ? format(date, type === "date" ? "dd.MM.yyyy" : "dd.MM.yyyy, HH:mm", { locale })
                : (placeholder ??
                  t(
                    type === "date"
                      ? "dateTimePicker.datePlaceholder"
                      : "dateTimePicker.placeholder",
                    { lng: lang },
                  ))}
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="pointer-events-auto w-auto max-w-[calc(100vw-2rem)] p-0"
        >
          <Calendar
            mode="single"
            selected={date}
            defaultMonth={date ?? lower}
            locale={locale}
            weekStartsOn={1}
            disabled={[...(lower ? [{ before: lower }] : []), ...(upper ? [{ after: upper }] : [])]}
            onSelect={(next) => {
              commit(next);
              if (type === "date") setOpen(false);
            }}
            autoFocus
            className="pointer-events-auto"
          />
          {type === "datetime-local" && (
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t border-border p-3">
              <label htmlFor={timeId}>{t("dateTimePicker.time", { lng: lang })}</label>
              <TimeInput
                id={timeId}
                className="w-40"
                value={time}
                min={
                  value?.slice(0, 10) === String(min).slice(0, 10)
                    ? String(min).slice(11, 16)
                    : undefined
                }
                max={
                  value?.slice(0, 10) === String(max).slice(0, 10)
                    ? String(max).slice(11, 16)
                    : undefined
                }
                onChange={(event) => commit(date ?? new Date(), event.target.value)}
              />
            </div>
          )}
          <div className="flex justify-end gap-1 border-t border-border p-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                commit(undefined);
                setOpen(false);
              }}
              disabled={disabled || !date}
            >
              {t("dateTimePicker.clear", { lng: lang })}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              {t("dateTimePicker.done", { lng: lang })}
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      {date && (
        <Button
          type="button"
          size="icon"
          variant="ghost"
          disabled={disabled}
          aria-label={t("dateTimePicker.clear", { lng: lang })}
          className="absolute right-1 top-1/2 h-6 w-6 -translate-y-1/2 text-muted-foreground"
          onClick={() => commit(undefined)}
        >
          <X aria-hidden="true" />
        </Button>
      )}
      {name && <input type="hidden" name={name} value={value ?? ""} />}
    </div>
  );
}
