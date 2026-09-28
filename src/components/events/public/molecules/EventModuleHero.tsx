// Molekuła: NAGŁÓWEK ZAKŁADKI MODUŁOWEJ (wariant „centrowana, lekka elewacja")
// - okruszki + karta z gradientowym paskiem, kaflą ikony nad tytułem, nazwą
// wydarzenia w pigułce i miękkim cieniem.
//
// JEDEN NAGŁÓWEK, NIE DWA. Wspólny dla strony publicznej
// (`EventModulePage`) i podglądu studia (`EventPreviewCanvas`): druga kopia
// JSX-a rozjechałaby się z publikacją przy pierwszej zmianie - dokładnie tak,
// jak podgląd rysował dawniej wąską kolumnę, gdy strona dostała szeroką.
// Dane pod nagłówkiem (program, prelegenci, uczestnicy) zostają po stronie
// wywołania - ten plik nie zna źródeł danych.
//
// KAFEL MA W KLASIE `bg-card`, a globalna reguła `:where(main svg, …
// [class*="card"] svg)` nadpisuje dziedziczony kolor ikony na
// `var(--gc-icon)`. `:where` ma zerową specyficzność, więc klasa `text-primary`
// na SAMYM SVG wygrywa - kolor ikony idzie więc jawnie, nie przez dziedziczenie.
import type { ComponentType, ReactNode } from "react";
import { useTranslation } from "react-i18next";

import {
  Breadcrumbs,
  CRUMB_PILL_CLASS,
  CRUMB_SEPARATOR_CLASS,
} from "@/components/Breadcrumbs";
import type { BreadcrumbItem } from "@/lib/breadcrumbs";
import {
  CalendarDays,
  ChevronRight,
  Handshake,
  MessagesSquare,
  Mic,
  Users,
  LayoutGrid,
} from "@/lib/lucide-shim";
import type { EventModule } from "@/lib/events/eventModules";
import { cn } from "@/lib/utils";

const MODULE_ICONS: Partial<Record<EventModule, ComponentType<{ className?: string }>>> = {
  participants: Users,
  speakers: Mic,
  partners: Handshake,
  agenda: CalendarDays,
  discussions: MessagesSquare,
};

/** Okruszki: ostatni bez `href` = pozycja bieżąca (jak w `Breadcrumbs`). */
export type EventModuleCrumb = BreadcrumbItem;

export function EventModuleHero({
  module,
  eventTitle,
  moduleLabel,
  crumbs,
  breadcrumbLinks = true,
  hasDocument,
  children,
}: {
  /** Który z pięciu modułów rysuje zakładka - dobiera ikonę kafla. */
  module: EventModule;
  /** Nazwa wydarzenia w pigułce; pusta -> zapasowy napis ze słownika. */
  eventTitle: string;
  /** Tytuł zakładki (z bazy) - awaryjny `h1`, gdy dokument CMS-a jest pusty. */
  moduleLabel: string;
  /** Okruszki nad kartą: dom -> Wydarzenia -> wydarzenie -> zakładka. */
  crumbs: EventModuleCrumb[];
  /**
   * FAŁSZ = okruszki BEZ linków (podgląd studia). Klik wyprowadzałby
   * redaktora ze studia i zgubił niezapisany szkic - ta sama zasada, którą
   * `EventPreviewCanvas` stosuje do paska zakładek (`PreviewNavItem`).
   * Wygląd okruszków jest WSPÓLNY z `Breadcrumbs` (te same klasy CRUMB_*),
   * więc podgląd i strona publiczna mają identyczny rysunek.
   */
  breadcrumbLinks?: boolean;
  /** Fałsz = dokument CMS-a nie ma treści -> awaryjny `h1` z etykietą modułu. */
  hasDocument: boolean;
  /** Treść dokumentu strony (renderer CMS-a albo buildera w podglądzie). */
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const Icon = MODULE_ICONS[module] ?? LayoutGrid;

  return (
    <>
      {breadcrumbLinks ? (
        <Breadcrumbs items={crumbs} className="mb-6" />
      ) : (
        <nav aria-label="breadcrumb" className="mb-6 min-w-0">
          <ol className={CRUMB_PILL_CLASS}>
            {crumbs.map((crumb, index) => {
              const isLast = index === crumbs.length - 1;
              return (
                <li
                  key={`${crumb.label}-${index}`}
                  className={cn(
                    "inline-flex min-w-0 items-center gap-1.5",
                    isLast ? "flex-1" : "shrink-0 sm:min-w-0",
                  )}
                  {...(isLast ? { "aria-current": "page" as const } : {})}
                >
                  {index > 0 ? <ChevronRightStatic /> : null}
                  <span
                    className={cn(
                      "min-w-0 truncate text-xs leading-5",
                      isLast ? "font-medium text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {crumb.label}
                  </span>
                </li>
              );
            })}
          </ol>
        </nav>
      )}
      <header
        data-event-module-hero={module}
        className="relative mb-10 overflow-hidden rounded-[24px] border border-border bg-card shadow-[0_32px_64px_-24px_rgba(45,35,20,0.12)] sm:rounded-[40px]"
      >
        <div aria-hidden="true" className="absolute inset-x-0 top-0 flex h-1">
          <div className="h-full w-1/3 bg-gradient-to-r from-transparent to-primary" />
          <div className="h-full flex-1 bg-primary" />
          <div className="h-full w-1/3 bg-gradient-to-l from-transparent to-primary" />
        </div>
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-0 h-32 w-3/4 -translate-x-1/2 rounded-full bg-primary/5 blur-[80px]"
        />
        <div className="relative flex flex-col items-center px-6 pb-10 pt-12 text-center sm:px-10 sm:pt-14">
          <span className="relative mb-6 grid size-16 shrink-0 place-items-center rounded-[24px] border border-border bg-card text-primary shadow-sm sm:size-20">
            <span
              aria-hidden="true"
              className="absolute inset-0 -z-10 scale-110 rounded-full bg-primary/15 blur-2xl"
            />
            <Icon className="size-8 text-primary sm:size-9" aria-hidden="true" />
          </span>
          <p className="mb-4 inline-flex max-w-full items-center rounded-full border border-border bg-muted/50 px-4 py-1.5 text-[11px] font-bold uppercase tracking-[0.25em] text-primary">
            <span className="line-clamp-2 [overflow-wrap:anywhere]">
              {eventTitle || t("eventFront.header.moduleEyebrow")}
            </span>
          </p>
          {hasDocument ? (
            <div className="event-module-hero-doc mx-auto max-w-2xl text-center [&_h1]:font-extrabold [&_h1]:leading-[1.1] [&_h1]:tracking-tight [&_h1]:text-foreground [&_h1]:text-3xl sm:[&_h1]:text-5xl [&_p:last-child]:mb-0 [&_p]:mx-auto [&_p]:mt-4 [&_p]:max-w-xl [&_p]:text-lg [&_p]:leading-relaxed [&_p]:text-muted-foreground sm:[&_p]:text-xl">
              {children}
            </div>
          ) : (
            <h1 className="text-3xl font-extrabold leading-[1.1] tracking-tight text-foreground sm:text-5xl">
              {moduleLabel}
            </h1>
          )}
        </div>
      </header>
    </>
  );
}

function ChevronRightStatic() {
  return <ChevronRight className={cn(CRUMB_SEPARATOR_CLASS, "shrink-0")} aria-hidden="true" />;
}
