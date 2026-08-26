// Organizm: PUBLICZNY program wydarzenia z zapisami na sesje, w układzie ekranu
// wzorcowego - węższa kolumna po lewej (wyszukiwanie, strefa czasowa, „Twój
// harmonogram”) i kolumna główna z blokami sesji rozdzielonymi cienką linią.
//
// LEWA KOLUMNA NIE PYTA BAZY O NIC NOWEGO. Wyszukiwanie filtruje wiersze, które
// już przyszły, a „Twój harmonogram” bierze się z `my_signup_status` liczonego
// przez `event_agenda` dla wołającego - to samo zapytanie, ten sam cache. Osobne
// zapytanie o „moje sesje” dałoby drugą odpowiedź na to samo pytanie i dwie
// listy rozjeżdżające się po każdym zapisie.
//
// DZIEŃ JEST ZAKŁADKĄ, NIE NAGŁÓWKIEM. Kongres dwudniowy ma kilkadziesiąt
// sesji; jedna długa lista każe przewijać przez wczoraj, żeby zobaczyć dziś.
// Zakładka dnia trzyma klucz `YYYY-MM-DD` w STREFIE WYDARZENIA, więc wybór
// uczestnika przeżywa przełączenie języka.
//
// HARMONOGRAM CELUJE W BLOK, A NIE OTWIERA DRUGIEGO WIDOKU. Kliknięty wiersz
// przełącza zakładkę na dzień tej sesji, zdejmuje filtry, które mogłyby ją
// ukryć, i przewija do jej bloku. Odnośnik prowadzący do osobnej strony „moje
// sesje” byłby drugą powierzchnią renderującą te same dane - dług, który ten
// projekt już raz zapłacił.
//
// FILTR NURTU I „TYLKO MOJE" TO DWA RÓŻNE PYTANIA. Pierwsze zadaje ktoś, kto
// wybiera ścieżkę tematyczną, drugie ktoś, kto stoi na korytarzu i pyta „gdzie
// mam teraz być". Dlatego filtr własnych sesji pojawia się dopiero wtedy, gdy
// uczestnik cokolwiek ma - inaczej byłby przełącznikiem do pustej listy.
//
// ZAPIS JEST OPTYMISTYCZNY TYLKO W PRZYCISKU. Liczby miejsc przychodzą z bazy
// po unieważnieniu zapytania - zgadywanie ich lokalnie dałoby „zostało 0 miejsc"
// obok przycisku, który jeszcze działa.
//
// PUSTY PROGRAM NIE RYSUJE OBUDOWY. Bez ani jednej sesji nie ma czego szukać
// ani co filtrować, więc nie ma też lewej kolumny, ramki i zakładek - zostaje
// jedno zdanie pod nagłówkiem, który należy do `EventPageSections`.
import { useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronRight, Globe, Loader2, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { uiLang } from "@/lib/i18n/format";
import { pickLocalized } from "@/lib/i18n/pickLocalized";
import {
  browserTimeZone,
  eventDayKey,
  eventTimeZone,
  formatEventDate,
  formatEventDateTime,
  isForeignTimeZone,
} from "@/lib/events/timezone";
import { useAuth } from "@/hooks/useAuth";
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
import { useEventAgenda, useSessionSignup } from "@/lib/events/usePublicEvent";
import { publicEventErrorMessage } from "@/lib/events/publicEventErrors";
import { AgendaSessionCard } from "@/components/events/public/molecules/AgendaSessionCard";
import { ensureI18n as ensureEventFrontI18n } from "@/lib/i18n-event-front";

ensureEventFrontI18n();

/**
 * Ile terminów pokazuje karta „Twój harmonogram” przed rozwinięciem.
 *
 * Kolumna stoi obok programu i ma być rzutem oka na najbliższe godziny, a nie
 * drugą kopią agendy - dlatego długa lista chowa się za odnośnikiem, zamiast
 * spychać program pod ekran.
 */
const SCHEDULE_PREVIEW = 3;

export function EventAgendaSection({ slug, enabled = true }: { slug: string; enabled?: boolean }) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const { user } = useAuth();
  const signedIn = user !== null;

  const agendaQuery = useEventAgenda(slug, enabled);
  const signup = useSessionSignup(slug);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [dayKey, setDayKey] = useState<string | null>(null);
  const [trackId, setTrackId] = useState<string | null>(null);
  const [onlyMine, setOnlyMine] = useState(false);
  const [query, setQuery] = useState("");
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);

  const sessions = useMemo(() => agendaQuery.data ?? [], [agendaQuery.data]);
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

  const runSignup = (session: AgendaSession, status: "registered" | "cancelled") => {
    if (!signedIn) {
      toast.info(t("eventFront.agenda.actions.signIn"));
      return;
    }
    setPendingId(session.id);
    signup.mutate(
      { sessionId: session.id, status },
      {
        onSuccess: (result) => {
          setPendingId(null);
          if (result.status === "registered")
            toast.success(t("eventFront.agenda.toasts.registered"));
          else if (result.status === "waitlist")
            toast.success(t("eventFront.agenda.toasts.waitlist"));
          else toast.success(t("eventFront.agenda.toasts.cancelled"));
          if (result.promoted) toast.info(t("eventFront.agenda.toasts.promoted"));
        },
        onError: (error) => {
          setPendingId(null);
          toast.error(publicEventErrorMessage(error));
        },
      },
    );
  };

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

  if (agendaQuery.isPending) {
    return (
      <div className="space-y-3" aria-busy="true" aria-label={t("eventFront.agenda.loading")}>
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (agendaQuery.isError) {
    return (
      <p className="rounded-[6px] border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
        {publicEventErrorMessage(agendaQuery.error)}
      </p>
    );
  }

  if (sessions.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("eventFront.sections.agenda.empty")}</p>;
  }

  // Strefę podpisu bierzemy z PIERWSZEJ sesji: `event_sessions.timezone`
  // dziedziczy strefę wydarzenia, więc jest ta sama w całym programie, a gdyby
  // kiedyś nie była, podpis nadal opisuje dzień, od którego program się zaczyna.
  const eventZone = eventTimeZone({ timezone: sessions[0].timezone });
  const foreignZone = isForeignTimeZone(sessions[0].timezone, browserTimeZone());
  const scheduleShown = scheduleOpen ? mySessions : mySessions.slice(0, SCHEDULE_PREVIEW);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,17rem)_minmax(0,1fr)]">
      <aside aria-label={t("eventFront.agenda.sidebarLabel")} className="space-y-3">
        <div className="rounded-[6px] border border-border bg-card p-3">
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

        <p className="flex items-start gap-2 px-1 text-xs text-muted-foreground">
          <Globe className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            {t("eventFront.agenda.timezoneRow", { zone: eventZone })}
            {foreignZone && <span className="block">{t("eventFront.agenda.timezoneForeign")}</span>}
          </span>
        </p>

        {mySessions.length > 0 && (
          <section
            aria-labelledby="event-agenda-schedule-title"
            className="rounded-[6px] border border-border bg-card"
          >
            <h3
              id="event-agenda-schedule-title"
              className="border-b border-border px-3 py-2 text-sm font-semibold text-foreground"
            >
              {t("eventFront.agenda.myScheduleTitle")}
            </h3>
            <ul className="divide-y divide-border">
              {scheduleShown.map((session) => (
                <li key={session.id}>
                  <button
                    type="button"
                    onClick={() => revealSession(session)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/40"
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
              <div className="border-t border-border px-3 py-2">
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

      <div className="min-w-0 space-y-4">
        {days.length > 1 && (
          <div
            role="tablist"
            aria-label={t("eventFront.header.tabs.agenda")}
            className="flex flex-wrap gap-2"
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
                    "inline-flex items-center gap-2 rounded-[6px] border px-3 py-2 text-sm transition-colors",
                    active
                      ? "border-primary bg-primary/10 font-medium text-foreground"
                      : "border-border bg-card text-muted-foreground hover:text-foreground",
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
          <div className="flex flex-wrap items-center gap-3 rounded-[6px] border border-border bg-muted/30 px-3 py-2">
            {tracks.length > 1 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs uppercase tracking-wide text-muted-foreground">
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
          <div className="divide-y divide-border border-t border-border">
            {visible.map((session) => (
              <AgendaSessionCard
                key={session.id}
                session={session}
                signedIn={signedIn}
                pending={pendingId === session.id && signup.isPending}
                onSignup={(item) => runSignup(item, "registered")}
                onCancel={(item) => runSignup(item, "cancelled")}
              />
            ))}
          </div>
        )}

        {signup.isPending && pendingId === null && (
          <p className="inline-flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            {t("eventFront.agenda.actions.working")}
          </p>
        )}
      </div>
    </div>
  );
}
