// Organizm: mini-kalendarz doku. Siatka miesiąca (logika w calendarGrid),
// wydarzenia i zadania z terminem, lista wybranego dnia.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { DockPanelShell } from "../DockPanelShell";
import { DockEmptyState } from "../atoms/DockEmptyState";
import { dayKey, monthGrid, shiftMonth } from "@/lib/dock/calendarGrid";
import { useDockCalendar } from "@/lib/dock/useDockCalendar";
import { cn } from "@/lib/utils";

export function CalendarPanel({ onClose, lang }: { onClose: () => void; lang: "pl" | "en" }) {
  const { t } = useTranslation();
  const today = useMemo(() => new Date(), []);
  const [cursor, setCursor] = useState<[number, number]>([today.getFullYear(), today.getMonth()]);
  const [selected, setSelected] = useState<string>(dayKey(today));
  const { entries, isError } = useDockCalendar(cursor[0], cursor[1], lang);

  const grid = useMemo(() => monthGrid(cursor[0], cursor[1], entries), [cursor, entries]);
  const selectedDay = grid.find((day) => day.key === selected);
  const weekdays = t("dock.calendar.weekdays", { returnObjects: true }) as string[];
  const monthLabel = new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "pl-PL", {
    month: "long",
    year: "numeric",
  }).format(new Date(cursor[0], cursor[1], 1));

  return (
    <DockPanelShell
      title={t("dock.calendar.title")}
      icon={<CalendarDays className="h-4 w-4" />}
      onClose={onClose}
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <button
          type="button"
          onClick={() => setCursor(shiftMonth(cursor[0], cursor[1], -1))}
          aria-label={t("dock.calendar.prev")}
          className="rounded-[6px] p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </button>
        <span className="flex-1 text-center text-sm font-semibold capitalize text-foreground">
          {monthLabel}
        </span>
        <button
          type="button"
          onClick={() => setCursor(shiftMonth(cursor[0], cursor[1], 1))}
          aria-label={t("dock.calendar.next")}
          className="rounded-[6px] p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ChevronRight className="h-4 w-4" aria-hidden />
        </button>
      </div>

      <div className="p-3">
        <div className="grid grid-cols-7 gap-1 pb-1 text-center text-[10px] font-semibold uppercase text-muted-foreground">
          {weekdays.map((day) => (
            <span key={day}>{day}</span>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {grid.map((day) => {
            const isToday = day.key === dayKey(today);
            return (
              <button
                key={day.key}
                type="button"
                onClick={() => setSelected(day.key)}
                aria-pressed={selected === day.key}
                aria-label={day.key}
                className={cn(
                  "relative flex h-8 items-center justify-center rounded-[6px] text-xs transition-colors",
                  day.inMonth ? "text-foreground" : "text-muted-foreground/50",
                  selected === day.key ? "bg-primary text-primary-foreground" : "hover:bg-muted",
                  isToday && selected !== day.key && "ring-1 ring-primary",
                )}
              >
                {day.date.getDate()}
                {day.entries.length > 0 ? (
                  <span
                    className={cn(
                      "absolute bottom-1 h-1 w-1 rounded-full",
                      selected === day.key ? "bg-primary-foreground" : "bg-primary",
                    )}
                    aria-hidden
                  />
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      {isError ? (
        <DockEmptyState>{t("dock.error")}</DockEmptyState>
      ) : !selectedDay || selectedDay.entries.length === 0 ? (
        <DockEmptyState>{t("dock.calendar.dayEmpty")}</DockEmptyState>
      ) : (
        <ul className="divide-y divide-border border-t border-border">
          {selectedDay.entries.map((entry) => (
            <li key={entry.id} className="px-3 py-2">
              {entry.href ? (
                <a href={entry.href} className="text-sm text-foreground hover:underline">
                  {entry.title}
                </a>
              ) : (
                <span className="text-sm text-foreground">{entry.title}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </DockPanelShell>
  );
}
