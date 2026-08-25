// Organizm: PUBLICZNY program wydarzenia z zapisami na sesje.
//
// DZIEŃ JEST ZAKŁADKĄ, NIE NAGŁÓWKIEM. Kongres dwudniowy ma kilkadziesiąt
// sesji; jedna długa lista każe przewijać przez wczoraj, żeby zobaczyć dziś.
// Zakładka dnia trzyma klucz `YYYY-MM-DD` w STREFIE WYDARZENIA, więc wybór
// uczestnika przeżywa przełączenie języka.
//
// FILTR NURTU I „TYLKO MOJE" TO DWA RÓŻNE PYTANIA. Pierwsze zadaje ktoś, kto
// wybiera ścieżkę tematyczną, drugie ktoś, kto stoi na korytarzu i pyta „gdzie
// mam teraz być". Dlatego filtr własnych sesji pojawia się dopiero wtedy, gdy
// uczestnik cokolwiek ma - inaczej byłby przełącznikiem do pustej listy.
//
// ZAPIS JEST OPTYMISTYCZNY TYLKO W PRZYCISKU. Liczby miejsc przychodzą z bazy
// po unieważnieniu zapytania - zgadywanie ich lokalnie dałoby „zostało 0 miejsc"
// obok przycisku, który jeszcze działa.
import { useMemo, useState } from "react";
import { CalendarDays, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { uiLang } from "@/lib/i18n/format";
import { pickLocalized } from "@/lib/i18n/pickLocalized";
import { formatEventDate } from "@/lib/events/timezone";
import { useAuth } from "@/hooks/useAuth";
import {
  agendaTrackOptions,
  filterAgenda,
  groupAgendaByDay,
  hasOwnAgenda,
  type AgendaSession,
} from "@/lib/events/agendaSurface";
import { useEventAgenda, useSessionSignup } from "@/lib/events/usePublicEvent";
import { publicEventErrorMessage } from "@/lib/events/publicEventErrors";
import { AgendaSessionCard } from "@/components/events/public/molecules/AgendaSessionCard";
import { ensureI18n as ensureEventFrontI18n } from "@/lib/i18n-event-front";

ensureEventFrontI18n();

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

  const sessions = useMemo(() => agendaQuery.data ?? [], [agendaQuery.data]);
  const days = useMemo(() => groupAgendaByDay(sessions), [sessions]);
  const tracks = useMemo(() => agendaTrackOptions(sessions), [sessions]);
  const mineAvailable = useMemo(() => hasOwnAgenda(sessions), [sessions]);

  // Wybrany dzień musi ISTNIEĆ w danych - po odświeżeniu programu dzień
  // z pamięci komponentu bywa już nieaktualny, a wtedy widok byłby pusty
  // bez żadnego powodu widocznego dla uczestnika.
  const activeDayKey =
    dayKey !== null && days.some((day) => day.key === dayKey) ? dayKey : (days[0]?.key ?? null);
  const activeDay = days.find((day) => day.key === activeDayKey) ?? null;

  const visible = useMemo(
    () => (activeDay === null ? [] : filterAgenda(activeDay.sessions, { trackId, onlyMine })),
    [activeDay, trackId, onlyMine],
  );

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

  return (
    <div className="space-y-4">
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
          {onlyMine ? t("eventFront.agenda.emptyMine") : t("eventFront.agenda.emptyFiltered")}
        </p>
      ) : (
        <div className="space-y-3">
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
  );
}
