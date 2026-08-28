// Organizm: STATYSTYKI NA MIEJSCU.
//
// KAŻDA LICZBA MA ZA SOBĄ WIERSZ W DZIENNIKU. Nie ma tu metryk deklarowanych ani
// szacowanych: „na miejscu" to osoby z wpisem `granted`, a nie osoby, które
// potwierdziły przyjazd mailem.
//
// FREKWENCJA MOŻE NIE ISTNIEĆ. Wydarzenie bez zatwierdzonych zapisów nie ma
// mianownika, więc baza zwraca `null` - kafelek pokazuje wtedy „-", a nie 0%,
// bo zero procent frekwencji to zdanie o pustej sali, a nie o braku danych.
//
// HISTOGRAM CZYTA SIĘ Z KUBEŁKÓW BAZY. Ekran nie grupuje wierszy sam - dwie
// przeglądarki w różnych strefach zgrupowałyby ten sam ruch na inne godziny.
import { useTranslation } from "react-i18next";
import {
  BadgeCheck,
  CalendarCheck,
  Contact,
  LogIn,
  Percent,
  ShieldAlert,
  UserMinus,
  Users,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AdminMetricTile } from "@/components/admin/molecules/AdminMetricTile";
import { AdminCatalogListState } from "@/components/admin/molecules/AdminCatalogListState";
import { adminOnsiteErrorMessage } from "@/lib/events/adminOnsiteErrors";
import { useOnsiteStats } from "@/lib/events/useEventOnsite";
import { OnsiteLiveStatsPanel } from "@/components/admin/events/organisms/OnsiteLiveStatsPanel";
import { uiLang } from "@/lib/i18n/format";

export function OnsiteStatsPanel({ eventId }: { eventId: string }) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const statsQ = useOnsiteStats(eventId);
  const stats = statsQ.data ?? null;

  const percent = (value: number | null): string =>
    value === null ? "-" : `${Math.round(value * 1000) / 10}%`;

  const peak =
    stats === null
      ? 0
      : stats.histogram.reduce(
          (max, bucket) => Math.max(max, bucket.grantedIn + bucket.grantedOut + bucket.denied),
          0,
        );

  return (
    <section className="space-y-4">
      <header className="space-y-1">
        <h2 className="font-display text-lg">{t("adminEventOnsite.stats.title")}</h2>
        <p className="max-w-2xl text-sm text-muted-foreground">
          {t("adminEventOnsite.stats.subtitle")}
        </p>
      </header>

      <AdminCatalogListState
        isLoading={statsQ.isLoading}
        loadingLabel={t("adminEventOnsite.stats.loading")}
        errorMessage={
          statsQ.error === null || statsQ.error === undefined
            ? null
            : adminOnsiteErrorMessage(statsQ.error)
        }
        isEmpty={stats === null}
        emptyLabel={t("adminEventOnsite.stats.loading")}
      >
        {stats === null ? null : (
          <div className="space-y-6">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <AdminMetricTile
                icon={Users}
                label={t("adminEventOnsite.stats.registeredTotal")}
                value={stats.registeredTotal}
              />
              <AdminMetricTile
                icon={LogIn}
                label={t("adminEventOnsite.stats.arrivedTotal")}
                value={stats.arrivedTotal}
                tone="ok"
              />
              <AdminMetricTile
                icon={Percent}
                label={t("adminEventOnsite.stats.attendanceRate")}
                value={percent(stats.attendanceRate)}
              />
              <AdminMetricTile
                icon={UserMinus}
                label={t("adminEventOnsite.stats.noShowTotal")}
                value={stats.noShowTotal}
                tone={stats.noShowTotal > 0 ? "warn" : "neutral"}
              />
              <AdminMetricTile
                icon={CalendarCheck}
                label={t("adminEventOnsite.stats.walkInTotal")}
                value={stats.walkInTotal}
              />
              <AdminMetricTile
                icon={ShieldAlert}
                label={t("adminEventOnsite.stats.deniedTotal")}
                value={stats.deniedTotal}
                tone={stats.deniedTotal > 0 ? "danger" : "neutral"}
              />
              <AdminMetricTile
                icon={BadgeCheck}
                label={t("adminEventOnsite.stats.badgesPrinted")}
                value={`${stats.badgesPrintedPeople} / ${stats.badgesPrintedCopies}`}
              />
              <AdminMetricTile
                icon={Contact}
                label={t("adminEventOnsite.stats.leadScans")}
                value={`${stats.leadScansWithConsent} / ${stats.leadScansTotal}`}
                hint={t("adminEventOnsite.stats.leadScansWithConsent")}
              />
            </div>

            {stats.histogram.length === 0 ? null : (
              <Card>
                <CardContent className="space-y-3 p-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t("adminEventOnsite.stats.histogramTitle")}
                  </h3>
                  <ul className="space-y-1.5">
                    {stats.histogram.map((bucket) => {
                      const value = bucket.grantedIn + bucket.grantedOut + bucket.denied;
                      const width = peak === 0 ? 0 : Math.round((value / peak) * 100);
                      return (
                        <li key={bucket.bucketAt} className="flex items-center gap-3 text-xs">
                          <span className="w-16 shrink-0 tabular-nums text-muted-foreground">
                            {new Date(bucket.bucketAt).toLocaleTimeString(i18n.language, {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                          <span
                            className="h-2 rounded-sm bg-primary/70"
                            style={{ width: `${width}%` }}
                            aria-hidden="true"
                          />
                          <span className="tabular-nums">{value}</span>
                        </li>
                      );
                    })}
                  </ul>
                </CardContent>
              </Card>
            )}

            {stats.checkpoints.length === 0 ? null : (
              <Card>
                <CardContent className="space-y-3 p-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t("adminEventOnsite.stats.checkpointsTitle")}
                  </h3>
                  <ul className="divide-y divide-border/70">
                    {stats.checkpoints.map((row) => (
                      <li
                        key={row.checkpointId}
                        className="flex flex-wrap items-center gap-3 py-2 text-sm"
                      >
                        <span className="min-w-0 flex-1 truncate">
                          {lang === "en" ? row.nameEn || row.namePl : row.namePl || row.nameEn}
                        </span>
                        <Badge variant="outline">
                          {`${t("adminEventOnsite.labels.occupancy")}: ${row.occupancy}${
                            row.capacity === null ? "" : ` / ${row.capacity}`
                          }`}
                        </Badge>
                        <Badge variant="outline">{`${t("adminEventOnsite.results.granted")}: ${row.granted}`}</Badge>
                        {row.denied > 0 ? (
                          <Badge variant="destructive">{`${t("adminEventOnsite.filters.denied")}: ${row.denied}`}</Badge>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardContent className="flex flex-wrap items-center gap-2 p-4 text-sm">
                <h3 className="mr-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("adminEventOnsite.stats.devicesTitle")}
                </h3>
                <Badge variant="outline">{`${t("adminEventOnsite.deviceStates.active")}: ${stats.devices.active}`}</Badge>
                <Badge variant="outline">{`${t("adminEventOnsite.deviceStates.locked")}: ${stats.devices.locked}`}</Badge>
                <Badge variant="outline">{`${t("adminEventOnsite.deviceStates.revoked")}: ${stats.devices.revoked}`}</Badge>
                <Badge variant="outline">{`${t("adminEventOnsite.deviceStates.expired")}: ${stats.devices.expired}`}</Badge>
              </CardContent>
            </Card>
          </div>
        )}
      </AdminCatalogListState>
          <OnsiteLiveStatsPanel eventId={eventId} />
</section>
  );
}
