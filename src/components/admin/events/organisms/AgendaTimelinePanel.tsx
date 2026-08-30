// Organizm: SIATKA CZASU agendy - sala (kolumna) x godzina (oś pionowa).
//
// PO CO OBOK LISTY SESJI. Lista odpowiada na pytanie „co jest w programie",
// siatka na pytanie „co dzieje się jednocześnie" - a to drugie jest jedynym
// sposobem, żeby zobaczyć dziurę w sali, nachodzące się pasma i sesję, która
// wystaje poza dzień. Kolizje, które baza umie nazwać, są tu podświetlone na
// kaflu: raport tekstowy mówi CO jest nie tak, siatka pokazuje GDZIE.
//
// UKŁAD LICZY MODUŁ `agendaTimeline`, nie ten plik. Tutaj zostaje wyłącznie
// rysowanie: pozycja kafla to minuty przemnożone przez stałą wysokość minuty,
// wspólną dla osi i dla bloków - inaczej godziny rozjeżdżają się z treścią.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle } from "@/lib/lucide-shim";
import { cn } from "@/lib/utils";
import { AdminCatalogListState } from "@/components/admin/molecules/AdminCatalogListState";
import { adminAgendaErrorMessage } from "@/lib/events/adminAgendaErrors";
import { DEFAULT_SESSIONS_QUERY } from "@/lib/events/sessionsApi";
import { useAgendaConflicts, useEventRooms, useEventSessions } from "@/lib/events/useEventSessions";
import {
  TIMELINE_MINUTE_PX,
  TIMELINE_NO_ROOM,
  buildAgendaTimeline,
  formatMinuteLabel,
} from "@/lib/events/agendaTimeline";
import { formatEventDate } from "@/lib/events/timezone";
import { uiLang } from "@/lib/i18n/format";
import { ensureAgendaI18n } from "@/lib/i18n-admin-event-agenda";

export interface AgendaTimelinePanelProps {
  eventId: string;
  timezone: string | null | undefined;
  /** Kliknięcie kafla - opcjonalne, siatka działa też jako sam podgląd. */
  onOpenSession?: (sessionId: string) => void;
}

export function AgendaTimelinePanel({
  eventId,
  timezone,
  onOpenSession,
}: AgendaTimelinePanelProps) {
  ensureAgendaI18n();
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language) === "en" ? "en" : "pl";

  const sessionsQ = useEventSessions({ ...DEFAULT_SESSIONS_QUERY, eventId });
  const roomsQ = useEventRooms(eventId);
  const conflictsQ = useAgendaConflicts(eventId);
  const [dayIndex, setDayIndex] = useState(0);

  const days = useMemo(
    () =>
      buildAgendaTimeline({
        sessions: sessionsQ.data ?? [],
        rooms: roomsQ.data ?? [],
        conflicts: conflictsQ.data ?? [],
        timezone,
        lang,
      }),
    [sessionsQ.data, roomsQ.data, conflictsQ.data, timezone, lang],
  );

  // Dzień wybrany kliknięciem może zniknąć po usunięciu ostatniej sesji - wtedy
  // wracamy na pierwszy, zamiast rysować pustkę „poza zakresem".
  const day = days[Math.min(dayIndex, Math.max(0, days.length - 1))] ?? null;
  const conflictCount = new Set((conflictsQ.data ?? []).map((row) => row.session_id)).size;

  const hours = useMemo(() => {
    if (day === null) return [];
    const out: number[] = [];
    for (let hour = day.fromHour; hour <= day.toHour; hour += 1) out.push(hour);
    return out;
  }, [day]);

  const gridHeight = day === null ? 0 : (day.toHour - day.fromHour) * 60 * TIMELINE_MINUTE_PX;

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h2 className="font-display text-lg">{t("adminEventAgenda.timeline.title")}</h2>
          <p className="max-w-2xl text-sm text-muted-foreground">
            {t("adminEventAgenda.timeline.subtitle")}
          </p>
        </div>
        {conflictCount > 0 && (
          <span className="inline-flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-2.5 py-1 text-xs font-medium text-destructive">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
            {t("adminEventAgenda.timeline.conflictCount", { count: conflictCount })}
          </span>
        )}
      </header>

      <AdminCatalogListState
        isLoading={sessionsQ.isLoading || roomsQ.isLoading}
        loadingLabel={t("adminEventAgenda.timeline.loading")}
        errorMessage={
          sessionsQ.error === null || sessionsQ.error === undefined
            ? null
            : adminAgendaErrorMessage(sessionsQ.error)
        }
        isEmpty={days.length === 0}
        emptyLabel={t("adminEventAgenda.timeline.empty")}
      >
        {days.length > 1 && (
          <div
            className="mb-3 flex flex-wrap gap-2"
            role="tablist"
            aria-label={t("adminEventAgenda.timeline.daysLabel")}
          >
            {days.map((entry, index) => (
              <button
                key={entry.dayKey}
                type="button"
                role="tab"
                aria-selected={entry.dayKey === day?.dayKey}
                onClick={() => setDayIndex(index)}
                className={cn(
                  "rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
                  entry.dayKey === day?.dayKey
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:bg-muted",
                )}
              >
                {formatEventDate(`${entry.dayKey}T12:00:00Z`, timezone, lang) || entry.dayKey}
              </button>
            ))}
          </div>
        )}

        {day !== null && (
          <div className="overflow-x-auto rounded-md border border-border">
            <div className="min-w-[640px]">
              {/* Nagłówek kolumn stoi w tej samej siatce, co treść - inaczej
                  nazwa sali rozjeżdża się z kolumną przy przewijaniu w bok. */}
              <div
                className="grid border-b border-border bg-muted/40"
                style={{
                  gridTemplateColumns: `4rem repeat(${Math.max(1, day.columns.length)}, minmax(11rem, 1fr))`,
                }}
              >
                <div className="px-2 py-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                  {t("adminEventAgenda.timeline.hourAxis")}
                </div>
                {day.columns.map((column) => (
                  <div key={column.id} className="border-l border-border px-3 py-2">
                    <p className="truncate text-sm font-medium">
                      {column.id === TIMELINE_NO_ROOM
                        ? t("adminEventAgenda.timeline.noRoom")
                        : column.name}
                    </p>
                    {column.capacity !== null && column.capacity > 0 && (
                      <p className="text-[11px] text-muted-foreground">
                        {t("adminEventAgenda.timeline.capacity", { count: column.capacity })}
                      </p>
                    )}
                  </div>
                ))}
              </div>

              <div
                className="grid"
                style={{
                  gridTemplateColumns: `4rem repeat(${Math.max(1, day.columns.length)}, minmax(11rem, 1fr))`,
                }}
              >
                <div className="relative" style={{ height: gridHeight }}>
                  {hours.map((hour) => (
                    <div
                      key={hour}
                      className="absolute left-0 right-0 -translate-y-1/2 px-2 text-right text-[11px] tabular-nums text-muted-foreground"
                      style={{ top: (hour - day.fromHour) * 60 * TIMELINE_MINUTE_PX }}
                    >
                      {formatMinuteLabel(hour * 60)}
                    </div>
                  ))}
                </div>

                {day.columns.map((column) => (
                  <div
                    key={column.id}
                    className="relative border-l border-border"
                    style={{ height: gridHeight }}
                  >
                    {hours.map((hour) => (
                      <div
                        key={hour}
                        className="absolute left-0 right-0 border-t border-border/60"
                        style={{ top: (hour - day.fromHour) * 60 * TIMELINE_MINUTE_PX }}
                        aria-hidden="true"
                      />
                    ))}
                    {day.blocks
                      .filter((block) => block.columnId === column.id)
                      .map((block) => {
                        const top = (block.startMinute - day.fromHour * 60) * TIMELINE_MINUTE_PX;
                        const width = 100 / block.lanes;
                        return (
                          <button
                            key={block.sessionId}
                            type="button"
                            onClick={
                              onOpenSession === undefined
                                ? undefined
                                : () => onOpenSession(block.sessionId)
                            }
                            className={cn(
                              "absolute overflow-hidden rounded-[6px] border p-1.5 text-left text-[11px] leading-tight transition-shadow",
                              block.hasConflict
                                ? "border-destructive bg-destructive/10"
                                : "border-border bg-card",
                              block.status === "cancelled" && "opacity-60 line-through",
                              onOpenSession !== undefined && "hover:shadow-md",
                            )}
                            style={{
                              top,
                              height: Math.max(24, block.spanMinutes * TIMELINE_MINUTE_PX - 2),
                              left: `calc(${block.lane * width}% + 2px)`,
                              width: `calc(${width}% - 4px)`,
                              borderLeftWidth: block.accentColor === null ? undefined : 3,
                              borderLeftColor: block.accentColor ?? undefined,
                            }}
                          >
                            <span className="block font-medium tabular-nums text-muted-foreground">
                              {formatMinuteLabel(block.startMinute)}-
                              {formatMinuteLabel(block.endMinute)}
                            </span>
                            <span className="mt-0.5 block font-medium">{block.title}</span>
                            {block.trackName !== "" && (
                              <span className="mt-0.5 block truncate text-muted-foreground">
                                {block.trackName}
                              </span>
                            )}
                            {block.hasConflict && (
                              <span className="mt-0.5 flex items-center gap-1 text-destructive">
                                <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                                {t("adminEventAgenda.timeline.conflictBadge")}
                              </span>
                            )}
                          </button>
                        );
                      })}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {day !== null && day.undated.length > 0 && (
          <p className="mt-3 text-xs text-muted-foreground">
            {t("adminEventAgenda.timeline.undated", { count: day.undated.length })}
          </p>
        )}
      </AdminCatalogListState>
    </section>
  );
}
