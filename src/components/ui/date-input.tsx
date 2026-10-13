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

// THE VALUE IS AN OPAQUE WALL CLOCK, NOT AN INSTANT. Callers hand in the
// `<input type="date|datetime-local">` contract (`YYYY-MM-DD[THH:mm]`), often
// in a zone other than the browser's (event-zone fields, OPS-15). Parsing it
// into a browser-local `Date` and reading the time back shifted any value
// that falls in the VIEWER's DST gap: `2026-03-08T02:30` (Warsaw) showed 03:30
// in New York, and re-picking the day committed 03:30. So the day and time are
// split textually, the time shown and re-committed is the original `HH:mm`,
// and the calendar only ever sees the day (built at local noon, which no DST
// transition touches). Only a string with an explicit offset (`...Z`, an
// instant) still goes through `parseISO` and reads in the browser zone.
const WALL_CLOCK = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::\d{2}(?:\.\d{1,3})?)?)?$/;

interface WallClockParts {
  /** `YYYY-MM-DD`. */
  day: string;
  /** `HH:mm`, or `null` for a bare date. */
  time: string | null;
}

function wallClockParts(input: string | number | null | undefined): WallClockParts | undefined {
  if (typeof input !== "string" || !input) return undefined;
  const match = WALL_CLOCK.exec(input.trim());
  if (match) {
    const [, year, month, day, hour, minute] = match;
    const check = new Date(0);
    check.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
    const exists =
      check.getUTCFullYear() === Number(year) &&
      check.getUTCMonth() === Number(month) - 1 &&
      check.getUTCDate() === Number(day);
    const timeOk = hour === undefined || (Number(hour) < 24 && Number(minute) < 60);
    if (!exists || !timeOk) return undefined;
    return {
      day: `${year}-${month}-${day}`,
      time: hour === undefined ? null : `${hour}:${minute}`,
    };
  }
  const instant = parseISO(input);
  return isValid(instant)
    ? { day: format(instant, "yyyy-MM-dd"), time: format(instant, "HH:mm") }
    : undefined;
}

/** Calendar day as a local-noon `Date`: the day picker compares local days only. */
function calendarDay(day: string): Date {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year ?? 1970, (month ?? 1) - 1, date ?? 1, 12);
}

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
  const parts = wallClockParts(value);
  const date = parts ? calendarDay(parts.day) : undefined;
  const lowerParts = wallClockParts(min);
  const upperParts = wallClockParts(max);
  const lower = lowerParts ? calendarDay(lowerParts.day) : undefined;
  const upper = upperParts ? calendarDay(upperParts.day) : undefined;
  const time = parts?.time ?? "00:00";
  const label = parts
    ? `${format(calendarDay(parts.day), "dd.MM.yyyy", { locale })}${type === "date" ? "" : `, ${time}`}`
    : undefined;
  const commit = (day: string | undefined, nextTime = time) => {
    // Day and time stay text: the caller's persistence conversion owns the zone.
    const result = day ? `${day}${type === "datetime-local" ? `T${nextTime}` : ""}` : "";
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
              {label ??
                placeholder ??
                t(
                  type === "date" ? "dateTimePicker.datePlaceholder" : "dateTimePicker.placeholder",
                  { lng: lang },
                )}
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
              commit(next ? format(next, "yyyy-MM-dd") : undefined);
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
                  parts && parts.day === lowerParts?.day
                    ? (lowerParts.time ?? undefined)
                    : undefined
                }
                max={
                  parts && parts.day === upperParts?.day
                    ? (upperParts.time ?? undefined)
                    : undefined
                }
                onChange={(event) =>
                  commit(parts?.day ?? format(new Date(), "yyyy-MM-dd"), event.target.value)
                }
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
