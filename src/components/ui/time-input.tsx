// TimeInput - wspólny atom godziny: natywny <input type="time"> jako pole
// (kontrakt formularza) + wybór godziny i minut w layoucie platformy.
//
// Wartość to lokalny łańcuch "HH:mm" ("HH:mm:ss" przy step < 60), a pusty
// łańcuch oznacza brak godziny - atom nigdy nie wymyśla północy. `min`,
// `max`, `step` i `required` korzystają z natywnej walidacji, wyłączone pole
// nie trafia do FormData, `onChange` dostaje prawdziwe ChangeEvent (także
// przy wyborze z listy: natywny setter + bąbelkujące `input`), a etykieta
// wskazuje dokładnie to jedno pole. Systemowy zegar przeglądarki jest
// ukryty; listę otwiera ikona (dekoracyjna, poza drzewem dostępności) albo
// Alt+ArrowDown / F4 w polu. Geometria pochodzi ze wspólnej osi
// `.platform-field` i jest identyczna w obu motywach.

import * as React from "react";
import { useTranslation } from "react-i18next";
import { Clock } from "@/lib/lucide-shim";
import {
  FieldPopover as Popover,
  FieldPopoverAnchor as PopoverAnchor,
  FieldPopoverContent as PopoverContent,
} from "@/components/ui/platform-popover";
import { cn } from "@/lib/utils";
import "@/lib/i18n-datetime-picker";

type TimeInputProps = Omit<React.ComponentPropsWithoutRef<"input">, "type"> & {
  type?: "time";
};

const pad = (n: number) => String(n).padStart(2, "0");

/** Krok minut listy: z `step` (sekundy) dla pełnych minut, inaczej co 5 minut. */
export function minuteStepFor(step: unknown): number {
  const seconds = Number(step);
  if (Number.isFinite(seconds) && seconds >= 60 && seconds % 60 === 0) {
    const minutes = seconds / 60;
    if (minutes <= 60) return minutes;
  }
  return 5;
}

/** Czy "HH:mm" mieści się w natywnych granicach `min`/`max` (porównanie leksykalne). */
export function withinTimeBounds(value: string, min: unknown, max: unknown): boolean {
  const lower = typeof min === "string" && min ? min.slice(0, 5) : "";
  const upper = typeof max === "string" && max ? max.slice(0, 5) : "";
  if (lower && value < lower) return false;
  if (upper && value > upper) return false;
  return true;
}

function writeNativeValue(input: HTMLInputElement, next: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, next);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

export const TimeInput = React.forwardRef<HTMLInputElement, TimeInputProps>(function TimeInput(
  { className, type: _type, onKeyDown, onChange, step, min, max, disabled, readOnly, ...props },
  forwardedRef,
) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith("en") ? "en" : "pl";
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const anchorRef = React.useRef<HTMLDivElement | null>(null);
  const hourListRef = React.useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = React.useState(false);
  const [current, setCurrent] = React.useState("");

  const setInputRef = React.useCallback(
    (node: HTMLInputElement | null) => {
      inputRef.current = node;
      if (typeof forwardedRef === "function") forwardedRef(node);
      else if (forwardedRef) forwardedRef.current = node;
    },
    [forwardedRef],
  );

  const interactive = !disabled && !readOnly;
  const minuteStep = minuteStepFor(step);
  const minutes = React.useMemo(
    () => Array.from({ length: Math.ceil(60 / minuteStep) }, (_, i) => i * minuteStep),
    [minuteStep],
  );
  const hours = React.useMemo(() => Array.from({ length: 24 }, (_, i) => i), []);
  const hh = /^\d{2}:\d{2}/.test(current) ? Number(current.slice(0, 2)) : null;
  const mm = /^\d{2}:\d{2}/.test(current) ? Number(current.slice(3, 5)) : null;
  const seconds = current.length > 5 ? current.slice(5) : "";

  const openList = () => {
    if (!interactive) return;
    setCurrent(inputRef.current?.value ?? "");
    setOpen(true);
  };

  const emit = (hour: number, minute: number) => {
    const next = `${pad(hour)}:${pad(minute)}${seconds}`;
    setCurrent(next);
    if (inputRef.current) writeNativeValue(inputRef.current, next);
  };

  React.useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      const content = hourListRef.current?.closest("[data-slot='platform-time-content']");
      content
        ?.querySelectorAll<HTMLElement>("[aria-selected='true']")
        .forEach((node) => node.scrollIntoView?.({ block: "center" }));
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);

  const label = t("dateTimePicker.openTime", { lng: lang });
  const cell =
    "flex h-8 w-12 shrink-0 cursor-pointer items-center justify-center rounded-sm text-sm tabular-nums text-popover-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40";
  const selectedCell = "bg-brand text-brand-foreground hover:bg-brand hover:text-brand-foreground";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div
          ref={anchorRef}
          className={cn("platform-date-input platform-time-input relative min-w-0", className)}
        >
          <input
            ref={setInputRef}
            type="time"
            data-slot="platform-time"
            step={step}
            min={min}
            max={max}
            disabled={disabled}
            readOnly={readOnly}
            onChange={(event) => {
              setCurrent(event.target.value);
              onChange?.(event);
            }}
            onKeyDown={(event) => {
              onKeyDown?.(event);
              if (event.defaultPrevented || !interactive) return;
              if ((event.altKey && event.key === "ArrowDown") || event.key === "F4") {
                event.preventDefault();
                openList();
              }
            }}
            className="platform-field platform-field--affix-end w-full min-w-0 border border-input bg-background text-foreground tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive"
            {...props}
          />
          <span
            aria-hidden="true"
            data-time-opener=""
            title={label}
            onPointerDown={(event) => event.preventDefault()}
            onClick={(event) => {
              event.preventDefault();
              if (open) setOpen(false);
              else openList();
            }}
            className={cn(
              "absolute right-2 top-1/2 inline-flex size-5 -translate-y-1/2 items-center justify-center text-muted-foreground",
              interactive
                ? "cursor-pointer hover:text-foreground"
                : "pointer-events-none opacity-50",
            )}
          >
            <Clock className="size-4" />
          </span>
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        aria-label={label}
        data-slot="platform-time-content"
        className="w-auto rounded-[6px] p-1 shadow-lg"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          hourListRef.current
            ?.querySelector<HTMLElement>("[aria-selected='true'], button:not([disabled])")
            ?.focus();
        }}
        onInteractOutside={(event) => {
          if (anchorRef.current?.contains(event.target as Node)) event.preventDefault();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          inputRef.current?.focus();
        }}
      >
        <div className="flex gap-1">
          <div
            ref={hourListRef}
            role="listbox"
            aria-label={t("dateTimePicker.hour", { lng: lang })}
            className="flex max-h-56 flex-col gap-0.5 overflow-y-auto overscroll-contain pr-0.5"
          >
            {hours.map((hour) => {
              const allowed = minutes.some((minute) =>
                withinTimeBounds(`${pad(hour)}:${pad(minute)}`, min, max),
              );
              return (
                <button
                  key={hour}
                  type="button"
                  role="option"
                  aria-selected={hh === hour}
                  disabled={!allowed}
                  onClick={() => {
                    const keep = mm ?? 0;
                    const minute = withinTimeBounds(`${pad(hour)}:${pad(keep)}`, min, max)
                      ? keep
                      : (minutes.find((m) =>
                          withinTimeBounds(`${pad(hour)}:${pad(m)}`, min, max),
                        ) ?? 0);
                    emit(hour, minute);
                  }}
                  className={cn(cell, hh === hour && selectedCell)}
                >
                  {pad(hour)}
                </button>
              );
            })}
          </div>
          <div className="w-px self-stretch bg-border" aria-hidden="true" />
          <div
            role="listbox"
            aria-label={t("dateTimePicker.minute", { lng: lang })}
            className="flex max-h-56 flex-col gap-0.5 overflow-y-auto overscroll-contain pr-0.5"
          >
            {minutes.map((minute) => {
              const hour = hh ?? 0;
              const allowed = withinTimeBounds(`${pad(hour)}:${pad(minute)}`, min, max);
              return (
                <button
                  key={minute}
                  type="button"
                  role="option"
                  aria-selected={mm === minute}
                  disabled={!allowed}
                  onClick={() => {
                    emit(hour, minute);
                    setOpen(false);
                  }}
                  className={cn(cell, mm === minute && selectedCell)}
                >
                  {pad(minute)}
                </button>
              );
            })}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
});
TimeInput.displayName = "TimeInput";
