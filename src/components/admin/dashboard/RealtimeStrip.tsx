// PASEK "TERAZ NA STRONIE" - stoi NA GÓRZE PULPITU I NIE ZALEŻY OD ZAKŁADKI.
//
// DLACZEGO NIE JEST JEDNĄ Z ZAKŁADEK OKRESU. "Ilu ludzi jest na stronie w tej
// chwili" to pytanie, które nie przestaje być aktualne, gdy admin ogląda rok -
// przeciwnie, wtedy jest jedynym sygnałem, że pomiar w ogóle żyje. Schowane pod
// zakładką, byłoby widoczne tylko wtedy, gdy ktoś już wiedział, żeby tam
// zajrzeć.
//
// SKĄD SIĘ BIERZE "TERAZ". Z ostatnich minut strumienia `analytics_events`,
// a nie z kanału obecności - patrz nagłówek `admin_dashboard_realtime` w
// migracji. Okno jest podane WPROST przy liczbie, bo pomiar ma tę dokładność
// i obiecywanie sekundowej precyzji byłoby nieuczciwe.
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Radio } from "lucide-react";

import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { ChartCard } from "@/components/admin/analytics/ChartCard";
import { biChart } from "@/components/admin/analytics/biChart";
import { chartLangFrom } from "@/lib/charts/format";
import { formatCount } from "@/lib/admin/dashboard/compare";
import { bucketLabel, countryNamer } from "@/lib/admin/dashboard/labels";
import { REALTIME_ACTIVE_MINUTES, REALTIME_WINDOW_MINUTES } from "@/lib/admin/dashboard/period";
import type { RealtimeReport } from "@/lib/admin/dashboard/types";
import { RankedList } from "./RankedList";

export interface RealtimeStripProps {
  report: RealtimeReport;
  /** Czy pokazać rozwinięcie (wykres minutowy + listy) - zakładka „Na żywo". */
  expanded?: boolean;
  className?: string;
}

export function RealtimeStrip({ report, expanded = false, className }: RealtimeStripProps) {
  const { t, i18n } = useTranslation();
  const lang = chartLangFrom(i18n.language);
  const nameOf = useMemo(() => countryNamer(lang), [lang]);

  const perMinuteConfig = useMemo(
    () =>
      biChart({
        kind: "bar",
        categories: report.perMinute.map((p) => bucketLabel(p.bucket, "minute")),
        series: [
          {
            name: t("adminDashboard.traffic.sessions"),
            values: report.perMinute.map((p) => p.sessions),
          },
        ],
        sampleSize: report.windowViews,
        showLegend: false,
      }),
    [report.perMinute, report.windowViews, t],
  );

  const live = report.activeSessions > 0;

  return (
    <div className={cn("space-y-2.5", className)}>
      <Card className="p-3">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="flex items-center gap-2.5">
            {/* Kropka pulsuje TYLKO wtedy, gdy ktoś naprawdę jest. Animacja przy
                zerze sugerowałaby żywy ruch, którego nie ma. */}
            <span className="relative flex h-2.5 w-2.5 shrink-0" aria-hidden="true">
              {live ? (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--chart-positive)] opacity-60" />
              ) : null}
              <span
                className={cn(
                  "relative inline-flex rounded-full h-2.5 w-2.5",
                  live ? "bg-[var(--chart-positive)]" : "bg-muted-foreground/40",
                )}
              />
            </span>
            <div>
              <div className="text-[11px] font-medium text-muted-foreground flex items-center gap-1">
                <Radio className="w-3 h-3" aria-hidden="true" />
                {t("adminDashboard.realtime.title")}
              </div>
              <div className="text-2xl font-bold font-display leading-tight tabular-nums">
                {formatCount(report.activeSessions, lang)}
              </div>
            </div>
          </div>

          <dl className="flex flex-wrap gap-x-6 gap-y-2 text-xs">
            <div>
              <dt className="text-[11px] text-muted-foreground">
                {t("adminDashboard.realtime.activeMembers")}
              </dt>
              <dd className="font-semibold tabular-nums">
                {formatCount(report.activeMembers, lang)}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] text-muted-foreground">
                {t("adminDashboard.realtime.windowSessions", { minutes: REALTIME_WINDOW_MINUTES })}
              </dt>
              <dd className="font-semibold tabular-nums">
                {formatCount(report.windowSessions, lang)}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] text-muted-foreground">
                {t("adminDashboard.realtime.windowViews", { minutes: REALTIME_WINDOW_MINUTES })}
              </dt>
              <dd className="font-semibold tabular-nums">
                {formatCount(report.windowViews, lang)}
              </dd>
            </div>
          </dl>

          <p className="text-[10px] text-muted-foreground ms-auto">
            {t("adminDashboard.realtime.precision", { minutes: REALTIME_ACTIVE_MINUTES })}
          </p>
        </div>

        {!live ? (
          <p className="text-[11px] text-muted-foreground mt-2">
            <span className="font-medium text-foreground">
              {t("adminDashboard.realtime.nobody")}
            </span>{" "}
            {t("adminDashboard.realtime.nobodyHint")}
          </p>
        ) : null}
      </Card>

      {expanded ? (
        <div className="grid lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-2.5">
          <ChartCard
            title={t("adminDashboard.realtime.chartTitle")}
            subtitle={t("adminDashboard.realtime.chartSubtitle")}
            config={perMinuteConfig}
            height={200}
            csv={{
              filename: "na-zywo",
              headers: [
                t("adminDashboard.realtime.chartTitle"),
                t("adminDashboard.traffic.colSessions"),
                t("adminDashboard.traffic.colViews"),
              ],
              rows: report.perMinute.map((p) => [p.bucket, p.sessions, p.pageViews]),
            }}
          />
          <div className="grid gap-2.5">
            <Card className="p-3">
              <h3 className="text-xs font-semibold mb-1.5">
                {t("adminDashboard.realtime.livePaths")}
              </h3>
              <RankedList
                rows={report.paths.map((p) => ({ id: p.path, label: p.path, value: p.sessions }))}
                labelHeader={t("adminDashboard.traffic.colPath")}
                valueHeader={t("adminDashboard.traffic.colSessions")}
                maxRows={6}
              />
            </Card>
            <Card className="p-3">
              <h3 className="text-xs font-semibold mb-1.5">
                {t("adminDashboard.realtime.liveCountries")}
              </h3>
              <RankedList
                rows={report.countries.map((c) => ({
                  id: c.code,
                  label: nameOf(c.code),
                  value: c.sessions,
                }))}
                labelHeader={t("adminDashboard.geo.colCountry")}
                valueHeader={t("adminDashboard.traffic.colSessions")}
                maxRows={6}
              />
            </Card>
          </div>
        </div>
      ) : null}
    </div>
  );
}
