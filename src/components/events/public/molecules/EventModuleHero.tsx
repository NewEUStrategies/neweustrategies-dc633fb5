import { ensureI18n as ensureEventFrontI18n } from "@/lib/i18n-event-front";
// Molekuła: nagłówek zakładki modułowej (Uczestnicy, Prelegenci, Partnerzy,
// Agenda, Dyskusje) - redakcyjny nagłówek bez karty, poświaty i kafla ikony.
//
// JEDEN NAGŁÓWEK, NIE DWA. Wspólny dla strony publicznej
// (`EventModulePage`) i podglądu studia (`EventPreviewCanvas`): druga kopia
// JSX-a rozjechałaby się z publikacją przy pierwszej zmianie - dokładnie tak,
// jak podgląd rysował dawniej wąską kolumnę, gdy strona dostała szeroką.
// Dane pod nagłówkiem (program, prelegenci, uczestnicy) zostają po stronie
// wywołania - ten plik nie zna źródeł danych.
//
// Zakładki modułowe i „Mój profil” współdzielą nagłówek redakcyjny:
// nadtytuł z wydarzeniem, duży tytuł i włosową linię z akcentem.
// Strona główna nadal używa osobnego `EventSectionHeading`.
//
// KARTA, GRADIENT I KAFEL IKONY ZNIKNĘŁY CELOWO. Poprzedni nagłówek był kartą
// z gradientowym paskiem, poświatą i ikoną w kaflu - wszystkie trzy mówiły
// „dekoracja", a nie „wydarzenie". Hierarchię niosą teraz typografia
// i jedna linia: nadtytuł wersalikami z rozstrzałem, tytuł krojem nagłówków,
// wstęp w kolumnie czytania (~62 znaki).
//
// WYŚRODKOWANY, JAK PASEK ZAKŁADEK - I TO TEŻ JEST DECYZJA WŁAŚCICIELA. Pasek
// nad nagłówkiem stoi na środku kolumny, więc nadtytuł, tytuł, wstęp i odcinek
// linii stoją na tej samej osi; nagłówek przyklejony do lewej krawędzi pod
// wyśrodkowanym paskiem czytał się jak dwa niezależne układy.
//
// TYPOGRAFIA DOKUMENTU CMS IDZIE PRZEZ `!important` W `src/styles.css`. Widget
// nagłówka buildera pisze rozmiar w stylu INLINE (`--td-pt-size`), arkusz ma
// niewarstwowe reguły `[data-cms-content] h1` i mobilne `!important`, a renderer
// publiczny mierzy kontener i po hydratacji przełącza się na układ mobilny.
// Reguły dla `.event-module-hero-doc` stoją w jednym bloku arkusza (nie jako
// kilkanaście wariantów `[&_h1]:!…` - budżet CSS, patrz komentarz bloku).
// Tytuł zapasowy (dokument pusty) dostaje TE SAME miary, więc podmiana
// zapasowego `h1` na dokument po hydratacji nie zmienia wysokości tytułu.
//
// RUCH TYLKO PRZY PRZEJŚCIU MIĘDZY ZAKŁADKAMI. Odcinek linii „rysuje się"
// wyłącznie w nagłówku zamontowanym po otwarciu bramki ruchu (`motionGate.ts`,
// klasa `event-module-hero-accent--enter`), więc zimne wejście na stronę maluje
// nagłówek od razu, bez wpływu na Speed Index.
//
import { useState, type ComponentType, type ReactNode } from "react";
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
import { cn } from "@/lib/utils";
import { useMotionGate } from "@/lib/performance/motionGate";

ensureEventFrontI18n();

type EventHeadingModule = EventModule | "me";
const MODULE_ICONS: Partial<
  Record<EventHeadingModule, ComponentType<{ className?: string; strokeWidth?: number }>>
> = {
  me: User,
  participants: Users,
  speakers: Mic,
  partners: Handshake,
  agenda: CalendarDays,
  discussions: MessagesSquare,
};

const ACCENT_STYLE = { backgroundColor: "var(--primary)" } as const;

/** Okruszki: ostatni bez `href` = pozycja bieżąca (jak w `Breadcrumbs`). */
export type EventModuleCrumb = BreadcrumbItem;

/**
 * Miary tytułu - te same, które `src/styles.css` nadaje `h1` dokumentu CMS
 * w nagłówku (blok „ZAKŁADKI MODUŁOWE WYDARZENIA"), żeby podmiana zapasowego
 * `h1` na dokument po hydratacji nie przesuwała strony. Wysokość linii 1.2
 * zostawia pełne znaki diakrytyczne i ogony (ą, ę, ł, g, j, y) - ciaśniejsza
 * miara zaczynała obcinać dolne części liter.
 */
const TITLE_CLASS =
  "font-display text-[2rem] font-semibold leading-[1.2] tracking-[-0.02em] text-foreground sm:text-4xl";

export function EventModuleHero({
  module,
  eventTitle,
  moduleLabel,
  crumbs,
  breadcrumbLinks = true,
  hasDocument,
  children,
}: {
  /** Który z pięciu modułów rysuje zakładka - dobiera ikonę nadtytułu. */
  module: EventHeadingModule;
  /** Nazwa wydarzenia w nadtytule; pusta -> zapasowy napis ze słownika. */
  eventTitle: string;
  /** Tytuł zakładki (z bazy) - awaryjny `h1`, gdy dokument CMS-a jest pusty. */
  moduleLabel: string;
  /** Okruszki nad nagłówkiem: dom -> Wydarzenia -> wydarzenie -> zakładka. */
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
  // Odcinek linii „rysuje się" tylko w nagłówku zamontowanym PO otwarciu bramki
  // ruchu, czyli przy przejściu między zakładkami. Wartość z pierwszego renderu:
  // `false` w SSR i przy hydratacji, więc otwarcie bramki nad gotowym
  // nagłówkiem (pierwszy gest, punkt ciszy) nie zeruje i nie rysuje go drugi raz.
  const motion = useMotionGate();
  const [accentEnters] = useState(motion);

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
          className="relative mb-10 border-b border-border/70 pb-8 pt-2 sm:pb-10"
        >
          {/* Nadtytuł: ikona modułu włosową kreską i nazwa wydarzenia. `div`,
              nie `p`: globalne `:where(main p:hover)` przemalowuje akapity
              na kolor tekstu przy najechaniu, a nadtytuł ma stać spokojnie. */}
          <div className="flex min-w-0 items-center justify-center gap-2.5 text-[11px] font-semibold uppercase leading-4 tracking-[0.16em] text-muted-foreground">
            <Icon className="size-4 shrink-0 text-primary" strokeWidth={1.5} aria-hidden="true" />
            <span className="min-w-0 truncate">
              {eventTitle || t("eventFront.header.moduleEyebrow")}
            </span>
          </div>
          <div className="mt-4">
            {hasDocument ? (
              <div className="event-module-hero-doc mx-auto w-full min-w-0 max-w-3xl text-center [overflow-wrap:anywhere]">
                {children}
              </div>
            ) : (
              <h1
                className={cn(
                  TITLE_CLASS,
                  "mx-auto max-w-3xl text-center [overflow-wrap:anywhere]",
                )}
              >
                {moduleLabel}
              </h1>
            )}
          </div>
          {/* Odcinek linii w kolorze akcji wydarzenia - jedyny akcent nagłówka.
              Kolor stylem, nie klasą `bg-primary`: globalna, niewarstwowa
              reguła `:where(.bg-primary)` podmienia tło na kolor przycisków
              serwisu (`--gc-btn-bg`) i gubiłaby kolor akcji wydarzenia. */}
          <span
            aria-hidden="true"
            className={cn(
              "event-module-hero-accent absolute inset-x-0 -bottom-px mx-auto h-px w-16",
              accentEnters && "event-module-hero-accent--enter",
            )}
            style={ACCENT_STYLE}
          />
        </header>
    </>
  );
}

function ChevronRightStatic() {
  return <ChevronRight className={cn(CRUMB_SEPARATOR_CLASS, "shrink-0")} aria-hidden="true" />;
}
