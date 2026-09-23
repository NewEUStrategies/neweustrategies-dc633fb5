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
import { useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronRight, Globe, Search } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
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
import {
  agendaSessionAnchor,
  agendaSessionTitle,
  agendaTrackOptions,
  filterAgenda,
  groupAgendaByDay,
  hasOwnAgenda,
  ownAgenda,
  type AgendaSession,
} from "@/lib/events/agendaSurface";
import { AgendaSessionCard } from "@/components/events/public/molecules/AgendaSessionCard";
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

export interface EventAgendaBoardViewProps {
  sessions: readonly AgendaSession[];
  lang: UiLang;
  /** `false` wygasza przyciski zapisu - tak działa podgląd studia. */
  signedIn: boolean;
  /** Identyfikator sesji, której zapis jest w locie, albo `null`. */
  pendingId?: string | null;
  onSignup?: (session: AgendaSession) => void;
  onCancel?: (session: AgendaSession) => void;
}

export function EventAgendaBoardView({
  sessions,
  lang,
  signedIn,
  pendingId = null,
  onSignup,
  onCancel,
}: EventAgendaBoardViewProps) {
  const { t } = useTranslation();
  const [dayKey, setDayKey] = useState<string | null>(null);
  const [trackId, setTrackId] = useState<string | null>(null);
  const [onlyMine, setOnlyMine] = useState(false);
  const [query, setQuery] = useState("");
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);
  // `null` w SSR i przy hydratacji - patrz `useViewerTimeZone`.
  const viewerZone = useViewerTimeZone();

  const days = useMemo(() => groupAgendaByDay(sessions), [sessions]);
  const tracks = useMemo(() => agendaTrackOptions(sessions), [sessions]);
  const mineAvailable = useMemo(() => hasOwnAgenda(sessions), [sessions]);
  const mySessions = useMemo(() => ownAgenda(sessions), [sessions]);

  // Wybrany dzień musi ISTNIEĆ w danych - po odświeżeniu programu dzień
  // z pamięci komponentu bywa już nieaktualny, a wtedy widok byłby pusty
  // bez żadnego powodu widocznego dla uczestnika.
  const activeDayKey =
    dayKey !== null && days.some((day) => day.key === dayKey) ? dayKey : (days[0]?.key ?? null);
  const activeDay = days.find((day) => day.key === activeDayKey) ?? null;

  const visible = useMemo(
    () =>
      activeDay === null ? [] : filterAgenda(activeDay.sessions, { trackId, onlyMine, query }),
    [activeDay, trackId, onlyMine, query],
  );

  // Przewijamy DOPIERO po przemalowaniu listy: blok sesji z innego dnia
  // pojawia się w DOM w tym samym renderze, w którym zmienia się zakładka,
  // więc szukanie go w obsłudze kliknięcia trafiałoby w poprzedni dzień.
  useEffect(() => {
    if (focusId === null) return;
    setFocusId(null);
    const node = document.getElementById(agendaSessionAnchor(focusId));
    if (node !== null && typeof node.scrollIntoView === "function") {
      node.scrollIntoView({ block: "start" });
    }
  }, [focusId, visible]);

  // Wiersz harmonogramu musi ODSŁONIĆ swoją sesję, a nie tylko przełączyć
  // zakładkę: fraza w wyszukiwaniu albo wybrany nurt mogłyby ją odfiltrować,
  // a uczestnik zobaczyłby wtedy skutek kliknięcia jako pustą listę.
  const revealSession = (session: AgendaSession) => {
    setDayKey(eventDayKey(session.startsAt, session.timezone));
    setQuery("");
    setTrackId(null);
    setOnlyMine(false);
    setFocusId(session.id);
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
      <aside
        aria-label={t("eventFront.agenda.sidebarLabel")}
        className="space-y-5 lg:sticky lg:top-24 lg:self-start"
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
          <section aria-labelledby="event-agenda-schedule-title" className="border-t border-border">
            <h3
              id="event-agenda-schedule-title"
              className="border-b border-border py-3 text-xs font-semibold uppercase text-muted-foreground"
            >
              {t("eventFront.agenda.myScheduleTitle")}
            </h3>
            <ul className="divide-y divide-border">
              {scheduleShown.map((session) => (
                <li key={session.id}>
                  <button
                    type="button"
                    onClick={() => revealSession(session)}
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
            className="grid border-b border-border sm:grid-cols-2 lg:grid-flow-col lg:auto-cols-fr"
          >
            {days.map((day, index) => {
              const active = day.key === activeDayKey;
              return (
                <button
                  key={day.key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setDayKey(day.key)}
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

        {(tracks.length > 1 || mineAvailable) && (
          <div className="flex flex-wrap items-center gap-3 border-b border-border pb-4">
            {tracks.length > 1 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold uppercase text-muted-foreground">
                  {t("eventFront.agenda.trackLabel")}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant={trackId === null ? "secondary" : "ghost"}
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
                    onClick={() => setTrackId(track.id)}
                  >
                    {pickLocalized({ name_pl: track.namePl, name_en: track.nameEn }, "name", lang)}
                    <Badge variant="outline" className="ml-2">
                      {track.count}
                    </Badge>
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
            {query.trim() !== ""
              ? t("eventFront.agenda.emptyQuery")
              : onlyMine
                ? t("eventFront.agenda.emptyMine")
                : t("eventFront.agenda.emptyFiltered")}
          </p>
        ) : (
          <div className="divide-y divide-border border-y border-border">
            {visible.map((session) => (
              <AgendaSessionCard
                key={session.id}
                session={session}
                signedIn={signedIn}
                pending={pendingId === session.id}
                onSignup={(item) => onSignup?.(item)}
                onCancel={(item) => onCancel?.(item)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
