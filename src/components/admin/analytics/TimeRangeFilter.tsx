/**
 * TimeRangeFilter - BI-style time window control used across analytics
 * dashboards. Presets (24h / 7d / 30d / 90d) plus a custom range picker
 * that emits ISO `sinceIso` / `untilIso` for backend server functions.
 *
 * Design goals:
 *  - Zero coupling to a specific dashboard; consumers pass an initial value
 *    and receive a stable callback.
 *  - Semantic tokens only; no hardcoded colors.
 *  - Fully keyboard accessible via shadcn primitives.
 */
import { useMemo, useState } from "react";
import { CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import { pl } from "date-fns/locale";
import type { DateRange } from "react-day-picker";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type TimeRangePresetId = "24h" | "7d" | "30d" | "90d" | "custom";

export interface TimeRangeValue {
  presetId: TimeRangePresetId;
  /** ISO string, inclusive lower bound. */
  sinceIso: string;
  /** ISO string, inclusive upper bound. */
  untilIso: string;
  /** Rounded days span, for labels/display. */
  days: number;
}

interface PresetSpec {
  id: Exclude<TimeRangePresetId, "custom">;
  label: string;
  hours: number;
}

const PRESETS: PresetSpec[] = [
  { id: "24h", label: "24 godz.", hours: 24 },
  { id: "7d", label: "7 dni", hours: 24 * 7 },
  { id: "30d", label: "30 dni", hours: 24 * 30 },
  { id: "90d", label: "90 dni", hours: 24 * 90 },
];


export function buildPresetRange(id: Exclude<TimeRangePresetId, "custom">): TimeRangeValue {
  const spec = PRESETS.find((p) => p.id === id) ?? PRESETS[1];
  const untilMs = Date.now();
  const sinceMs = untilMs - (spec.hours ?? 24 * 7) * 3_600_000;
  return {
    presetId: id,
    sinceIso: new Date(sinceMs).toISOString(),
    untilIso: new Date(untilMs).toISOString(),
    days: Math.max(1, Math.round((untilMs - sinceMs) / 86_400_000)),
  };
}

function buildCustomRange(from: Date, to: Date): TimeRangeValue {
  // Normalize to start-of-day / end-of-day so a full day is included.
  const sinceMs = new Date(from.getFullYear(), from.getMonth(), from.getDate(), 0, 0, 0, 0).getTime();
  const untilMs = new Date(to.getFullYear(), to.getMonth(), to.getDate(), 23, 59, 59, 999).getTime();
  return {
    presetId: "custom",
    sinceIso: new Date(sinceMs).toISOString(),
    untilIso: new Date(untilMs).toISOString(),
    days: Math.max(1, Math.ceil((untilMs - sinceMs) / 86_400_000)),
  };
}

interface TimeRangeFilterProps {
  value: TimeRangeValue;
  onChange: (next: TimeRangeValue) => void;
  className?: string;
}

export function TimeRangeFilter({ value, onChange, className }: TimeRangeFilterProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange | undefined>(() =>
    value.presetId === "custom"
      ? { from: new Date(value.sinceIso), to: new Date(value.untilIso) }
      : undefined,
  );

  const label = useMemo(() => {
    if (value.presetId !== "custom") {
      return PRESETS.find((p) => p.id === value.presetId)?.label ?? value.presetId;
    }
    const from = new Date(value.sinceIso);
    const to = new Date(value.untilIso);
    return `${format(from, "d MMM", { locale: pl })} - ${format(to, "d MMM yyyy", { locale: pl })}`;
  }, [value]);

  return (
    <div className={cn("flex flex-wrap items-center gap-1", className)}>
      <div className="inline-flex rounded-md border border-border bg-background p-0.5">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onChange(buildPresetRange(p.id))}
            className={cn(
              "px-2.5 h-7 text-xs font-medium rounded-sm transition-colors",
              value.presetId === p.id
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-muted",
            )}
            aria-pressed={value.presetId === p.id}
          >
            {p.label}
          </button>
        ))}
      </div>

      <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
        <PopoverTrigger asChild>
          <Button
            variant={value.presetId === "custom" ? "default" : "outline"}
            size="sm"
            className="h-7 text-xs gap-1.5"
          >
            <CalendarIcon className="w-3.5 h-3.5" />
            {value.presetId === "custom" ? label : "Zakres"}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-auto p-0 pointer-events-auto">
          <Calendar
            mode="range"
            numberOfMonths={2}
            selected={draft}
            onSelect={setDraft}
            defaultMonth={draft?.from ?? new Date(value.sinceIso)}
            locale={pl}
            className="p-3 pointer-events-auto"
          />
          <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2">
            <span className="text-xs text-muted-foreground">
              {draft?.from && draft?.to
                ? `${format(draft.from, "d MMM yyyy", { locale: pl })} - ${format(draft.to, "d MMM yyyy", { locale: pl })}`
                : "Wybierz początek i koniec"}
            </span>
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => {
                  setDraft(undefined);
                  setPickerOpen(false);
                }}
              >
                Anuluj
              </Button>
              <Button
                size="sm"
                className="h-7 text-xs"
                disabled={!draft?.from || !draft?.to}
                onClick={() => {
                  if (draft?.from && draft?.to) {
                    onChange(buildCustomRange(draft.from, draft.to));
                    setPickerOpen(false);
                  }
                }}
              >
                Zastosuj
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
