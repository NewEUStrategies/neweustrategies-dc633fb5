// Organizm: „Analityka" JEDNEGO wydarzenia.
//
// SKLADAMY Z ZYWYCH RPC, NIE Z NOWEGO ZAPYTANIA. Zapisy, odprawa i gielda
// spotkan licza swoje statystyki po stronie bazy i robia to od tygodni
// (`admin_event_registrations_counts`, `admin_event_onsite_stats`,
// `admin_event_meeting_stats`). Szosty licznik tych samych rzeczy byl by
// szostym miejscem, w ktorym liczba moze sie rozjechac - a rozjazd na
// pulpicie kosztuje zaufanie do wszystkich pozostalych liczb.
//
// NIGDY DANYCH DEMONSTRACYJNYCH. Wzorzec referencyjny pokazuje na pulpicie
// 48 820 rejestracji przy wydarzeniu, ktore ma dwadziescia jeden osob. To jest
// najgorsza rzecz, jaka moze zrobic ekran analityki, bo uczy nie ufac zadnej
// liczbie. Kafel bez danych pokazuje KRESKE: „nie wiem" i „zero" to rozne
// odpowiedzi i nie wolno ich splaszczac.
//
// FREKWENCJA JEST PROCENTEM ALBO NICZYM. `attendanceRate === null` znaczy
// „nikt jeszcze nie odznaczyl obecnosci", a nie „nikt nie przyszedl" - stad
// osobny stan, a nie zero procent.
//
// TO NIE JEST ZAMIENNIK `/admin/analytics`. Tam mieszka ruch serwisu (odslony,
// zrodla, konwersje); tutaj wylacznie to, co da sie policzyc DLA TEGO
// wydarzenia. Odnosnik do modulu globalnego zostaje, zeby nikt nie szukal
// wykresu ruchu w wydarzeniu.
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ExternalLink } from "@/lib/lucide-shim";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  EventStudioPage,
  EventStudioRow,
} from "@/components/admin/events/studio/EventStudioSection";
import { DEFAULT_SESSIONS_QUERY } from "@/lib/events/sessionsApi";
import { useEventSessions } from "@/lib/events/useEventSessions";
import { useRegistrationCounts } from "@/lib/events/useEventRegistrations";
import { useMeetingStats } from "@/lib/events/useMeetings";
import { useOnsiteStats } from "@/lib/events/useEventOnsite";
import type { AdminEventDetailRow } from "@/lib/events/eventDetailApi";
import { ensureI18n as ensureAdminEventsI18n } from "@/lib/i18n-admin-events";
import { ensureAgendaI18n } from "@/lib/i18n-admin-event-agenda";
import { ensureI18n as ensureMeetingsI18n } from "@/lib/i18n-admin-event-meetings";
import { ensureOnsiteI18n } from "@/lib/i18n-admin-event-onsite";
import { ensureI18n as ensureRegistrationI18n } from "@/lib/i18n-admin-event-registration";

/** Procent do wyswietlenia albo `null` - bez zaokraglania w gore do zera. */
function percent(value: number | null | undefined): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return `${Math.round(value)}%`;
}

export function EventAnalyticsPanel({ row }: { row: AdminEventDetailRow }) {
  ensureAdminEventsI18n();
  ensureRegistrationI18n();
  ensureAgendaI18n();
  ensureMeetingsI18n();
  ensureOnsiteI18n();
  const { t } = useTranslation();
  const eventId = row.id;

  const countsQ = useRegistrationCounts({
    eventId,
    ticketTypeId: null,
    groupId: null,
    q: "",
    from: null,
    to: null,
  });
  const sessionsQ = useEventSessions({ ...DEFAULT_SESSIONS_QUERY, eventId });
  const meetingsQ = useMeetingStats(eventId);
  // Odprawa odswieza sie sama co pol minuty w swoim module; tutaj wystarcza
  // odczyt na wejscie - analityke czyta sie po wydarzeniu, nie przy bramce.
  const onsiteQ = useOnsiteStats(eventId, 60);

  const counts = countsQ.data ?? null;
  const onsite = onsiteQ.data ?? null;
  const meetings = meetingsQ.data ?? null;

  const byStatus = counts?.byStatus ?? null;

  return (
    <EventStudioPage title={t("adminEvents.studio.sections.analytics")}>
      <EventStudioRow
        label={t("adminEvents.studio.analytics.registrations")}
        description={t("adminEvents.studio.analytics.registrationsDescription")}
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric
            label={t("adminEvents.studio.analytics.registrationsTotal")}
            value={counts === null ? null : counts.all}
          />
          <Metric
            label={t("adminEvents.studio.analytics.approved")}
            value={byStatus === null ? null : byStatus.approved}
          />
          <Metric
            label={t("adminEvents.studio.analytics.pending")}
            value={byStatus === null ? null : byStatus.pending}
          />
          <Metric
            label={t("adminEvents.studio.analytics.waitlist")}
            value={byStatus === null ? null : byStatus.waitlist}
          />
          <Metric
            label={t("adminEvents.studio.analytics.seatsLeft")}
            value={counts === null ? null : counts.seatsLeft}
            hint={
              counts !== null && counts.capacity === null
                ? t("adminEvents.studio.analytics.noCapacity")
                : undefined
            }
          />
        </div>
      </EventStudioRow>

      <EventStudioRow
        label={t("adminEvents.studio.analytics.programme")}
        description={t("adminEvents.studio.analytics.programmeDescription")}
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Metric
            label={t("adminEvents.studio.analytics.sessions")}
            value={sessionsQ.data === undefined ? null : sessionsQ.data.length}
          />
          <Metric
            label={t("adminEvents.studio.analytics.meetingsHeld")}
            value={meetings === null ? null : meetings.held}
          />
          <Metric
            label={t("adminEvents.studio.analytics.meetingsAcceptance")}
            text={meetings === null ? null : percent(meetings.acceptanceRate)}
          />
        </div>
      </EventStudioRow>

      <EventStudioRow
        label={t("adminEvents.studio.analytics.onsite")}
        description={t("adminEvents.studio.analytics.onsiteDescription")}
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric
            label={t("adminEvents.studio.analytics.arrived")}
            value={onsite === null ? null : onsite.arrivedTotal}
          />
          <Metric
            label={t("adminEvents.studio.analytics.noShow")}
            value={onsite === null ? null : onsite.noShowTotal}
          />
          <Metric
            label={t("adminEvents.studio.analytics.attendanceRate")}
            text={onsite === null ? null : percent(onsite.attendanceRate)}
          />
          <Metric
            label={t("adminEvents.studio.analytics.walkIn")}
            value={onsite === null ? null : onsite.walkInTotal}
          />
          <Metric
            label={t("adminEvents.studio.analytics.badgesPrinted")}
            value={onsite === null ? null : onsite.badgesPrintedPeople}
          />
          <Metric
            label={t("adminEvents.studio.analytics.leadScans")}
            value={onsite === null ? null : onsite.leadScansTotal}
            hint={
              onsite === null
                ? undefined
                : t("adminEvents.studio.analytics.leadScansConsent", {
                    count: onsite.leadScansWithConsent,
                  })
            }
          />
        </div>
      </EventStudioRow>

      <EventStudioRow
        label={t("adminEvents.studio.analytics.siteTraffic")}
        description={t("adminEvents.studio.analytics.siteTrafficDescription")}
      >
        <Button asChild variant="outline" size="sm" className="w-fit">
          <Link to="/admin/analytics">
            {t("adminEvents.studio.external.openModule")}
            <ExternalLink className="ml-1.5 h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </Button>
      </EventStudioRow>
    </EventStudioPage>
  );
}

function Metric({
  label,
  value,
  text,
  hint,
}: {
  label: string;
  /** `null` = jeszcze nie wiadomo. Kreska, nie zero. */
  value?: number | null;
  /** Gotowy napis (procent) - `null` znaczy „nie ma z czego policzyc". */
  text?: string | null;
  hint?: string;
}) {
  const shown = text !== undefined ? text : value === null || value === undefined ? null : value;
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">{shown === null ? "—" : shown}</p>
        {hint === undefined ? null : (
          <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{hint}</p>
        )}
      </CardContent>
    </Card>
  );
}
