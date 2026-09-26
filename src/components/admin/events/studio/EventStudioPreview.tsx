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
import { useNavigate } from "@tanstack/react-router";
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
import { useSponsorTiers, useSponsors } from "@/lib/events/useEventSponsors";
import { previewSponsorsStatus, sponsorTiersFromAdminRows } from "@/lib/events/sponsorsPreview";
import { adminSponsorLoadErrorMessage } from "@/lib/events/adminSponsorErrors";
import { useViewerCardFacts } from "@/lib/profile/useViewerCard";
import { ensureI18n as ensureAdminEventsI18n } from "@/lib/i18n-admin-events";
import type { BuilderDocument } from "@/lib/builder/types";
import { useEventSessions, useEventTracks } from "@/lib/events/useEventSessions";
import { DEFAULT_SESSIONS_QUERY } from "@/lib/events/sessionsApi";
import { DEFAULT_REGISTRATIONS_QUERY } from "@/lib/events/registrationsApi";
import { useRegistrationsList } from "@/lib/events/useEventRegistrations";
import { useQuery } from "@tanstack/react-query";
import { fetchEventSpeakers } from "@/lib/admin/community";
import {
  agendaSessionsFromAdminRows,
  publishedSponsorIdSet,
  attendeeEntriesFromRegistrationRows,
  speakerRowsFromAdminEntries,
  trackChipsFromAdminRows,
} from "@/lib/events/previewLiveData";
import type { EventPreviewLiveData } from "@/components/admin/events/studio/EventPreviewLiveModule";

/** Cel nawigacji podgladu z wlasna kopia etykiety i sciezki (patrz nizej). */
type PreviewNavTarget = {
  key: string;
  pageId: string;
  label: string;
  path: string;
  /** Znacznik pozycji modulowej - decyduje, czy podstrona dostaje zywe dane. */
  module: string | null;
};

/** Górna granica listy przypięć w podglądzie (zaciskana w RPC do 1..200). */
const PREVIEW_SPONSORS_LIMIT = 200;

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
   * Wydarzenie, ktorego partnerow, program, prelegentow i uczestnikow ma
   * pokazac podglad.
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
  const [navTarget, setNavTarget] = useState<PreviewNavTarget | null>(null);
  const navDocumentQ = useEventPageDocument(navTarget?.pageId ?? null);
  // WYBRANA PODSTRONA NIE MOZE ZNIKAC PRZY ODSWIEZENIU DANYCH. Menu i dokument
  // przychodza z zapytan - kazde ponowne pobranie (powrot do okna, uniewaznienie
  // po zapisie, wyczyszczenie cache) na moment oddaje puste menu albo stan
  // `pending`. Gdyby podglad czytal wtedy tylko `base.menu`, pozycja znikalaby
  // z listy i widok wracalby na strone glowna „sam z siebie”. Dlatego cel
  // nawigacji nosi WLASNA kopie etykiety i sciezki, a ostatni pobrany dokument
  // zostaje w ref jako rysunek awaryjny.
  const lastDocumentRef = useRef<BuilderDocument | null>(null);
  if (navTarget === null) lastDocumentRef.current = null;
  else if (!navDocumentQ.isPending && navDocumentQ.data !== undefined)
    lastDocumentRef.current = navDocumentQ.data;

  const handleNavigate = useCallback(
    (target: { key: string; pageId: string } | null) => {
      if (target === null) {
        setNavTarget(null);
        return;
      }
      const item = base.menu.find((entry) => entry.key === target.key);
      setNavTarget({
        key: target.key,
        pageId: target.pageId,
        label: item?.label ?? "",
        path: item?.path ?? "",
        module: item?.module ?? null,
      });
    },
    [base.menu],
  );

  // „WRÓĆ DO LISTY WYDARZEŃ": na stronie publicznej to link do /events, w
  // podglądzie zamykamy nakładkę i wracamy do listy w panelu - niezapisany
  // szkic studia ginie tak samo jak przy przycisku „Zamknij podgląd".
  const navigate = useNavigate();
  const handleBack = useCallback(() => {
    onOpenChange(false);
    void navigate({ to: "/admin/events" });
  }, [navigate, onOpenChange]);

  // WIDZ JEST WLASNOSCIA SESJI, NIE SZKICU - dlatego czyta go nakladka, a nie
  // kanwa.
  const viewer = useViewerCardFacts();
  // WSZYSTKIE PRZYPIECIA, TAKZE NIEOGLOSZONE. Tablica „Sponsorzy i reklama"
  // zapisuje nowe logo jako nieogloszone, a podglad z filtrem „published"
  // pokazywal wtedy pustke w miejscu logotypow, ktore organizator widzial na
  // tablicy - bez slowa, dlaczego. Pas i sekcja „Partnerzy" rysuja je wiec
  // PRZYGASZONE, z plakietka „Nieogloszony" - tak jak szkice sesji i sciezek
  // w programie podgladu. Program i sciezki biora sponsora dalej TYLKO
  // z przypiecia ogloszonego (`publishedSponsorIdSet` nizej).
  const sponsorsQ = useSponsors({ eventId, limit: PREVIEW_SPONSORS_LIMIT }, open);
  // Opis, korzysci i `sort_order` poziomu - lista przypiec ich nie niesie,
  // a sekcja „Partnerzy" je rysuje. Ten sam klucz cache, co ekran poziomow.
  const sponsorTiersQ = useSponsorTiers(eventId, open);
  const sponsorTiers = useMemo(
    () =>
      sponsorTiersFromAdminRows(sponsorsQ.data, {
        tiers: sponsorTiersQ.data,
        includeDrafts: true,
      }),
    [sponsorsQ.data, sponsorTiersQ.data],
  );
  // PUSTA LISTA TO JESZCZE NIE „BRAK PARTNEROW". Zakladka „Partnerzy" otwiera
  // sie zanim lista dojedzie, a RPC potrafi pasc - bez statusu podglad mowil
  // w obu chwilach „dodaj ich na tablicy", takze wydarzeniu z partnerami.
  // Odmowe mowi mapa odmow sponsorow, ale nieznana (zerwana siec) dostaje
  // zdanie o ODCZYCIE, a nie „nie udalo sie zapisac zmian".
  const sponsorsStatus = useMemo(
    () =>
      previewSponsorsStatus(
        {
          isPending: sponsorsQ.isPending,
          isError: sponsorsQ.isError,
          error: sponsorsQ.error,
          fetchStatus: sponsorsQ.fetchStatus,
        },
        (error) =>
          adminSponsorLoadErrorMessage(error, t("adminEvents.studio.preview.sponsorsLoadFailed")),
      ),
    [sponsorsQ.isPending, sponsorsQ.isError, sponsorsQ.error, sponsorsQ.fetchStatus, t],
  );

  // ZYWE DANE PODSTRON MODULOWYCH. Projekcje publiczne (`event_agenda`,
  // `get_public_speakers`, `event_attendees`) maja bramke `published` albo
  // wymagaja zapisu wolajacego, wiec na szkicu oddawaly pustke. Panel czyta te
  // same wiersze RPC administracyjnymi, a `previewLiveData` sprowadza je do
  // ksztaltu powierzchni publicznej - rysunek zostaje produkcyjny.
  const liveEnabled = open && eventId !== "";
  const sessionsQ = useEventSessions(liveEnabled ? { ...DEFAULT_SESSIONS_QUERY, eventId } : null);
  const speakersQ = useQuery({
    queryKey: ["admin", "event", eventId, "speakers", "preview"],
    queryFn: () => fetchEventSpeakers(eventId),
    enabled: liveEnabled,
    staleTime: 60_000,
  });
  const tracksQ = useEventTracks(liveEnabled ? eventId : null);
  const registrationsQ = useRegistrationsList(
    liveEnabled
      ? { ...DEFAULT_REGISTRATIONS_QUERY, eventId, status: "all", limit: 60, offset: 0 }
      : null,
  );
  // Program i pasma pokazuja sponsora TYLKO z ogloszonego przypiecia - ta sama
  // bramka `is_published`, ktora stosuje publiczne `event_agenda`. Lista jest
  // juz pobrana wyzej (`sponsorsQ`, ze WSZYSTKIMI przypieciami), wiec to nie
  // jest drugie zapytanie - nieogloszone odsiewa sam zbior.
  const publishedSponsorIds = useMemo(
    () => publishedSponsorIdSet(sponsorsQ.data, PREVIEW_SPONSORS_LIMIT),
    [sponsorsQ.data],
  );
  const live: EventPreviewLiveData = useMemo(
    () => ({
      sessions: agendaSessionsFromAdminRows(sessionsQ.data, base.timezone, {
        tracks: tracksQ.data,
        publishedSponsorIds,
        // Obsada sesji z rejestru prelegentow - tego samego zapytania, ktore
        // karmi siatke prelegentow; lista sesji panelu oddaje tylko liczbe.
        speakers: speakersQ.data,
      }),
      tracks: trackChipsFromAdminRows(tracksQ.data, publishedSponsorIds),
      speakers: speakerRowsFromAdminEntries(speakersQ.data, sessionsQ.data),
      attendees: attendeeEntriesFromRegistrationRows(registrationsQ.data?.rows),
      sponsorTiers,
      sponsorsStatus,
    }),
    [
      sessionsQ.data,
      tracksQ.data,
      speakersQ.data,
      registrationsQ.data,
      base.timezone,
      publishedSponsorIds,
      sponsorTiers,
      sponsorsStatus,
    ],
  );

  // Wybor z nakladki WYGRYWA z podstrona wskazana w ekranie „Strony i menu":
  // ostatnia decyzja nalezy do tego, kto wlasnie klika. Dopoki dokument leci
  // z bazy, zostaje poprzedni rysunek - migniecie „strona pusta" klamaloby.
  const navItem =
    navTarget === null
      ? undefined
      : (base.menu.find((item) => item.key === navTarget.key) ?? navTarget);
  const model: EventPreviewModel =
    navTarget === null || navItem === undefined
      ? base
      : {
          ...base,
          selectedPage: {
            key: navItem.key,
            label: navItem.label,
            path: navItem.path,
            module: navItem.module,
            document:
              navDocumentQ.isPending || navDocumentQ.data === undefined
                ? lastDocumentRef.current
                : navDocumentQ.data,
          },
        };

  const [device, setDevice] = useState<PreviewDevice>("desktop");
  const [scale, setScale] = useState(1);
  const [contentHeight, setContentHeight] = useState(0);

  const frameRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);

  // RAMA I KANWA SA ALBO OBIE, ALBO ZADNA. Montuje je ten sam commit, wiec
  // jedyna chwila bez nich to spozniony ResizeObserver po zamknieciu nakladki -
  // wtedy nie ma czego mierzyc. Jeden warunek zamiast osobnego dla kazdej
  // z nich: osobne obiecywaly stan „rama bez kanwy", ktorego React nie wytwarza.
  const measure = useCallback(() => {
    const frame = frameRef.current;
    const canvas = canvasRef.current;
    if (frame === null || canvas === null) return;
    const available = frame.clientWidth;
    if (available > 0) setScale(Math.min(1, available / PREVIEW_WIDTHS[device]));
    setContentHeight(canvas.scrollHeight);
  }, [device]);

  useEffect(() => {
    if (!open) return;
    measure();
    const frame = frameRef.current;
    const canvas = canvasRef.current;
    if (typeof ResizeObserver === "undefined" || frame === null || canvas === null) return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(frame);
    observer.observe(canvas);
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
              onNavigate={handleNavigate}
              onBack={handleBack}
              live={live}
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
