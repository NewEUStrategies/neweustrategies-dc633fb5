// Organizm: statystyki giełdy spotkań 1-1.
//
// LICZBY SĄ POGRUPOWANE PO PYTANIU, NA KTÓRE ODPOWIADAJĄ, a nie po tabeli,
// z której pochodzą: „czy giełda żyje" (zaproszenia i wskaźnik akceptacji),
// „czy wystarczy miejsca" (sloty, stoliki, obciążenie), „kto zostaje sam"
// (uczestnicy bez spotkania).
//
// BRAK PODSTAWY POKAZUJEMY JAKO KRESKĘ, NIE JAKO 0%. `acceptanceRate === null`
// znaczy „nikt jeszcze nie odpowiedział" - wydrukowanie tam zera mówiłoby
// organizatorowi, że wszyscy odmówili, i kazało ratować giełdę, która dopiero
// wystartowała.
//
// LISTA OSÓB BEZ SPOTKANIA TO NARZĘDZIE, NIE METRYKA. Dlatego pokazuje nazwisko,
// firmę i to, czy człowiek w ogóle zadeklarował dostępność - bo pierwsze pytanie
// przy ratowaniu takiego uczestnika brzmi „czy on ma kiedy się spotkać".
import { useTranslation } from "react-i18next";
import { CalendarCheck, CalendarClock, Loader2, Percent, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { AdminMetricTile } from "@/components/admin/molecules/AdminMetricTile";
import { AdminFormSection } from "@/components/admin/molecules/AdminFormSection";
import { adminMeetingFailure } from "@/lib/events/adminMeetingErrors";
import { formatNumber } from "@/lib/i18n/format";
import { useMeetingStats } from "@/lib/events/useMeetings";

/** Procent albo kreska - `null` znaczy „nie ma z czego liczyć". */
function pctLabel(value: number | null): string {
  return value === null ? "-" : `${value}%`;
}

export function MeetingStatsPanel({ eventId }: { eventId: string }) {
  const { t, i18n } = useTranslation();
  const statsQ = useMeetingStats(eventId);

  if (statsQ.isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        {t("adminEventMeetings.stats.loading")}
      </div>
    );
  }
  if (statsQ.error !== null) {
    return <p className="text-sm text-destructive">{t(adminMeetingFailure(statsQ.error).key)}</p>;
  }
  const stats = statsQ.data;
  if (stats === undefined) return null;

  const num = (value: number): string => formatNumber(value, i18n.language);

  return (
    <section className="space-y-6">
      <header>
        <h2 className="font-display text-lg">{t("adminEventMeetings.stats.title")}</h2>
        <p className="mt-1 max-w-2xl text-xs leading-snug text-muted-foreground">
          {t("adminEventMeetings.stats.subtitle")}
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <AdminMetricTile
          icon={CalendarClock}
          label={t("adminEventMeetings.stats.total")}
          value={num(stats.total)}
        />
        <AdminMetricTile
          icon={CalendarCheck}
          label={t("adminEventMeetings.stats.confirmed")}
          value={num(stats.confirmed)}
          tone="ok"
        />
        <AdminMetricTile
          icon={Percent}
          label={t("adminEventMeetings.stats.acceptanceRate")}
          hint={t("adminEventMeetings.stats.acceptanceRateHint")}
          value={pctLabel(stats.acceptanceRate)}
        />
        <AdminMetricTile
          icon={Percent}
          label={t("adminEventMeetings.stats.attendanceRate")}
          hint={t("adminEventMeetings.stats.attendanceRateHint")}
          value={pctLabel(stats.attendanceRate)}
        />
        <AdminMetricTile
          icon={CalendarClock}
          label={t("adminEventMeetings.stats.invited")}
          value={num(stats.invited)}
        />
        <AdminMetricTile
          icon={CalendarClock}
          label={t("adminEventMeetings.stats.expired")}
          value={num(stats.expired)}
          tone="warn"
        />
        <AdminMetricTile
          icon={CalendarCheck}
          label={t("adminEventMeetings.stats.held")}
          value={num(stats.held)}
        />
        <AdminMetricTile
          icon={Users}
          label={t("adminEventMeetings.stats.noShow")}
          value={num(stats.noShow)}
          tone="warn"
        />
      </div>

      <AdminFormSection title={t("adminEventMeetings.stats.tablesSection")}>
        {stats.tables.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {t("adminEventMeetings.settings.readinessNoTables")}
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border/60">
            {stats.tables.map((table) => (
              <li key={table.tableId} className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{table.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {table.slotsCapacity === 0
                      ? t("adminEventMeetings.stats.tableUtilisationUnknown")
                      : t("adminEventMeetings.stats.tableUtilisation", {
                          taken: table.slotsTaken,
                          capacity: table.slotsCapacity,
                        })}
                  </p>
                </div>
                <Badge variant={table.isActive ? "outline" : "secondary"} className="text-[11px]">
                  {pctLabel(table.utilisationPct)}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </AdminFormSection>

      <AdminFormSection title={t("adminEventMeetings.stats.byDaySection")}>
        {stats.byDay.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {t("adminEventMeetings.settings.daysEmpty")}
          </p>
        ) : (
          <ul className="space-y-1 text-sm">
            {stats.byDay.map((day) => (
              <li key={day.day} className="flex items-center justify-between gap-3">
                <span>{day.day}</span>
                <span className="text-xs text-muted-foreground">
                  {num(day.confirmed)} {t("adminEventMeetings.stats.byDayConfirmed")} ·{" "}
                  {num(day.invited)} {t("adminEventMeetings.stats.byDayInvited")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </AdminFormSection>

      <AdminFormSection
        title={t("adminEventMeetings.stats.lonelySection")}
        hint={t("adminEventMeetings.stats.lonelyHint")}
      >
        {stats.withoutMeeting.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {t("adminEventMeetings.stats.lonelyEmpty")}
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border/60">
            {stats.withoutMeeting.map((person) => (
              <li
                key={person.registrationId}
                className="flex flex-wrap items-center justify-between gap-2 p-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm">
                    {[person.firstName, person.lastName].filter(Boolean).join(" ")}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {[person.jobTitle, person.company].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <Badge
                  variant={person.hasAvailability ? "outline" : "secondary"}
                  className="text-[11px]"
                >
                  {t(
                    person.hasAvailability
                      ? "adminEventMeetings.stats.lonelyHasAvailability"
                      : "adminEventMeetings.stats.lonelyNoAvailability",
                  )}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </AdminFormSection>
    </section>
  );
}
