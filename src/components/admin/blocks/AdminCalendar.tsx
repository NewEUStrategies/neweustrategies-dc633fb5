// AdminCalendar - shadcn Calendar wrapper with a "zoom-out" caption:
// - click on "month year" label -> month grid
// - click again -> year grid
// - pick a year -> back to month grid
// - pick a month -> back to day grid, focused on the chosen month
//
// Used by AdminDatePicker / AdminDateTimePicker so every admin surface shares
// this navigation UX. Keeps react-day-picker for the day grid to preserve
// selection/keyboard behaviour.
import * as React from "react";
import { format } from "date-fns";
import type { Locale } from "date-fns";
import { ChevronLeft, ChevronRight } from "@/lib/lucide-shim";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";

type Props = {
  selected?: Date;
  onSelect: (d: Date | undefined) => void;
  locale: Locale;
  className?: string;
};

type View = "day" | "month" | "year";

const YEAR_PAGE_SIZE = 12;

export function AdminCalendar({ selected, onSelect, locale, className }: Props) {
  const [view, setView] = React.useState<View>("day");
  const [month, setMonth] = React.useState<Date>(selected ?? new Date());

  React.useEffect(() => {
    if (selected) setMonth(selected);
  }, [selected]);

  if (view === "day") {
    return (
      <Calendar
        mode="single"
        selected={selected}
        onSelect={onSelect}
        month={month}
        onMonthChange={setMonth}
        initialFocus
        locale={locale}
        className={cn("pointer-events-auto", className)}
        components={{
          MonthCaption: ({ calendarMonth }) => (
            <div className="flex justify-center pt-1 pb-2">
              <button
                type="button"
                onClick={() => setView("month")}
                className="admin-calendar-caption-btn text-sm font-medium capitalize px-3 py-1 rounded-md hover:bg-[#FDB078] hover:text-foreground transition"
              >
                {format(calendarMonth.date, "LLLL yyyy", { locale })}
              </button>
            </div>
          ),
        }}
      />
    );
  }

  if (view === "month") {
    const monthNames = Array.from({ length: 12 }, (_, i) =>
      format(new Date(month.getFullYear(), i, 1), "LLL", { locale }),
    );
    const currentMonth = new Date().getMonth();
    const currentYear = new Date().getFullYear();
    return (
      <div className={cn("p-3 w-[252px]", className)}>
        <div className="flex items-center justify-between mb-2">
          <button
            type="button"
            onClick={() => setMonth(new Date(month.getFullYear() - 1, month.getMonth(), 1))}
            className="h-7 w-7 rounded-md hover:bg-[#FDB078] hover:text-foreground inline-flex items-center justify-center transition"
            aria-label="Poprzedni rok"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setView("year")}
            className="text-sm font-semibold px-3 py-1 rounded-md hover:bg-[#FDB078] hover:text-foreground transition"
          >
            {month.getFullYear()}
          </button>
          <button
            type="button"
            onClick={() => setMonth(new Date(month.getFullYear() + 1, month.getMonth(), 1))}
            className="h-7 w-7 rounded-md hover:bg-[#FDB078] hover:text-foreground inline-flex items-center justify-center transition"
            aria-label="Następny rok"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {monthNames.map((name, idx) => {
            const isSelected =
              selected &&
              selected.getFullYear() === month.getFullYear() &&
              selected.getMonth() === idx;
            const isToday = currentYear === month.getFullYear() && currentMonth === idx;
            return (
              <button
                key={name}
                type="button"
                onClick={() => {
                  setMonth(new Date(month.getFullYear(), idx, 1));
                  setView("day");
                }}
                className={cn(
                  "h-9 rounded-md text-xs font-medium capitalize transition",
                  "hover:bg-[#FDB078] hover:text-foreground",
                  isSelected && "bg-primary text-primary-foreground",
                  !isSelected && isToday && "ring-1 ring-border",
                )}
              >
                {name}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // year view
  const baseYear = Math.floor(month.getFullYear() / YEAR_PAGE_SIZE) * YEAR_PAGE_SIZE;
  const years = Array.from({ length: YEAR_PAGE_SIZE }, (_, i) => baseYear + i);
  const currentYearNow = new Date().getFullYear();
  return (
    <div className={cn("p-3 w-[252px]", className)}>
      <div className="flex items-center justify-between mb-2">
        <button
          type="button"
          onClick={() => setMonth(new Date(baseYear - YEAR_PAGE_SIZE, month.getMonth(), 1))}
          className="h-7 w-7 rounded-md hover:bg-[#FDB078] hover:text-foreground inline-flex items-center justify-center transition"
          aria-label="Poprzednia dekada"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-sm font-semibold px-3 py-1">
          {baseYear} – {baseYear + YEAR_PAGE_SIZE - 1}
        </span>
        <button
          type="button"
          onClick={() => setMonth(new Date(baseYear + YEAR_PAGE_SIZE, month.getMonth(), 1))}
          className="h-7 w-7 rounded-md hover:bg-[#FDB078] hover:text-foreground inline-flex items-center justify-center transition"
          aria-label="Następna dekada"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {years.map((y) => {
          const isSelected = selected && selected.getFullYear() === y;
          const isCurrent = y === currentYearNow;
          return (
            <button
              key={y}
              type="button"
              onClick={() => {
                setMonth(new Date(y, month.getMonth(), 1));
                setView("month");
              }}
              className={cn(
                "h-9 rounded-md text-xs font-medium transition",
                "hover:bg-[#FDB078] hover:text-foreground",
                isSelected && "bg-primary text-primary-foreground",
                !isSelected && isCurrent && "ring-1 ring-border",
              )}
            >
              {y}
            </button>
          );
        })}
      </div>
    </div>
  );
}
