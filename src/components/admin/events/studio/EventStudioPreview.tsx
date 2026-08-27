// PODGLAD NA ZYWO jako PELNOEKRANOWA NAKLADKA nad studiem.
//
// NAKLADKA, NIE DOK W NAROZNIKU. Poprzednia wersja przypinala podglad do prawego
// dolnego naroznika, wiec strona wydarzenia miescila sie w 460 px i redaktor
// ogladal ja przez dziurke od klucza - a kazde „powieksz” zabieralo miejsce
// formularzowi, ktory wlasnie edytuje. Wzorzec (zrzuty 38-41) pokazuje
// odwrotnosc: podglad zabiera CALY ekran, sidebar i pasek studia znikaja,
// a strona stoi w zaokraglonej ramie na ciemnym tle. Nakladka jest `fixed
// inset-0`, wiec robi to bez dotykania ramy studia.
//
// ADRES SIE NIE ZMIENIA - PODGLAD JEST STANEM. Wlascicielem tego stanu zostaje
// rama studia (`open` / `onOpenChange`), dokladnie jak przy doku: gdyby podglad
// byl osobna trasa, wyjscie z niego przeladowywaloby ekran, a niezapisany szkic
// formularza zostalby po drodze.
//
// SKALA LICZY SIE Z ZMIERZONEJ SZEROKOSCI, nie z zalozonej. Kanwa ma stala
// szerokosc wirtualna (1240 px albo 390 px), a rama nakladki zalezy od okna -
// `transform: scale` z wyliczonym wspolczynnikiem daje ten sam uklad na kazdym
// ekranie, a na szerokim monitorze wspolczynnik dochodzi do 1, czyli strona
// rysuje sie w skali 1:1. Wysokosc wnetrza tez jest mierzona, inaczej pasek
// przewijania konczylby sie w polowie strony.
//
// CIEMNE TLO OTOCZENIA JEST SUROWYM KOLOREM, nie tokenem motywu. Otoczenie ramy
// ma byc NEUTRALNE wobec tego, co rysuje w srodku: `bg-background` w jasnym
// motywie dalby biale tlo pod biala strona, czyli znikniecie krawedzi kartki.
// Sama rama bierze juz token, bo wypelnia ja kanwa - a ta maluje tlo strony
// wydarzenia (nadpisywalne brandingiem).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink, Monitor, Smartphone, XCircle } from "@/lib/lucide-shim";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  EventPreviewCanvas,
  PREVIEW_WIDTHS,
  type PreviewDevice,
} from "@/components/admin/events/studio/EventPreviewCanvas";
import {
  useEventPreviewModel,
  type EventPreviewModel,
} from "@/components/admin/events/studio/EventStudioPreviewContext";
import { useEventPageDocument } from "@/lib/events/useAdminEventPages";
import { useSponsors } from "@/lib/events/useEventSponsors";
import { sponsorTiersFromAdminRows } from "@/lib/events/sponsorsPreview";
import { useViewerCardFacts } from "@/lib/profile/useViewerCard";
import { ensureI18n as ensureAdminEventsI18n } from "@/lib/i18n-admin-events";

export function EventStudioPreview({
  open,
  onOpenChange,
  publicHref,
  eventId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Adres strony publicznej albo `null` dla szkicu - nie ma czego otwierac. */
  publicHref: string | null;
  /**
   * Wydarzenie, ktorego partnerow ma pokazac pas w podgladzie.
   *
   * ZAPYTANIE STOI TUTAJ, NIE W KANWIE - kanwa rysuje szkic i nie odpala
   * zapytan (patrz `viewer`). Zapytanie chodzi TYLKO przy otwartej nakladce,
   * bo zamkniety podglad nie rysuje niczego, a lista partnerow potrafi byc
   * dluga.
   */
  eventId: string;
}) {
  ensureAdminEventsI18n();
  const { t } = useTranslation();
  const base = useEventPreviewModel();
  // NAWIGACJA PODGLADU JEST STANEM NAKLADKI, nie trasa. Redaktor klika zakladke
  // albo kafel dokladnie tak, jak zrobi to uczestnik po publikacji - ale bez
  // opuszczania studia i bez gubienia niezapisanego szkicu formularza.
  // `null` = strona glowna wydarzenia.
  const [navTarget, setNavTarget] = useState<{ key: string; pageId: string } | null>(null);
  const navDocumentQ = useEventPageDocument(navTarget?.pageId ?? null);
  // WIDZ JEST WLASNOSCIA SESJI, NIE SZKICU - dlatego czyta go nakladka, a nie
  // kanwa. Kanwa rysuje szkic formularza i nie ma prawa odpalic zapytania;
  // tutaj jestesmy w drzewie aplikacji, wiec ten sam hook, ktorego uzywa strona
  // publiczna, oddaje te same fakty o zalogowanym redaktorze.
  const viewer = useViewerCardFacts();
  // Tylko przypiecia OGLOSZONE - `published` to ten sam filtr, ktory stosuje
  // publiczne `event_sponsors_public`; podglad nie moze obiecywac partnera,
  // ktorego uczestnik nie zobaczy.
  const sponsorsQ = useSponsors({ eventId, published: "published", limit: 200 }, open);
  const sponsorTiers = useMemo(
    () => sponsorTiersFromAdminRows(sponsorsQ.data),
    [sponsorsQ.data],
  );

  // Wybor z nakladki WYGRYWA z podstrona wskazana w ekranie „Strony i menu":
  // ostatnia decyzja nalezy do tego, kto wlasnie klika. Dopoki dokument leci
  // z bazy, zostaje poprzedni rysunek - migniecie „strona pusta" klamaloby.
  const navItem =
    navTarget === null ? undefined : base.menu.find((item) => item.key === navTarget.key);
  const model: EventPreviewModel =
    navTarget === null || navItem === undefined
      ? base
      : {
          ...base,
          selectedPage: navDocumentQ.isPending
            ? base.selectedPage
            : {
                key: navItem.key,
                label: navItem.label,
                path: navItem.path,
                document: navDocumentQ.data ?? null,
              },
        };
  const [device, setDevice] = useState<PreviewDevice>("desktop");
  const [scale, setScale] = useState(1);
  const [contentHeight, setContentHeight] = useState(0);

  const frameRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);

  const measure = useCallback(() => {
    const frame = frameRef.current;
    const canvas = canvasRef.current;
    if (frame === null) return;
    const available = frame.clientWidth;
    if (available > 0) setScale(Math.min(1, available / PREVIEW_WIDTHS[device]));
    if (canvas !== null) setContentHeight(canvas.scrollHeight);
  }, [device]);

  useEffect(() => {
    if (!open) return;
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => measure());
    if (frameRef.current !== null) observer.observe(frameRef.current);
    if (canvasRef.current !== null) observer.observe(canvasRef.current);
    return () => observer.disconnect();
  }, [open, measure, model]);

  // Nakladka zabiera caly ekran, wiec Escape jest odruchem - bez niego wyjscie
  // wymaga trafienia w jeden przycisk w pasku.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-label={t("adminEvents.studio.preview.title")}
      className="fixed inset-0 z-50 flex flex-col bg-neutral-900"
    >
      {/* Trzy kolumny, a nie `justify-between`: przelacznik urzadzenia stoi
          W OSI EKRANU niezaleznie od dlugosci napisow po bokach. */}
      <div className="grid shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 py-3">
        <span className="truncate text-xs text-white/60">
          {t("adminEvents.studio.preview.draftNotice")}
        </span>

        <div className="flex items-center gap-1 rounded-full border border-white/15 bg-white/5 p-1">
          <DeviceTab
            active={device === "desktop"}
            label={t("adminEvents.studio.preview.desktop")}
            onSelect={() => setDevice("desktop")}
            icon={<Monitor className="h-3.5 w-3.5" aria-hidden="true" />}
          />
          <DeviceTab
            active={device === "mobile"}
            label={t("adminEvents.studio.preview.mobile")}
            onSelect={() => setDevice("mobile")}
            icon={<Smartphone className="h-3.5 w-3.5" aria-hidden="true" />}
          />
        </div>

        <div className="flex items-center justify-end gap-2">
          {publicHref === null ? null : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 gap-2 text-white hover:bg-white/10 hover:text-white"
              asChild
            >
              <a href={publicHref} target="_blank" rel="noreferrer">
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                {t("adminEvents.studio.preview.openPublic")}
              </a>
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 gap-2 text-white hover:bg-white/10 hover:text-white"
            onClick={() => onOpenChange(false)}
          >
            <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
            {t("adminEvents.studio.preview.close")}
          </Button>
        </div>
      </div>

      {/* Zaokraglona rama kartki: strona konczy sie krawedzia, a nie zlewa
          z tlem nakladki. Przewijanie jest WEWNATRZ ramy, zeby pasek studia
          zostal na miejscu. */}
      <div ref={frameRef} className="mx-4 min-h-0 flex-1 overflow-auto rounded-t-2xl bg-background">
        {/* Kartka jest ZAWSZE wysrodkowana. W doku wspolczynnik skali zawsze
            schodzil ponizej 1, wiec kanwa wypelniala szerokosc sama; w nakladce
            na szerokim monitorze skala dobija do 1 i kanwa (1240 px) jest wezsza
            od ramy - bez wysrodkowania strona przyklejalaby sie do lewej
            krawedzi z pustka po prawej. */}
        <div
          style={{
            width: PREVIEW_WIDTHS[device] * scale,
            height: contentHeight * scale,
            margin: "0 auto",
          }}
        >
          <div
            ref={canvasRef}
            style={{
              width: PREVIEW_WIDTHS[device],
              transform: `scale(${scale})`,
              transformOrigin: "top left",
            }}
          >
            <EventPreviewCanvas
              model={model}
              device={device}
              viewer={viewer}
              onNavigate={setNavTarget}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Zakladka urzadzenia. AKTYWNA JEST WYPELNIONA, a nie tylko pogrubiona: na
 * ciemnym pasku sama grubosc pisma nie odpowiada na pytanie „ktory widok
 * ogladam”. Wypelnienie bierze akcent marki - wzorzec ma tu zielen Swapcarda.
 *
 * WYPELNIENIE, A NIE NAPIS W AKCENCIE, i to jest wymuszone paleta. Nakladka
 * jest chromem NIEZALEZNYM OD MOTYWU (`bg-neutral-900` w obu), a tokeny tekstu
 * motyw przelacza: `text-primary` na bialej pastylce dawal prawie czern
 * w jasnym motywie i prawie biel w ciemnym, czyli w ciemnym napis aktywnej
 * zakladki ZNIKAL na bialym tle. `--brand-ink` tu nie pomaga, bo tez sie
 * przelacza (w ciemnym wraca do #fa9346 = 2.2:1 na bieli). Jedyny token stalych
 * wartosci w obu motywach to `--brand`, a jego rola z definicji jest TLEM
 * (`src/lib/__tests__/brandContrast.test.ts` pilnuje, ze jako tekst na jasnym
 * nie przechodzi AA) - stad pomaranczowa pastylka z prawie czarnym napisem,
 * ktora daje ~8:1 niezaleznie od motywu.
 */
function DeviceTab({
  active,
  label,
  icon,
  onSelect,
}: {
  active: boolean;
  label: string;
  icon: React.ReactNode;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onSelect}
      className={cn(
        "inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium transition-colors",
        active ? "bg-brand text-neutral-900" : "text-white/70 hover:text-white",
      )}
    >
      {icon}
      {label}
    </button>
  );
}
