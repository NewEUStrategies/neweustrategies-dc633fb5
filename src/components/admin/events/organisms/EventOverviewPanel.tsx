// Organizm: „Pulpit" wydarzenia - pierwszy ekran studia po wejsciu.
//
// LICZBY SA PRAWDZIWE ALBO NIE MA ICH WCALE. Wzorzec referencyjny pokazuje na
// pulpicie 48 820 rejestracji przy wydarzeniu, ktore ma dwadziescia jeden osob -
// to sa dane demonstracyjne i to jest najgorsza rzecz, jaka moze zrobic pulpit,
// bo uczy nie ufac zadnej liczbie na ekranie. Tutaj kazdy kafel czyta zywe RPC,
// a kafel bez danych pokazuje kreske, nie zero z palca.
//
// LISTA KROKOW LICZY SIE ZE STANU, nie z checklisty do odklikania. „Dodaj
// okladke" znika, gdy okladka jest - bo warunkiem jest DANA, a nie klikniecie.
// Checklista, ktora da sie odhaczyc bez zrobienia rzeczy, jest gorsza niz brak
// checklisty.
import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Check, ChevronRight } from "@/lib/lucide-shim";
import { Card, CardContent } from "@/components/ui/card";
import {
  EventStudioPage,
  EventStudioRow,
} from "@/components/admin/events/studio/EventStudioSection";
import { EVENT_STUDIO_ROUTES, type EventStudioSection } from "@/lib/events/eventStudioNav";
import { DEFAULT_SESSIONS_QUERY } from "@/lib/events/sessionsApi";
import { useEventSessions } from "@/lib/events/useEventSessions";
import { useEventGroups } from "@/lib/events/useEventTermsGroups";
import { useRegistrationCounts } from "@/lib/events/useEventRegistrations";
import { useSponsors } from "@/lib/events/useEventSponsors";
import type { AdminEventDetailRow } from "@/lib/events/eventDetailApi";
import { formatEventDateTime } from "@/lib/events/timezone";
import { uiLang } from "@/lib/i18n/format";
import { ensureI18n as ensureAdminEventsI18n } from "@/lib/i18n-admin-events";
import { ensureAgendaI18n } from "@/lib/i18n-admin-event-agenda";
import { ensureI18n as ensureRegistrationI18n } from "@/lib/i18n-admin-event-registration";
import { ensureSponsorsI18n } from "@/lib/i18n-admin-event-sponsors";
import { ensureTermsI18n } from "@/lib/i18n-admin-event-terms";

interface NextStep {
  key: string;
  section: EventStudioSection;
  done: boolean;
}

export function EventOverviewPanel({ row }: { row: AdminEventDetailRow }) {
  ensureAdminEventsI18n();
  ensureRegistrationI18n();
  ensureAgendaI18n();
  ensureSponsorsI18n();
  ensureTermsI18n();
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
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
  const groupsQ = useEventGroups(eventId);
  const sponsorsQ = useSponsors({ eventId });

  const registrations = countsQ.data?.all ?? null;
  const seatsLeft = countsQ.data?.seatsLeft ?? null;
  const sessions = sessionsQ.data?.length ?? null;
  const groups = groupsQ.data?.length ?? null;
  const sponsors = sponsorsQ.data?.length ?? null;

  const steps = useMemo<readonly NextStep[]>(
    () => [
      { key: "cover", section: "general", done: (row.cover_url ?? "") !== "" },
      { key: "description", section: "general", done: (row.description_pl ?? "") !== "" },
      {
        key: "location",
        section: "general",
        done: (row.city ?? "") !== "" || row.format === "online",
      },
      { key: "sessions", section: "contentSessions", done: (sessions ?? 0) > 0 },
      { key: "groups", section: "groups", done: (groups ?? 0) > 0 },
      { key: "publish", section: "general", done: row.status === "published" },
    ],
    [row, sessions, groups],
  );

  return (
    <EventStudioPage title={t("adminEvents.studio.sections.overview")}>
      <EventStudioRow
        label={t("adminEvents.studio.overview.summary")}
        description={t("adminEvents.studio.overview.summaryDescription")}
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Metric label={t("adminEvents.studio.overview.registrations")} value={registrations} />
          <Metric label={t("adminEvents.studio.overview.seatsLeft")} value={seatsLeft} />
          <Metric label={t("adminEvents.studio.overview.sessions")} value={sessions} />
          <Metric label={t("adminEvents.studio.overview.groups")} value={groups} />
          <Metric label={t("adminEvents.studio.overview.sponsors")} value={sponsors} />
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">
                {t("adminEvents.studio.overview.startsAt")}
              </p>
              <p className="mt-1 text-sm font-medium">
                {formatEventDateTime(row.starts_at, row.timezone, lang) ||
                  t("adminEvents.list.row.noDate")}
              </p>
            </CardContent>
          </Card>
        </div>
      </EventStudioRow>

      <EventStudioRow
        label={t("adminEvents.studio.overview.nextSteps")}
        description={t("adminEvents.studio.overview.nextStepsDescription")}
      >
        <ul className="divide-y divide-border rounded-md border border-border">
          {steps.map((step) => (
            <li key={step.key}>
              <Link
                to={EVENT_STUDIO_ROUTES[step.section]}
                params={{ eventId }}
                className="flex items-center gap-3 px-3 py-2.5 text-[13px] hover:bg-muted"
              >
                <span
                  className={
                    "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border " +
                    (step.done
                      ? "border-emerald-500 bg-emerald-500 text-white"
                      : "border-border text-transparent")
                  }
                  aria-hidden="true"
                >
                  <Check className="h-3 w-3" />
                </span>
                <span
                  className={
                    "min-w-0 flex-1 truncate " +
                    (step.done ? "text-muted-foreground line-through" : "")
                  }
                >
                  {t(`adminEvents.studio.overview.steps.${step.key}`)}
                </span>
                <ChevronRight
                  className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
              </Link>
            </li>
          ))}
        </ul>
      </EventStudioRow>
    </EventStudioPage>
  );
}

function Metric({ label, value }: { label: string; value: number | null }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        {/* Kreska, a nie zero: „nie wiem" i „zero" to rozne odpowiedzi. */}
        <p className="mt-1 text-2xl font-semibold tabular-nums">{value === null ? "—" : value}</p>
      </CardContent>
    </Card>
  );
}
