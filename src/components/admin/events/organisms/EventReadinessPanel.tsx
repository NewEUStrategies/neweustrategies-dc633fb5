// Organizm: GOTOWOŚĆ DO PUBLIKACJI - jedna odpowiedź na jedno pytanie.
//
// „Czy mogę opublikować" to pytanie, które organizator zadaje raz, tuż przed
// końcem - i dziś odpowiada na nie, klikając po kolei w siedem ekranów studia.
// Ten panel zbiera warunki w jednym miejscu i dzieli je na dwa stopnie: blokada
// (bez tego strona wydarzenia jest niekompletna) i ostrzeżenie (będzie działać,
// ale gorzej wygląda). Rachunek robi czysty `publishReadiness`, tutaj zostaje
// tylko rysowanie i skrót do sekcji, w której da się to naprawić.
import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Check, ChevronRight, ShieldCheck } from "@/lib/lucide-shim";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { usePublishReadiness } from "@/lib/events/usePublishReadiness";
import { Badge } from "@/components/ui/badge";
import { EventStudioRow } from "@/components/admin/events/studio/EventStudioSection";
import { EVENT_STUDIO_ROUTES } from "@/lib/events/eventStudioNav";
import { DEFAULT_SESSIONS_QUERY } from "@/lib/events/sessionsApi";
import { useAgendaConflicts, useEventRooms, useEventSessions } from "@/lib/events/useEventSessions";
import { useEventTickets } from "@/lib/events/useEventRegistrations";
import { buildPublishReadiness, type ReadinessCheck } from "@/lib/events/publishReadiness";
import { eventFeaturesFromJson } from "@/lib/events/eventFeatures";
import { unseatedOnPublishedMaps } from "@/lib/events/seatingApi";
import { useSeatMaps } from "@/lib/events/useEventSeating";
import type { AdminEventDetailRow } from "@/lib/events/eventDetailApi";
import { ensureI18n as ensureAdminEventsI18n } from "@/lib/i18n-admin-events";

export interface EventReadinessPanelProps {
  row: AdminEventDetailRow;
}

export function EventReadinessPanel({ row }: EventReadinessPanelProps) {
  ensureAdminEventsI18n();
  const { t } = useTranslation();
  const eventId = row.id;
  const publicationQ = usePublishReadiness(eventId);

  const sessionsQ = useEventSessions({ ...DEFAULT_SESSIONS_QUERY, eventId });
  const roomsQ = useEventRooms(eventId);
  const conflictsQ = useAgendaConflicts(eventId);
  const ticketsQ = useEventTickets(eventId);
  // Plan sali tylko przy WLACZONYM module - wylaczony nie pyta bazy wcale
  // (pusty identyfikator gasi zapytanie), a pozycja znika z rachunku.
  const seatingOn = eventFeaturesFromJson(row.features).seating;
  const seatMapsQ = useSeatMaps(seatingOn ? eventId : "");

  const report = useMemo(
    () =>
      buildPublishReadiness({
        event: {
          titlePl: row.title_pl,
          titleEn: row.title_en,
          startsAt: row.starts_at,
          endsAt: row.ends_at,
          timezone: row.timezone,
          format: row.format,
          city: row.city,
          addressLine: row.street_address,
          onlineUrl: row.join_url,
          coverUrl: row.cover_url,
          descriptionPl: row.description_pl,
          descriptionEn: row.description_en,
          status: row.status,
          registrationMode: row.registration_mode,
          // Kolumna jest NULL-owalna, choć generator typuje ją jako `number`.
          ticketPriceCents: Number.isFinite(row.ticket_price_cents) ? row.ticket_price_cents : null,
        },
        publicationBlockers: publicationQ.data,
        sessions: sessionsQ.data ?? [],
        conflictCount: conflictsQ.data?.length ?? 0,
        roomCount: roomsQ.data?.length ?? 0,
        // Nieaktywny typ nie sprzedaje: `event_register` liczy tylko `is_active`.
        ticketTypeCount: (ticketsQ.data ?? []).filter((ticket) => ticket.is_active).length,
        seatingUnseated: seatingOn ? unseatedOnPublishedMaps(seatMapsQ.data ?? []) : null,
      }),
    [
      row,
      publicationQ.data,
      sessionsQ.data,
      conflictsQ.data,
      roomsQ.data,
      ticketsQ.data,
      seatingOn,
      seatMapsQ.data,
    ],
  );

  const sources = [
    publicationQ,
    sessionsQ,
    roomsQ,
    conflictsQ,
    ticketsQ,
    ...(seatingOn ? [seatMapsQ] : []),
  ];
  const failed = sources.some((query) => query.isError);
  const loading = sources.some((query) => !query.isSuccess || query.isFetching);
  if (failed || loading) {
    return (
      <EventStudioRow
        label={t("adminEvents.studio.readiness.title")}
        description={t("adminEvents.studio.readiness.description")}
      >
        <div
          role={failed ? "alert" : "status"}
          aria-busy={loading && !failed}
          className="rounded-md border border-border p-3 text-sm"
        >
          <p>
            {t(
              failed
                ? "adminEvents.studio.readiness.loadError"
                : "adminEvents.studio.readiness.loading",
            )}
          </p>
          {failed && (
            <Button
              type="button"
              variant="outline"
              className="mt-2"
              onClick={() => {
                void Promise.all(sources.map((query) => query.refetch()));
              }}
            >
              {t("adminEvents.studio.readiness.retry")}
            </Button>
          )}
        </div>
      </EventStudioRow>
    );
  }

  const published = row.status === "published";
  const pending = report.checks.filter((item) => !item.passed);

  return (
    <EventStudioRow
      label={t("adminEvents.studio.readiness.title")}
      description={t("adminEvents.studio.readiness.description")}
    >
      <div className="rounded-md border border-border">
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-3 py-2.5">
          <span
            className={cn(
              "flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px]",
              report.canPublish
                ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                : "bg-destructive/10 text-destructive",
            )}
            aria-hidden="true"
          >
            {report.canPublish ? (
              <ShieldCheck className="h-3.5 w-3.5" />
            ) : (
              <AlertTriangle className="h-3.5 w-3.5" />
            )}
          </span>
          <p className="min-w-0 flex-1 text-[13px] font-medium">
            {report.canPublish
              ? published
                ? t("adminEvents.studio.readiness.publishedOk")
                : t("adminEvents.studio.readiness.readyToPublish")
              : t("adminEvents.studio.readiness.blocked", { count: report.blockers.length })}
          </p>
          <Badge variant="outline" className="rounded-[6px] tabular-nums">
            {t("adminEvents.studio.readiness.progress", {
              passed: report.passedCount,
              total: report.totalCount,
            })}
          </Badge>
        </div>

        {pending.length === 0 ? (
          <p className="px-3 py-3 text-[13px] text-muted-foreground">
            {t("adminEvents.studio.readiness.allDone")}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {pending.map((item) => (
              <ReadinessItem key={item.key} item={item} eventId={eventId} />
            ))}
          </ul>
        )}
      </div>
    </EventStudioRow>
  );
}

function ReadinessItem({ item, eventId }: { item: ReadinessCheck; eventId: string }) {
  const { t } = useTranslation();
  const blocker = item.severity === "blocker";

  return (
    <li>
      <Link
        to={EVENT_STUDIO_ROUTES[item.section]}
        params={{ eventId }}
        className="flex items-center gap-3 px-3 py-2.5 text-[13px] hover:bg-muted"
      >
        <span
          className={cn(
            "flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] border",
            blocker
              ? "border-destructive/40 bg-destructive/10 text-destructive"
              : "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
          )}
          aria-hidden="true"
        >
          {blocker ? <AlertTriangle className="h-3 w-3" /> : <Check className="h-3 w-3" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate">
            {t(`adminEvents.studio.readiness.checks.${item.key}`, { count: item.count })}
          </span>
          <span className="block text-xs text-muted-foreground">
            {blocker
              ? t("adminEvents.studio.readiness.severity.blocker")
              : t("adminEvents.studio.readiness.severity.warning")}
          </span>
        </span>
        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      </Link>
    </li>
  );
}
