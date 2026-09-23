// Molekuła: pole daty/godziny wydarzenia klubu z WŁASNYM, motywowanym wyborem.
//
// Natywny picker `datetime-local` renderuje przeglądarka (jasnoniebieskie
// zaznaczenia, szare tło) i nie da się go ostylować. Zostawiamy natywny input
// do wpisywania z klawiatury (wartość lokalna "yyyy-MM-ddTHH:mm" lub
// "yyyy-MM-dd"), ukrywamy jego ikonę i otwieramy popover z kalendarzem
// shadcn oraz kolumnami godzin/minut w tokenach projektu.
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { format, parse, isValid } from "date-fns";
import { pl as plLocale, enGB } from "date-fns/locale";
import { CalendarDays } from "lucide-react";

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ensureClubI18n } from "@/lib/i18n-club";

interface ClubDateTimeInputProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  allDay: boolean;
  required?: boolean;
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);
const pad = (n: number) => String(n).padStart(2, "0");

function parseLocal(value: string): Date | null {
  if (!value) return null;
  const d = value.includes("T")
    ? parse(value, "yyyy-MM-dd'T'HH:mm", new Date())
    : parse(value, "yyyy-MM-dd", new Date());
  return isValid(d) ? d : null;
}

function toLocal(date: Date, allDay: boolean): string {
  return allDay ? format(date, "yyyy-MM-dd") : format(date, "yyyy-MM-dd'T'HH:mm");
}

function TimeColumn({
  items,
  selected,
  onPick,
  label,
}: {
  items: number[];
  selected: number | null;
  onPick: (n: number) => void;
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>("[data-selected='true']");
    el?.scrollIntoView({ block: "center" });
  }, [selected]);
  return (
    <div
      ref={ref}
      role="listbox"
      aria-label={label}
      className="flex max-h-[280px] w-14 flex-col gap-1 overflow-y-auto pr-1 [scrollbar-width:thin]"
    >
      {items.map((n) => {
        const active = selected === n;
        return (
          <button
            key={n}
            type="button"
            role="option"
            aria-selected={active}
            data-selected={active}
            onClick={() => onPick(n)}
            className={cn(
              "shrink-0 rounded-md py-1.5 text-center font-mono text-sm tabular-nums transition-colors",
              active
                ? "bg-primary text-primary-foreground"
                : "text-foreground hover:bg-accent hover:text-accent-foreground",
            )}
          >
            {pad(n)}
          </button>
        );
      })}
    </div>
  );
}

export function ClubDateTimeInput({
  id,
  value,
  onChange,
  allDay,
  required,
}: ClubDateTimeInputProps) {
  ensureClubI18n();
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const locale = i18n.language?.startsWith("en") ? enGB : plLocale;
  const date = parseLocal(value);

  const commit = (next: Date) => onChange(toLocal(next, allDay));

  const pickDay = (day: Date | undefined) => {
    if (!day) return;
    const next = new Date(day);
    const base = date ?? new Date();
    next.setHours(date ? base.getHours() : 18, date ? base.getMinutes() : 0, 0, 0);
    commit(next);
    if (allDay) setOpen(false);
  };

  const pickTime = (part: "h" | "m", n: number) => {
    const next = date ? new Date(date) : new Date();
    if (!date) next.setMinutes(0, 0, 0);
    if (part === "h") next.setHours(n);
    else next.setMinutes(n);
    commit(next);
  };

  return (
    <div className="relative">
      <Input
        id={id}
        type={allDay ? "date" : "datetime-local"}
        className="[color-scheme:light] dark:[color-scheme:dark] pr-10 [&::-webkit-calendar-picker-indicator]:hidden"
        required={required}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("club.eventForm.openPicker")}
            className="absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2 text-muted-foreground hover:text-primary"
          >
            <CalendarDays className="h-4 w-4" aria-hidden="true" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          sideOffset={6}
          className="w-auto border-border bg-popover p-0 shadow-xl"
        >
          <div className="flex">
            <Calendar
              mode="single"
              selected={date ?? undefined}
              defaultMonth={date ?? undefined}
              onSelect={pickDay}
              locale={locale}
              weekStartsOn={1}
              autoFocus
              className="pointer-events-auto p-3"
            />
            {!allDay && (
              <div className="flex gap-1 border-l border-border p-3">
                <TimeColumn
                  items={HOURS}
                  selected={date ? date.getHours() : null}
                  onPick={(n) => pickTime("h", n)}
                  label={t("club.eventForm.hours")}
                />
                <TimeColumn
                  items={MINUTES}
                  selected={date ? date.getMinutes() - (date.getMinutes() % 5) : null}
                  onPick={(n) => pickTime("m", n)}
                  label={t("club.eventForm.minutes")}
                />
              </div>
            )}
          </div>
          <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 text-xs text-muted-foreground hover:text-destructive"
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
            >
              {t("club.eventForm.clear")}
            </Button>
            <div className="flex gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 text-xs"
                onClick={() => {
                  const now = new Date();
                  now.setSeconds(0, 0);
                  commit(now);
                }}
              >
                {t("club.eventForm.now")}
              </Button>
              <Button
                type="button"
                size="sm"
                className="h-8 text-xs"
                onClick={() => setOpen(false)}
              >
                {t("club.eventForm.done")}
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
