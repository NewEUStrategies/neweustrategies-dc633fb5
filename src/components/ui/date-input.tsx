// DateInput - wspólny atom daty: natywny <input type="date|datetime-local">
// z kalendarzem w motywie platformy.
//
// Kontrakt pola (AGENTS.md: lokalne daty i natywne wartości formularza):
//   - jedyną kontrolką z etykietą jest natywny <input>, więc <label htmlFor>,
//     etykieta-otoczka i aria-label wskazują dokładnie jedno pole;
//   - wartość to zawsze lokalny łańcuch "YYYY-MM-DD" albo "YYYY-MM-DDTHH:mm"
//     (z sekundami przy step < 60) - nigdy ISO/UTC, więc dzień się nie
//     przesuwa; konwersje ISO zostają w helperach wywołujących;
//   - `onChange` dostaje prawdziwe ChangeEvent zarówno przy wpisywaniu, jak
//     i przy wyborze z kalendarza (zapis natywnym setterem + zdarzenie
//     `input`), więc tryb kontrolowany i niekontrolowany (FormData) działa
//     tak samo;
//   - `required`, `min` i `max` korzystają z natywnej walidacji, wyłączone
//     pole nie trafia do FormData.
// Kalendarz otwiera ikona (dekoracyjna, poza drzewem dostępności - nie jest
// drugą kontrolką etykiety) albo Alt+ArrowDown / F4 w polu. Wszystkie
// przyciski kalendarza żyją w portalu popovera. Godzina dla datetime-local
// jest wyłączona, dopóki nie ma daty.
import * as React from "react";
import { useTranslation } from "react-i18next";
import { format, isValid, parse } from "date-fns";
import { pl, enGB } from "date-fns/locale";
import { CalendarDays } from "@/lib/lucide-shim";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { TimeInput } from "@/components/ui/time-input";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import "@/lib/i18n-datetime-picker";

type DateInputProps = Omit<
  React.ComponentPropsWithoutRef<"input">,
  "type" | "value" | "defaultValue"
> & {
  type: "date" | "datetime-local";
  /** Lokalny łańcuch natywnego pola; `null` znaczy puste. */
  value?: string | null;
  defaultValue?: string;
};

/** Dzień z lokalnego łańcucha "YYYY-MM-DD..." - lokalna północ, bez UTC. */
function parseLocalDay(input: unknown): Date | undefined {
  if (typeof input !== "string" || input.length < 10) return undefined;
  const day = parse(input.slice(0, 10), "yyyy-MM-dd", new Date());
  return isValid(day) ? day : undefined;
}

/**
 * Zapis jak przy wpisaniu: natywny setter omija śledzenie wartości Reacta,
 * a bąbelkujące `input` wywołuje `onChange` prawdziwym ChangeEvent.
 */
function writeNativeValue(input: HTMLInputElement, next: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, next);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

export const DateInput = React.forwardRef<HTMLInputElement, DateInputProps>(function DateInput(
  {
    type,
    value,
    defaultValue,
    onChange,
    onKeyDown,
    className,
    min,
    max,
    step,
    disabled,
    readOnly,
    ...props
  },
  forwardedRef,
) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith("en") ? "en" : "pl";
  const locale = lang === "en" ? enGB : pl;
  const timeId = React.useId();
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const anchorRef = React.useRef<HTMLDivElement | null>(null);
  const interactedOutside = React.useRef(false);
  const [open, setOpen] = React.useState(false);
  const controlled = value !== undefined;
  const [uncontrolledValue, setUncontrolledValue] = React.useState(defaultValue ?? "");
  const current = controlled ? (value ?? "") : uncontrolledValue;

  const setInputRef = React.useCallback(
    (node: HTMLInputElement | null) => {
      inputRef.current = node;
      if (typeof forwardedRef === "function") forwardedRef(node);
      else if (forwardedRef) forwardedRef.current = node;
    },
    [forwardedRef],
  );

  const day = parseLocalDay(current);
  const dayKey = day ? format(day, "yyyy-MM-dd") : "";
  const time = type === "datetime-local" && day ? current.slice(11) : "";
  const lower = parseLocalDay(min);
  const upper = parseLocalDay(max);
  const interactive = !disabled && !readOnly;
  const boundTime = (bound: unknown) =>
    typeof bound === "string" && dayKey && bound.slice(0, 10) === dayKey && bound.length > 11
      ? bound.slice(11, 16)
      : undefined;
  const emit = (next: string) => {
    if (inputRef.current) writeNativeValue(inputRef.current, next);
  };
  const label = t("dateTimePicker.openCalendar", { lng: lang });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div ref={anchorRef} className={cn("platform-date-input relative min-w-0", className)}>
          <input
            ref={setInputRef}
            type={type}
            data-slot="platform-date"
            value={controlled ? (value ?? "") : undefined}
            defaultValue={controlled ? undefined : defaultValue}
            min={min}
            max={max}
            step={step}
            disabled={disabled}
            readOnly={readOnly}
            onChange={(event) => {
              if (!controlled) setUncontrolledValue(event.target.value);
              onChange?.(event);
            }}
            onKeyDown={(event) => {
              onKeyDown?.(event);
              if (event.defaultPrevented || !interactive) return;
              if ((event.altKey && event.key === "ArrowDown") || event.key === "F4") {
                event.preventDefault();
                setOpen(true);
              }
            }}
            className="platform-field platform-field--affix-end w-full min-w-0 border border-input bg-background text-foreground tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive"
            {...props}
          />
          <span
            aria-hidden="true"
            data-calendar-opener=""
            title={label}
            onPointerDown={(event) => event.preventDefault()}
            onClick={(event) => {
              event.preventDefault();
              if (interactive) setOpen((wasOpen) => !wasOpen);
            }}
            className={cn(
              "absolute right-2 top-1/2 inline-flex size-5 -translate-y-1/2 items-center justify-center text-muted-foreground",
              interactive
                ? "cursor-pointer hover:text-foreground"
                : "pointer-events-none opacity-50",
            )}
          >
            <CalendarDays className="size-4" />
          </span>
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        aria-label={label}
        className="w-auto max-w-[calc(100vw-2rem)] p-0"
        onInteractOutside={(event) => {
          // Pole i ikona należą do kontrolki: pisanie w polu nie zamyka kalendarza.
          if (anchorRef.current?.contains(event.target as Node)) {
            event.preventDefault();
            return;
          }
          interactedOutside.current = true;
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (!interactedOutside.current) inputRef.current?.focus();
          interactedOutside.current = false;
        }}
      >
        <Calendar
          mode="single"
          selected={day}
          defaultMonth={day ?? lower}
          locale={locale}
          weekStartsOn={1}
          disabled={[...(lower ? [{ before: lower }] : []), ...(upper ? [{ after: upper }] : [])]}
          onSelect={(next) => {
            if (!next) return;
            const nextDay = format(next, "yyyy-MM-dd");
            emit(type === "date" ? nextDay : `${nextDay}T${time || "00:00"}`);
            if (type === "date") setOpen(false);
          }}
          autoFocus
        />
        {type === "datetime-local" && (
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t border-border p-3">
            <label htmlFor={timeId}>{t("dateTimePicker.time", { lng: lang })}</label>
            <TimeInput
              id={timeId}
              className="w-32"
              value={time}
              step={step}
              disabled={!day}
              min={boundTime(min)}
              max={boundTime(max)}
              onChange={(event) => {
                if (dayKey && event.target.value) emit(`${dayKey}T${event.target.value}`);
              }}
            />
          </div>
        )}
        <div className="flex justify-end gap-1 border-t border-border p-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!current}
            onClick={() => {
              emit("");
              setOpen(false);
            }}
          >
            {t("dateTimePicker.clear", { lng: lang })}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
            {t("dateTimePicker.done", { lng: lang })}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
});
DateInput.displayName = "DateInput";
