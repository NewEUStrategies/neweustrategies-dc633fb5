// Okno profilu (osoba / instytucja) - LAZY CHUNK, pobierany przy pierwszym
// kliknięciu (patrz `EventDirectoryContext`).
//
// PRYMITYW RADIKSA WPROST, NIE `ui/dialog`. Wspólny `DialogContent` ma na
// sztywno środek ekranu, `max-w-lg`, krzyżyk w rogu i 200 ms skali - a to okno
// ma na telefonie być arkuszem od dołu (kciuk sięga do zamknięcia, treść
// przewija się pod nagłówkiem), a na komputerze wąską kolumną czytania.
// Zwrot fokusu do przycisku, który okno otworzył, daje ten sam `useReturnFocus`
// co wspólny prymityw.
//
// STOS WIDOKÓW Z KIERUNKIEM. Wejście głębiej (osoba -> instytucja) wsuwa widok
// z prawej, „Wstecz" - z lewej; obie drogi to 300 ms i 12 px, więc ruch mówi,
// gdzie jesteśmy, a nie zwraca na siebie uwagi. Kierunek to zmienna
// `--tw-enter-translate-x` w stylu - ta sama klasa `animate-in`, bez nowej
// reguły w arkuszu.
//
// OKNO NIESIE ZAKRES MARKI WYDARZENIA. Portal Radiksa wynosi treść do
// `<body>`, poza `[data-event-branding]` powłoki - kolory wydarzenia (akcja,
// tło bloków, tekst) by znikały. Arkusz marki (`EventBrandingStyle`) pisze
// reguły dla atrybutu, nie dla węzła, więc wystarczy ten sam atrybut na oknie. Fokus idzie na nagłówek
// nowego widoku: czytnik ekranu ogłasza nazwisko albo nazwę firmy, a nie
// „przycisk Wstecz".
import { useEffect, useId, useRef } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useTranslation } from "react-i18next";

import { uiLang } from "@/lib/i18n/format";
import { eventBrandingScopeProps } from "@/lib/events/eventBrandingCss";
import { findDirectoryPerson, type EventDirectory } from "@/lib/events/eventDirectory";
import type { SponsorPlacement } from "@/lib/events/sponsorExposure";
import { ArrowLeft, X } from "@/lib/lucide-shim";
import { useReturnFocus } from "@/lib/utils";
import { ensureI18n as ensureEventFrontI18n } from "@/lib/i18n-event-front";

import type { DirectoryView } from "./EventDirectoryContext";
import { DirectoryCompanyView } from "./DirectoryCompanyView";
import { DirectoryPersonView } from "./DirectoryPersonView";
import { Overline } from "./directoryParts";

ensureEventFrontI18n();

// Nakładka: te same klasy, co wspólny `DialogOverlay` (zero nowego CSS-a).
// Układ okna i zmienne jego ruchu: `.edd-content` w `src/styles.css` (blok „ZAKŁADKI MODUŁOWE
// WYDARZENIA") - wyjaśnienie, dlaczego nie warianty narzędzi, stoi przy bloku.
const OVERLAY_CLASS =
  "fixed inset-0 z-50 bg-black/40 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0";

const ICON_BUTTON_CLASS =
  "inline-flex h-9 items-center gap-1.5 rounded-[6px] px-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function EventDirectoryDialog({
  open,
  onOpenChange,
  stack,
  onBack,
  onNavigate,
  directory,
  slug,
  eventId,
  live,
  sponsorPlacement,
  onSessionSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stack: readonly DirectoryView[];
  onBack: () => void;
  /** Widok otwierany z WNĘTRZA okna - dokładany na stos (powrót „Wstecz"). */
  onNavigate: (view: DirectoryView) => void;
  directory: EventDirectory;
  slug: string | null;
  eventId: string | null;
  live: boolean;
  sponsorPlacement: SponsorPlacement | null;
  onSessionSelect?: (sessionId: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const titleId = useId();
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const top = stack.at(-1) ?? null;
  const depth = stack.length;

  // Kierunek liczony z poprzedniej głębokości w trakcie renderu: efekt
  // spóźniłby się o klatkę i nowy widok wjechałby z niewłaściwej strony.
  const previousDepth = useRef(depth);
  const direction = depth < previousDepth.current ? "back" : "forward";
  useEffect(() => {
    previousDepth.current = depth;
  }, [depth]);

  const viewKey = top === null ? "empty" : `${top.kind}:${top.key}:${depth}`;
  // Klik w sesję (agenda) zamyka okno i odsłania blok sesji, który sam
  // przejmuje fokus. Zwrot fokusu do przycisku, który okno otworzył, biegnie
  // dopiero po animacji zamknięcia - już PO przewinięciu do sesji - i bez
  // `preventScroll` przewijał stronę z powrotem do karty, z której przyszliśmy.
  const leavingForSession = useRef(false);
  const focus = useReturnFocus(
    (event) => {
      leavingForSession.current = false;
      // Fokus na nagłówek, nie na pierwszy przycisk - patrz nagłówek pliku.
      event.preventDefault();
      document.getElementById(titleId)?.focus({ preventScroll: true });
    },
    (event) => {
      if (!leavingForSession.current) return;
      leavingForSession.current = false;
      event.preventDefault();
    },
  );
  const selectSession =
    onSessionSelect === undefined
      ? undefined
      : (sessionId: string) => {
          leavingForSession.current = true;
          onSessionSelect(sessionId);
        };

  useEffect(() => {
    if (!open || depth <= 1) return;
    bodyRef.current?.scrollTo({ top: 0 });
    document.getElementById(titleId)?.focus({ preventScroll: true });
  }, [open, viewKey, depth, titleId]);

  const person = top?.kind === "person" ? findDirectoryPerson(directory, top.key) : null;
  const viewLabel =
    top?.kind === "company"
      ? t("eventFront.directory.dialogCompany")
      : t("eventFront.directory.dialogPerson");

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={OVERLAY_CLASS} />
        <DialogPrimitive.Content
          aria-labelledby={titleId}
          data-event-directory-dialog=""
          {...eventBrandingScopeProps}
          className="edd-content fixed inset-x-0 bottom-0 z-50 flex max-h-[92vh] flex-col rounded-t-lg border-t border-border bg-popover text-popover-foreground shadow-2xl outline-none duration-300 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0"
          {...focus}
        >
          <span
            aria-hidden="true"
            className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-border sm:hidden"
          />
          <div className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border/70 px-3 sm:px-5">
            {depth > 1 ? (
              <button type="button" onClick={onBack} className={ICON_BUTTON_CLASS}>
                <ArrowLeft aria-hidden="true" strokeWidth={1.5} className="size-4" />
                {t("eventFront.directory.back")}
              </button>
            ) : (
              <Overline className="px-2">{viewLabel}</Overline>
            )}
            <DialogPrimitive.Close className={ICON_BUTTON_CLASS}>
              <X aria-hidden="true" strokeWidth={1.5} className="size-4" />
              <span className="sr-only">{t("eventFront.directory.close")}</span>
            </DialogPrimitive.Close>
          </div>
          <DialogPrimitive.Description className="sr-only">
            {top?.kind === "company"
              ? t("eventFront.directory.companyDescription")
              : t("eventFront.directory.personDescription")}
          </DialogPrimitive.Description>

          <div
            ref={bodyRef}
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-8 pt-6 sm:px-8"
          >
            <div
              key={viewKey}
              className="motion-safe:animate-in motion-safe:fade-in-0 duration-300"
              style={
                depth <= 1
                  ? undefined
                  : {
                      ["--tw-enter-translate-x" as string]: direction === "back" ? "-12px" : "12px",
                    }
              }
            >
              {top === null ? null : top.kind === "person" ? (
                person === null ? (
                  <NotFound titleId={titleId} />
                ) : (
                  <DirectoryPersonView
                    person={person}
                    directory={directory}
                    lang={lang}
                    slug={slug}
                    eventId={eventId}
                    live={live}
                    titleId={titleId}
                    onOpenCompany={(key, seed) => onNavigate({ kind: "company", key, ...seed })}
                    onSessionSelect={selectSession}
                  />
                )
              ) : (
                <DirectoryCompanyView
                  orgKey={top.key}
                  seed={{ name: top.name, logoUrl: top.logoUrl }}
                  directory={directory}
                  lang={lang}
                  slug={slug}
                  live={live}
                  titleId={titleId}
                  sponsorPlacement={sponsorPlacement}
                  onOpenPerson={(key) => onNavigate({ kind: "person", key })}
                  onSessionSelect={selectSession}
                />
              )}
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function NotFound({ titleId }: { titleId: string }) {
  const { t } = useTranslation();
  return (
    <div className="py-6">
      <DialogPrimitive.Title asChild>
        <h2
          id={titleId}
          tabIndex={-1}
          className="text-lg font-semibold text-foreground outline-none"
        >
          {t("eventFront.directory.notFoundTitle")}
        </h2>
      </DialogPrimitive.Title>
      <p className="mt-2 text-sm text-muted-foreground">{t("eventFront.directory.notFoundBody")}</p>
    </div>
  );
}
