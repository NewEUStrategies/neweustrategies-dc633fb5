import { ensureI18n as ensureEventFrontI18n } from "@/lib/i18n-event-front";
// Molekuła: kompaktowy nagłówek zakładki, bez dekoracyjnej karty i elewacji.
//
// JEDEN NAGŁÓWEK, NIE DWA. Wspólny dla strony publicznej
// (`EventModulePage`) i podglądu studia (`EventPreviewCanvas`): druga kopia
// JSX-a rozjechałaby się z publikacją przy pierwszej zmianie - dokładnie tak,
// jak podgląd rysował dawniej wąską kolumnę, gdy strona dostała szeroką.
// Dane pod nagłówkiem (program, prelegenci, uczestnicy) zostają po stronie
// wywołania - ten plik nie zna źródeł danych.
//
import type { ComponentType, ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { Breadcrumbs, CRUMB_PILL_CLASS, CRUMB_SEPARATOR_CLASS } from "@/components/Breadcrumbs";
import type { BreadcrumbItem } from "@/lib/breadcrumbs";
import {
  CalendarDays,
  ChevronRight,
  Handshake,
  MessagesSquare,
  Mic,
  Users,
  LayoutGrid,
  User,
} from "@/lib/lucide-shim";
import type { EventModule } from "@/lib/events/eventModules";
import { EventSectionHeading } from "@/components/events/public/atoms/EventSectionHeading";
import { cn } from "@/lib/utils";

ensureEventFrontI18n();

type EventHeadingModule = EventModule | "me";
const MODULE_ICONS: Partial<Record<EventHeadingModule, ComponentType<{ className?: string }>>> = {
  me: User,
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
  module: EventHeadingModule;
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
        <nav aria-label={t("eventFront.header.breadcrumbLabel")} className="mb-6 min-w-0">
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
        className="relative mb-6 border-b border-border/50 bg-background"
      >
        <EventSectionHeading
          icon={<Icon className="size-6 text-primary/70" aria-hidden="true" />}
          eyebrow={eventTitle || t("eventFront.header.moduleEyebrow")}
        >
          {hasDocument ? (
            <div className="event-module-hero-doc mx-auto w-full min-w-0 max-w-2xl text-center [overflow-wrap:anywhere] [&_h1]:font-semibold [&_h1]:leading-snug [&_h1]:tracking-normal [&_h1]:text-foreground [&_h1]:text-2xl [&_p:last-child]:mb-0 [&_p]:mx-auto [&_p]:mt-2 [&_p]:max-w-xl [&_p]:text-sm [&_p]:leading-relaxed [&_p]:text-muted-foreground">
              {children}
            </div>
          ) : (
            <h1 className="max-w-full text-2xl font-semibold leading-snug tracking-normal text-foreground [overflow-wrap:anywhere]">
              {moduleLabel}
            </h1>
          )}
        </EventSectionHeading>
      </header>
    </>
  );
}

function ChevronRightStatic() {
  return <ChevronRight className={cn(CRUMB_SEPARATOR_CLASS, "shrink-0")} aria-hidden="true" />;
}
