// Admin date / date-time pickers built on shadcn Popover + Calendar so every
// admin surface (settings, block editors, ticker) shares one calendar UI
// consistent with the rest of the admin theme.
//
// - AdminDatePicker    — value: "YYYY-MM-DD"
// - AdminDateTimePicker — value: "YYYY-MM-DDTHH:mm" (local, no timezone)
//
// Both accept `null | ""` for empty and emit `null` on clear so callers can
// treat them as drop-in replacements for <input type="date"> / "datetime-local".
import * as React from "react";
import { format } from "date-fns";
import { pl as plLocale, enUS as enLocale } from "date-fns/locale";
import { Calendar as CalendarIcon, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AdminCalendar } from "@/components/admin/blocks/AdminCalendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type Lang = "pl" | "en";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function toLocalDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function toLocalDateTime(d: Date): string {
  return `${toLocalDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function parseLocalDateTime(v: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(v);
  if (!m) {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }
  return new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4] ?? "0"),
    Number(m[5] ?? "0"),
    0,
    0,
  );
}

function pickerLabels(lang: Lang) {
  return {
    empty: lang === "en" ? "Pick a date" : "Wybierz datę",
    time: lang === "en" ? "Time" : "Godzina",
    clear: lang === "en" ? "Clear" : "Wyczyść",
    fmt: lang === "en" ? "MMM d, yyyy" : "d MMM yyyy",
  } as const;
}

type BaseProps = {
  value: string | null | undefined;
  disabled?: boolean;
  lang?: Lang;
  className?: string;
  triggerClassName?: string;
  placeholder?: string;
  clearable?: boolean;
  "aria-label"?: string;
};

export function AdminDatePicker({
  value,
  onChange,
  disabled,
  lang = "pl",
  className,
  triggerClassName,
  placeholder,
  clearable = true,
  ...rest
}: BaseProps & { onChange: (v: string | null) => void }) {
  const labels = pickerLabels(lang);
  const locale = lang === "en" ? enLocale : plLocale;
  const parsed = value ? parseLocalDateTime(value) : null;
  const [open, setOpen] = React.useState(false);
  return (
    <div className={cn("flex items-center gap-1", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            aria-label={rest["aria-label"]}
            className={cn(
              "admin-date-trigger flex-1 justify-start font-normal h-9",
              !parsed && "text-muted-foreground",
              triggerClassName,
            )}
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {parsed ? format(parsed, labels.fmt, { locale }) : placeholder ?? labels.empty}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-0 admin-calendar">
          <AdminCalendar
            selected={parsed ?? undefined}
            onSelect={(d) => {
              onChange(d ? toLocalDate(d) : null);
              setOpen(false);
            }}
            locale={locale}
          />
        </PopoverContent>
      </Popover>
      {clearable && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => onChange(null)}
          disabled={disabled || !parsed}
          aria-label={labels.clear}
          className="h-9 w-9 shrink-0"
        >
          <X className="w-4 h-4" />
        </Button>
      )}
    </div>
  );
}

export function AdminDateTimePicker({
  value,
  onChange,
  disabled,
  lang = "pl",
  className,
  triggerClassName,
  placeholder,
  clearable = true,
  ...rest
}: BaseProps & { onChange: (v: string | null) => void }) {
  const labels = pickerLabels(lang);
  const locale = lang === "en" ? enLocale : plLocale;
  const parsed = value ? parseLocalDateTime(value) : null;
  const [open, setOpen] = React.useState(false);
  const timeValue = parsed ? format(parsed, "HH:mm") : "";

  const commit = (date: Date | null, time: string): void => {
    if (!date) {
      onChange(null);
      return;
    }
    const [h = "00", m = "00"] = (time || "00:00").split(":");
    const d = new Date(date);
    d.setHours(Number(h) || 0, Number(m) || 0, 0, 0);
    onChange(toLocalDateTime(d));
  };

  return (
    <div
      className={cn(
        "grid grid-cols-[minmax(0,1fr)_auto] gap-2 items-center",
        clearable && "sm:grid-cols-[minmax(0,1fr)_auto_auto]",
        className,
      )}
    >
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            aria-label={rest["aria-label"]}
            className={cn(
              "admin-date-trigger w-full justify-start font-normal h-9",
              !parsed && "text-muted-foreground",
              triggerClassName,
            )}
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {parsed ? format(parsed, labels.fmt, { locale }) : placeholder ?? labels.empty}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-0 admin-calendar">
          <AdminCalendar
            selected={parsed ?? undefined}
            onSelect={(d) => {
              commit(d ?? null, timeValue || "00:00");
              setOpen(false);
            }}
            locale={locale}
          />
        </PopoverContent>
      </Popover>
      <Input
        type="time"
        value={timeValue}
        onChange={(e) => commit(parsed, e.target.value)}
        disabled={disabled || !parsed}
        className="w-[7.5rem] h-9"
        aria-label={labels.time}
      />
      {clearable && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => onChange(null)}
          disabled={disabled || !parsed}
          aria-label={labels.clear}
          className="h-9 w-9 shrink-0"
        >
          <X className="w-4 h-4" />
        </Button>
      )}
    </div>
  );
}
