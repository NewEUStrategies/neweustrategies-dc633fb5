// Organizm PREZENTACYJNY: kompaktowa tablica programu - kolumna pomocnicza
// (wyszukiwanie, strefa czasowa, „Twój harmonogram”), zakładki dni, filtr nurtu
// i bloki sesji rozdzielone cienką linią.
//
// PO CO OSOBNY PLIK. Ten rysunek stał wcześniej WYŁĄCZNIE w `EventAgendaSection`,
// czyli w organizmie, który wnosi zapytanie `event_agenda` i mutację zapisu na
// sesję. Podgląd studia nie może użyć tamtego organizmu (RPC ma bramkę
// `status = 'published'`, a żywy przycisk zapisu pozwoliłby organizatorowi
// zapisać się z panelu), więc rysował program PO SWOJEMU - płaska lista dni bez
// zakładek i bez filtrów. Właściciel zobaczył w studiu „stary layout”, mimo że
// nowy był na `main`. Ten plik jest jedynym rysunkiem programu; dane i akcje
// wnoszą wywołujący.
//
// ZERO ZAPYTAŃ I ZERO TOŻSAMOŚCI. Widok nie woła bazy ani `useAuth` - dostaje
// sesje, język i uchwyty zapisu. `signedIn={false}` wygasza przycisk zapisu bez
// dokładania warunku do karty sesji.
//
// ODSŁONIĘCIE SESJI Z ZEWNĄTRZ JEST DEKLARATYWNE. Okno profilu na zakładce
// „Agenda" (klik w sesję osoby albo partnera) i odnośnik z innej zakładki
// (`#event-session-<id>`) nie sięgają do stanu widoku - podają `revealRequest`
// z licznikiem, a widok przechodzi tę samą drogę, co wiersz „Twojego
// harmonogramu": dzień sesji, zdjęte filtry, przewinięcie. Ta sama prośba
// podana drugi raz (ten sam licznik) niczego nie powtarza.
import { useDeferredValue, useEffect, useId, useMemo, useState, type KeyboardEvent } from "react";
import { CalendarDays, ChevronRight, Globe, Search } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { UiLang } from "@/lib/i18n/format";
import { pickLocalized } from "@/lib/i18n/pickLocalized";
import {
  eventDayKey,
  eventTimeZone,
  formatEventDate,
  formatEventDateTime,
  isForeignTimeZone,
} from "@/lib/events/timezone";
import { useViewerTimeZone } from "@/lib/events/useViewerTimeZone";
import { preferredScrollBehavior } from "@/lib/a11y/reducedMotion";
import {
  agendaSessionAnchor,
  agendaSessionTitle,
  agendaSpeakerTracks,
  agendaTrackOptions,
  filterAgenda,
  groupAgendaByDay,
  hasOwnAgenda,
  ownAgenda,
  type AgendaSession,
} from "@/lib/events/agendaSurface";
import { AgendaSessionCard } from "@/components/events/public/molecules/AgendaSessionCard";
import { DIRECTORY_RETURN_FOCUS_ATTR } from "@/components/events/public/directory/EventDirectoryContext";
import { ensureI18n as ensureEventFrontI18n } from "@/lib/i18n-event-front";

// Podgląd studia montuje ten widok BEZ `EventAgendaSection`, więc słownik
// frontu wydarzenia musi zarejestrować import tego pliku, a nie przypadek
// wspólnego chunka.
ensureEventFrontI18n();

/**
 * Ile terminów pokazuje karta „Twój harmonogram” przed rozwinięciem.
 *
 * Kolumna stoi obok programu i ma być rzutem oka na najbliższe godziny, a nie
 * drugą kopią agendy - dlatego długa lista chowa się za odnośnikiem, zamiast
 * spychać program pod ekran.
 */
const SCHEDULE_PREVIEW = 3;

/** Uchwyt bez akcji - stały, żeby `memo` karty sesji nie przegrywał z nową strzałką. */
const NOOP = () => {};

/** Prośba o odsłonięcie sesji; nowy `nonce` = nowa prośba (także o tę samą sesję). */
export interface AgendaRevealRequest {
  sessionId: string;
  nonce: number;
}

export interface EventAgendaBoardViewProps {
  sessions: readonly AgendaSession[];
  lang: UiLang;
  /** `false` wygasza przyciski zapisu - tak działa podgląd studia. */
  signedIn: boolean;
  /** Identyfikator sesji, której zapis jest w locie, albo `null`. */
  pendingId?: string | null;
  /**
   * Uchwyty zapisu - dla `memo` karty MUSZĄ być stabilne (`useCallback`
   * u wołającego); widok podaje je karcie bez owijania w nową strzałkę.
   */
  onSignup?: (session: AgendaSession) => void;
  onCancel?: (session: AgendaSession) => void;
  /** Odsłoń sesję z zewnątrz (okno profilu, odnośnik z kotwicą) - patrz nagłówek. */
  revealRequest?: AgendaRevealRequest | null;
}

/** Odsłonięcie w toku: którą sesję przewinąć i czy przenieść na nią fokus. */
interface PendingReveal {
  id: string;
  focus: boolean;
}

export function EventAgendaBoardView({
  sessions,
  lang,
  signedIn,
  pendingId = null,
  onSignup,
  onCancel,
  revealRequest = null,
}: EventAgendaBoardViewProps) {
  const { t } = useTranslation();
  const [dayKey, setDayKey] = useState<string | null>(null);
  const [trackId, setTrackId] = useState<string | null>(null);
  const [onlyMine, setOnlyMine] = useState(false);
  const [query, setQuery] = useState("");
  const [scheduleOpen, setScheduleOpen] = useState(false);
  // Nowy obiekt na każde odsłonięcie, więc efekt przewinięcia biegnie raz na
  // prośbę i nie musi się sam zerować (dawne `setFocusId(null)` w efekcie
  // kosztowało dodatkowy render całej tablicy).
  const [reveal, setReveal] = useState<PendingReveal | null>(null);
  // Prośba zastana przy montażu jest już obsłużona: tablica montuje się na
  // nowo po przełączeniu modułu w podglądzie studia albo po nieudanym
  // odświeżeniu programu, a prawdziwe prośby (okno profilu, kotwica z efektu
  // rodzica) przychodzą zawsze do tablicy już zamontowanej.
  const [handledNonce, setHandledNonce] = useState<number | null>(
    () => revealRequest?.nonce ?? null,
  );
  // `null` w SSR i przy hydratacji - patrz `useViewerTimeZone`.
  const viewerZone = useViewerTimeZone();
  // Identyfikatory zakładek i panelu dnia z `useId` - te same na serwerze
  // i w kliencie, więc `aria-controls` nie rozjeżdża hydratacji.
  const tabsId = useId();
  const panelId = `${tabsId}panel`;

  // FRAZA FILTRUJE Z OPÓŹNIENIEM, POLE - OD RAZU. Każda litera przepuszczała
  // wcześniej cały dzień przez `matchesAgendaQuery` (składanie znaków
  // diakrytycznych w obu językach) i przerysowywała każdy blok; z odroczoną
  // wartością pole odpowiada natychmiast, a lista dogania je w tle.
  // WYCZYSZCZENIE frazy jest natychmiastowe: pusta fraza nie kosztuje nic,
  // a odsłonięcie sesji (które frazę zdejmuje) musi zastać blok w DOM już
  // w pierwszym renderze, inaczej nie byłoby czego przewinąć.
  const deferredQuery = useDeferredValue(query);
  const searchQuery = query.trim() === "" ? "" : deferredQuery;

  const days = useMemo(() => groupAgendaByDay(sessions), [sessions]);
  const tracks = useMemo(() => agendaTrackOptions(sessions), [sessions]);
  // Ścieżki prelegentów liczone z CAŁEGO programu, nie z przefiltrowanego dnia:
  // filtr ścieżki albo dnia nie może zmieniać tego, w czym osoba występuje.
  const speakerTracks = useMemo(() => agendaSpeakerTracks(sessions), [sessions]);
  const mineAvailable = useMemo(() => hasOwnAgenda(sessions), [sessions]);
  const mySessions = useMemo(() => ownAgenda(sessions), [sessions]);

  // Wybrany dzień musi ISTNIEĆ w danych - po odświeżeniu programu dzień
  // z pamięci komponentu bywa już nieaktualny, a wtedy widok byłby pusty
  // bez żadnego powodu widocznego dla uczestnika.
  const activeDayKey =
    dayKey !== null && days.some((day) => day.key === dayKey) ? dayKey : (days[0]?.key ?? null);
  const activeDayIndex = Math.max(
    0,
    days.findIndex((day) => day.key === activeDayKey),
  );
  const activeDay = days[activeDayIndex] ?? null;

  // Wybór dnia, który JUŻ jest aktywny, niczego nie zapisuje: zapis zmieniłby
  // tylko `dayKey` z `null` na ten sam dzień, a to włącza przenikanie listy
  // (niżej) bez żadnej zmiany treści.
  const selectDay = (key: string) => {
    if (key !== activeDayKey) setDayKey(key);
  };

  const visible = useMemo(
    () =>
      activeDay === null
        ? []
        : filterAgenda(activeDay.sessions, { trackId, onlyMine, query: searchQuery }),
    [activeDay, trackId, onlyMine, searchQuery],
  );

  // Przewijamy DOPIERO po przemalowaniu listy: blok sesji z innego dnia
  // pojawia się w DOM w tym samym renderze, w którym zmienia się zakładka,
  // więc szukanie go w obsłudze kliknięcia trafiałoby w poprzedni dzień.
  // Płynnie tylko wtedy, gdy system nie prosi o ograniczenie ruchu.
  useEffect(() => {
    if (reveal === null) return;
    const node = document.getElementById(agendaSessionAnchor(reveal.id));
    if (node === null) return;
    if (typeof node.scrollIntoView === "function") {
      node.scrollIntoView({ block: "start", behavior: preferredScrollBehavior() });
    }
    // Fokus na tytuł bloku (tylko gdy prośba przyszła z okna albo z odnośnika):
    // czytnik ogłasza sesję, a Tab idzie dalej od niej, nie od początku strony.
    if (reveal.focus) {
      const heading = node.querySelector<HTMLElement>("h3[tabindex]");
      // Okno profilu, z którego przyszła prośba, jeszcze się zamyka i trzyma
      // stronę pod `aria-hidden` - fokus przeniesie ono samo po odmontowaniu.
      if (document.querySelector("[data-event-directory-dialog]") !== null) {
        // Jeden znacznik naraz - starszy (okno otwarte ponownie w trakcie
        // animacji zamknięcia) nie może przejąć fokusu później.
        for (const marked of document.querySelectorAll(`[${DIRECTORY_RETURN_FOCUS_ATTR}]`)) {
          marked.removeAttribute(DIRECTORY_RETURN_FOCUS_ATTR);
        }
        heading?.setAttribute(DIRECTORY_RETURN_FOCUS_ATTR, "");
      } else {
        heading?.focus({ preventScroll: true });
      }
    }
  }, [reveal]);

  // Wiersz harmonogramu musi ODSŁONIĆ swoją sesję, a nie tylko przełączyć
  // zakładkę: fraza w wyszukiwaniu albo wybrany nurt mogłyby ją odfiltrować,
  // a uczestnik zobaczyłby wtedy skutek kliknięcia jako pustą listę.
  const revealSession = (session: AgendaSession, focus: boolean) => {
    selectDay(eventDayKey(session.startsAt, session.timezone));
    setQuery("");
    setTrackId(null);
    setOnlyMine(false);
    setReveal({ id: session.id, focus });
  };

  // Prośba z zewnątrz obsłużona W RENDERZE (wzorzec „stan z poprzedniego
  // renderu"), nie w efekcie: React przelicza widok od razu, zanim cokolwiek
  // trafi na ekran, więc nie ma klatki ze starym dniem ani drugiego commitu.
  if (revealRequest !== null && revealRequest.nonce !== handledNonce) {
    setHandledNonce(revealRequest.nonce);
    const target = sessions.find((session) => session.id === revealRequest.sessionId);
    if (target !== undefined) revealSession(target, true);
  }

  // Klawiatura zakładek dni według wzorca WAI-ARIA „Tabs" z aktywacją
  // automatyczną: strzałki przenoszą wybór i fokus (z zawinięciem), Home/End
  // skaczą na skraj. Tab wchodzi tylko do zakładki aktywnej (`tabIndex`
  // ruchomy), więc pięć dni to jeden przystanek, a nie pięć.
  const onDayTabsKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const last = days.length - 1;
    const next =
      event.key === "ArrowRight"
        ? activeDayIndex >= last
          ? 0
          : activeDayIndex + 1
        : event.key === "ArrowLeft"
          ? activeDayIndex <= 0
            ? last
            : activeDayIndex - 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : null;
    if (next === null) return;
    event.preventDefault();
    selectDay(days[next].key);
    event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
  };

  if (sessions.length === 0) return null;

  // Strefę podpisu bierzemy z PIERWSZEJ sesji: `event_sessions.timezone`
  // dziedziczy strefę wydarzenia, więc jest ta sama w całym programie, a gdyby
  // kiedyś nie była, podpis nadal opisuje dzień, od którego program się zaczyna.
  const eventZone = eventTimeZone({ timezone: sessions[0].timezone });
  const foreignZone = isForeignTimeZone(sessions[0].timezone, viewerZone);
  const scheduleShown = scheduleOpen ? mySessions : mySessions.slice(0, SCHEDULE_PREVIEW);

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] xl:gap-12">
      {/* Kolumna filtrów jedzie pod przyklejonym paskiem zakładek
          (`--event-chrome-h`, styles.css); poza powłoką wydarzenia - dawne 6rem. */}
      <aside
        aria-label={t("eventFront.agenda.sidebarLabel")}
        className="space-y-5 lg:sticky lg:top-[calc(var(--event-chrome-h,4.5rem)+1.5rem)] lg:self-start"
      >
        <div className="border-b border-border pb-5">
          <label className="relative block">
            <span className="sr-only">{t("eventFront.agenda.search")}</span>
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("eventFront.agenda.search")}
              className="pl-8"
            />
          </label>
        </div>

        <p className="flex items-start gap-2 border-b border-border pb-5 text-xs text-muted-foreground">
          <Globe className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            {t("eventFront.agenda.timezoneRow", { zone: eventZone })}
            {foreignZone && <span className="block">{t("eventFront.agenda.timezoneForeign")}</span>}
          </span>
        </p>

        {mySessions.length > 0 && (
          // Bez górnej linii: wiersz strefy czasowej nad nią już się nią kończy,
          // a dwie linie 20 px od siebie czytały się jak pomyłka składu.
          <section aria-labelledby="event-agenda-schedule-title">
            <h3
              id="event-agenda-schedule-title"
              className="border-b border-border py-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
            >
              {t("eventFront.agenda.myScheduleTitle")}
            </h3>
            <ul className="divide-y divide-border">
              {scheduleShown.map((session) => (
                <li key={session.id}>
                  <button
                    type="button"
                    onClick={() => revealSession(session, false)}
                    className="flex w-full items-center gap-2 py-3 text-left transition-colors hover:text-primary"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold leading-tight text-foreground">
                        {agendaSessionTitle(session, lang)}
                      </span>
                      <span className="mt-0.5 block text-xs leading-tight text-muted-foreground">
                        {formatEventDateTime(session.startsAt, session.timezone, lang, {
                          weekday: "short",
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </span>
                    <ChevronRight
                      className="h-4 w-4 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                  </button>
                </li>
              ))}
            </ul>
            {!scheduleOpen && mySessions.length > SCHEDULE_PREVIEW && (
              <div className="border-t border-border py-3">
                <button
                  type="button"
                  onClick={() => setScheduleOpen(true)}
                  className="text-xs font-medium text-primary underline-offset-4 hover:underline"
                >
                  {t("eventFront.agenda.myScheduleShowAll")}
                </button>
              </div>
            )}
          </section>
        )}
      </aside>

      <div className="min-w-0 space-y-6">
        {days.length > 1 && (
          <div
            role="tablist"
            aria-label={t("eventFront.header.tabs.agenda")}
            onKeyDown={onDayTabsKeyDown}
            className="grid border-b border-border sm:grid-cols-2 lg:grid-flow-col lg:auto-cols-fr"
          >
            {days.map((day, index) => {
              const active = day.key === activeDayKey;
              return (
                <button
                  key={day.key}
                  id={`${tabsId}tab-${index}`}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  aria-controls={panelId}
                  tabIndex={active ? 0 : -1}
                  onClick={() => selectDay(day.key)}
                  className={cn(
                    "relative inline-flex min-h-16 items-center justify-center gap-2 border-b-2 px-4 py-3 text-sm transition-colors",
                    active
                      ? "border-primary font-semibold text-foreground"
                      : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
                  )}
                >
                  <CalendarDays className="h-4 w-4" aria-hidden="true" />
                  <span>{t("eventFront.agenda.dayLabel", { index: index + 1 })}</span>
                  <span className="hidden text-xs text-muted-foreground sm:inline">
                    {formatEventDate(day.startsAt, day.timezone, lang)}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* Panel dnia: filtr i lista sesji, opisany zakładką wybranego dnia. */}
        <div
          id={days.length > 1 ? panelId : undefined}
          role={days.length > 1 ? "tabpanel" : undefined}
          aria-labelledby={days.length > 1 ? `${tabsId}tab-${activeDayIndex}` : undefined}
          className="space-y-6"
        >
          {(tracks.length > 1 || mineAvailable) && (
            <div className="flex flex-wrap items-center gap-3 border-b border-border pb-4">
              {tracks.length > 1 && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    {t("eventFront.agenda.trackLabel")}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant={trackId === null ? "secondary" : "ghost"}
                    aria-pressed={trackId === null}
                    onClick={() => setTrackId(null)}
                  >
                    {t("eventFront.agenda.allTracks")}
                  </Button>
                  {tracks.map((track) => (
                    <Button
                      key={track.id}
                      type="button"
                      size="sm"
                      variant={trackId === track.id ? "secondary" : "ghost"}
                      aria-pressed={trackId === track.id}
                      onClick={() => setTrackId(track.id)}
                    >
                      {pickLocalized(
                        { name_pl: track.namePl, name_en: track.nameEn },
                        "name",
                        lang,
                      )}
                      {/* Liczba sesji jako cicha cyfra o stałej szerokości, nie
                          plakietka: przy kilku nurtach ramki w ramkach
                          przycisków czytały się jak druga warstwa przycisków. */}
                      <span className="ml-1.5 tabular-nums text-muted-foreground">
                        {track.count}
                      </span>
                    </Button>
                  ))}
                </div>
              )}

              {mineAvailable && (
                <label className="ml-auto inline-flex cursor-pointer items-center gap-2 text-sm text-foreground">
                  <Switch checked={onlyMine} onCheckedChange={setOnlyMine} />
                  {t("eventFront.agenda.onlyMine")}
                </label>
              )}
            </div>
          )}

          {visible.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {searchQuery.trim() !== ""
                ? t("eventFront.agenda.emptyQuery")
                : onlyMine
                  ? t("eventFront.agenda.emptyMine")
                  : t("eventFront.agenda.emptyFiltered")}
            </p>
          ) : (
            // Zmiana dnia wymienia całą listę - nowy dzień wchodzi krótkim
            // przenikaniem. Dopiero po WYBORZE dnia (`dayKey`): pierwszy rysunek
            // strony stoi bez animacji (Speed Index, `motionGate.ts`).
            <div
              key={activeDayKey}
              className={cn(
                "divide-y divide-border border-y border-border",
                dayKey !== null && "motion-safe:animate-in motion-safe:fade-in-0 duration-300",
              )}
            >
              {visible.map((session) => (
                <AgendaSessionCard
                  key={session.id}
                  session={session}
                  signedIn={signedIn}
                  pending={pendingId === session.id}
                  onSignup={onSignup ?? NOOP}
                  onCancel={onCancel ?? NOOP}
                  speakerTracks={speakerTracks}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
