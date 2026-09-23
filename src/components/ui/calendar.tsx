"use client";

// ETYKIETY ARIA KALENDARZA IDĄ ZA JĘZYKIEM INTERFEJSU.
//
// react-day-picker 9 bierze nazwy przycisków nawigacji, siatki i dni
// z `locale.labels`, a gdy ich brak - z angielskich domyślnych („Go to the Next
// Month", „Today, ..."). Wywołujący podają `locale` z date-fns, który formatuje
// daty, ale ETYKIET NIE MA - więc przy polskim interfejsie czytnik ekranu
// czytał nawigację po angielsku. Kalendarz dokłada więc etykiety języka
// interfejsu (`pl` albo `enUS` z `react-day-picker/locale/*`) do `locale`
// wywołującego, nie ruszając reszty obiektu:
//   - `locale` wywołującego nadal formatuje daty (podpis miesiąca, dni tygodnia),
//   - etykiety z `locale` wywołującego (locale react-day-pickera) wygrywają
//     z etykietami interfejsu, a prop `labels` wygrywa z obydwoma - to
//     kolejność samego `getLabels` biblioteki,
//   - bez `locale` kalendarz formatuje i podpisuje w języku interfejsu.
// Język bierzemy z `i18n.language`, jak każdy dzisiejszy wywołujący wybierający
// locale date-fns - etykiety i formatowanie nie rozjadą się między sobą.
//
// IMPORT PER JĘZYK, NIE BECZKA `react-day-picker/locale` (reeksportuje ~100
// locale date-fns). `en-US` to ten sam moduł, który biblioteka ładuje jako
// domyślny - koszt zero. `pl` NIE jest darmowy: `react-day-picker/locale/pl`
// importuje `date-fns/locale` z WŁASNEGO, zagnieżdżonego date-fns 4.1.0
// react-day-pickera (bun.lock), a wywołujący biorą `pl` z date-fns 4.4.0
// aplikacji - to dwa osobne moduły, więc do chunka trafia DRUGA kopia polskiego
// locale date-fns (~2,4 KB gzip razem z etykietami), dopóki date-fns nie
// zostanie zdeduplikowany w bun.lock. Każdy kolejny język UI kosztuje podobnie.
import * as React from "react";
import { useTranslation } from "react-i18next";
import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon } from "@/lib/lucide-shim";
import { DayButton, DayPicker, getDefaultClassNames, type DayPickerLocale } from "react-day-picker";
import { enUS as dayPickerEnUS } from "react-day-picker/locale/en-US";
import { pl as dayPickerPl } from "react-day-picker/locale/pl";

import { cn } from "@/lib/utils";
import { DEFAULT_LANG, normalizeLang, type AppLang } from "@/lib/i18n/localePath";
import { Button, buttonVariants } from "@/components/ui/button";

const UI_LOCALES: Record<AppLang, DayPickerLocale> = {
  pl: dayPickerPl,
  en: dayPickerEnUS,
};

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  captionLayout = "label",
  buttonVariant = "ghost",
  formatters,
  components,
  locale,
  ...props
}: React.ComponentProps<typeof DayPicker> & {
  buttonVariant?: React.ComponentProps<typeof Button>["variant"];
}) {
  const defaultClassNames = getDefaultClassNames();
  const { i18n } = useTranslation();
  const uiLocale = UI_LOCALES[normalizeLang(i18n.language) ?? DEFAULT_LANG];
  const labelledLocale = React.useMemo(() => {
    const base = locale ?? uiLocale;
    return { ...base, labels: { ...uiLocale.labels, ...base.labels } };
  }, [locale, uiLocale]);

  return (
    <DayPicker
      locale={labelledLocale}
      showOutsideDays={showOutsideDays}
      className={cn(
        "bg-background group/calendar p-3 [--cell-size:2rem] [[data-slot=card-content]_&]:bg-transparent [[data-slot=popover-content]_&]:bg-transparent",
        String.raw`rtl:**:[.rdp-button\_next>svg]:rotate-180`,
        String.raw`rtl:**:[.rdp-button\_previous>svg]:rotate-180`,
        className,
      )}
      captionLayout={captionLayout}
      formatters={{
        formatMonthDropdown: (date) => date.toLocaleString("default", { month: "short" }),
        ...formatters,
      }}
      classNames={{
        root: cn("w-fit", defaultClassNames.root),
        months: cn("relative flex flex-col gap-4 md:flex-row", defaultClassNames.months),
        month: cn("flex w-full flex-col gap-4", defaultClassNames.month),
        nav: cn(
          "absolute inset-x-0 top-0 flex w-full items-center justify-between gap-1",
          defaultClassNames.nav,
        ),
        button_previous: cn(
          buttonVariants({ variant: buttonVariant }),
          "h-(--cell-size) w-(--cell-size) select-none p-0 aria-disabled:opacity-50",
          defaultClassNames.button_previous,
        ),
        button_next: cn(
          buttonVariants({ variant: buttonVariant }),
          "h-(--cell-size) w-(--cell-size) select-none p-0 aria-disabled:opacity-50",
          defaultClassNames.button_next,
        ),
        month_caption: cn(
          "flex h-(--cell-size) w-full items-center justify-center px-(--cell-size)",
          defaultClassNames.month_caption,
        ),
        dropdowns: cn(
          "flex h-(--cell-size) w-full items-center justify-center gap-1.5 text-sm font-medium",
          defaultClassNames.dropdowns,
        ),
        dropdown_root: cn(
          "has-focus:border-ring border-input shadow-xs has-focus:ring-ring/50 has-focus:ring-[3px] relative rounded-md border",
          defaultClassNames.dropdown_root,
        ),
        dropdown: cn("bg-popover absolute inset-0 opacity-0", defaultClassNames.dropdown),
        caption_label: cn(
          "select-none font-medium",
          captionLayout === "label"
            ? "text-sm"
            : "[&>svg]:text-muted-foreground flex h-8 items-center gap-1 rounded-md pl-2 pr-1 text-sm [&>svg]:size-3.5",
          defaultClassNames.caption_label,
        ),
        table: "w-full border-collapse",
        weekdays: cn("flex", defaultClassNames.weekdays),
        weekday: cn(
          "text-muted-foreground flex-1 select-none rounded-md text-[0.8rem] font-normal",
          defaultClassNames.weekday,
        ),
        week: cn("mt-2 flex w-full", defaultClassNames.week),
        week_number_header: cn("w-(--cell-size) select-none", defaultClassNames.week_number_header),
        week_number: cn(
          "text-muted-foreground select-none text-[0.8rem]",
          defaultClassNames.week_number,
        ),
        day: cn(
          "group/day relative aspect-square h-full w-full select-none p-0 text-center [&:first-child[data-selected=true]_button]:rounded-l-md [&:last-child[data-selected=true]_button]:rounded-r-md",
          defaultClassNames.day,
        ),
        range_start: cn("bg-accent rounded-l-md", defaultClassNames.range_start),
        range_middle: cn("rounded-none", defaultClassNames.range_middle),
        range_end: cn("bg-accent rounded-r-md", defaultClassNames.range_end),
        today: cn(
          "bg-accent text-accent-foreground rounded-md data-[selected=true]:rounded-none",
          defaultClassNames.today,
        ),
        outside: cn(
          "text-muted-foreground aria-selected:text-muted-foreground",
          defaultClassNames.outside,
        ),
        disabled: cn("text-muted-foreground opacity-50", defaultClassNames.disabled),
        hidden: cn("invisible", defaultClassNames.hidden),
        ...classNames,
      }}
      components={{
        Root: ({ className, rootRef, ...props }) => {
          return <div data-slot="calendar" ref={rootRef} className={cn(className)} {...props} />;
        },
        Chevron: ({ className, orientation, ...props }) => {
          if (orientation === "left") {
            return <ChevronLeftIcon className={cn("size-4", className)} {...props} />;
          }

          if (orientation === "right") {
            return <ChevronRightIcon className={cn("size-4", className)} {...props} />;
          }

          return <ChevronDownIcon className={cn("size-4", className)} {...props} />;
        },
        DayButton: CalendarDayButton,
        WeekNumber: ({ children, ...props }) => {
          return (
            <td {...props}>
              <div className="flex size-(--cell-size) items-center justify-center text-center">
                {children}
              </div>
            </td>
          );
        },
        ...components,
      }}
      {...props}
    />
  );
}

function CalendarDayButton({
  className,
  day,
  modifiers,
  ...props
}: React.ComponentProps<typeof DayButton>) {
  const defaultClassNames = getDefaultClassNames();

  const ref = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    if (modifiers.focused) ref.current?.focus();
  }, [modifiers.focused]);

  return (
    <Button
      ref={ref}
      variant="ghost"
      size="icon"
      data-day={day.date.toLocaleDateString()}
      data-selected-single={
        modifiers.selected &&
        !modifiers.range_start &&
        !modifiers.range_end &&
        !modifiers.range_middle
      }
      data-range-start={modifiers.range_start}
      data-range-end={modifiers.range_end}
      data-range-middle={modifiers.range_middle}
      className={cn(
        "data-[selected-single=true]:bg-primary data-[selected-single=true]:text-primary-foreground data-[range-middle=true]:bg-accent data-[range-middle=true]:text-accent-foreground data-[range-start=true]:bg-primary data-[range-start=true]:text-primary-foreground data-[range-end=true]:bg-primary data-[range-end=true]:text-primary-foreground group-data-[focused=true]/day:border-ring group-data-[focused=true]/day:ring-ring/50 flex aspect-square h-auto w-full min-w-(--cell-size) flex-col gap-1 font-normal leading-none data-[range-end=true]:rounded-md data-[range-middle=true]:rounded-none data-[range-start=true]:rounded-md group-data-[focused=true]/day:relative group-data-[focused=true]/day:z-10 group-data-[focused=true]/day:ring-[3px] [&>span]:text-xs [&>span]:opacity-70",
        defaultClassNames.day,
        className,
      )}
      {...props}
    />
  );
}

export { Calendar };
