/**
 * Dashboard telemetrii błędów przeglądarki (client_errors).
 *
 * Domyka pętlę obserwowalności obok RUM: ta sama estetyka BI co Web Vitals
 * (KpiTile + ChartCard + TimeRangeFilter), dane z getClientErrorsReport
 * (server function; service role za bramką admina, tenant-scoped).
 *
 * Sekcje:
 *  1. KPI: błędy w oknie (ze sparkline'em dziennym), unikalne problemy,
 *     dotknięte ścieżki, ostatnie 24 h.
 *  2. Trend dzienny (bar) z eksportem CSV.
 *  3. Problemy wg częstości: grupy po znormalizowanym komunikacie,
 *     rozwijane do stacka, ścieżek i metadanych.
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import "@/lib/i18n-admin-analytics";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Bug,
  ChevronDown,
  FileWarning,
  Loader2,
  RefreshCw,
  Route as RouteIcon,
} from "lucide-react";
import type { EChartsCoreOption } from "echarts/core";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { getClientErrorsReport } from "@/lib/observability/clientErrors.functions";
import type { ClientErrorGroup } from "@/lib/observability/clientErrorsAggregate";
import { ChartCard } from "./ChartCard";
import { KpiTile } from "./KpiTile";
import { TimeRangeFilter, buildPresetRange, type TimeRangeValue } from "./TimeRangeFilter";

export function ClientErrorsDashboard() {
  const { t, i18n } = useTranslation();
  const fetchReport = useServerFn(getClientErrorsReport);
  const [range, setRange] = useState<TimeRangeValue>(() => buildPresetRange("7d"));

  const reportQuery = useQuery({
    queryKey: ["admin", "client-errors", range.sinceIso, range.untilIso],
    queryFn: () => fetchReport({ data: { sinceIso: range.sinceIso, untilIso: range.untilIso } }),
    staleTime: 60_000,
  });

  const report = reportQuery.data;
  const locale = i18n.language === "en" ? "en-GB" : "pl-PL";

  const trendOption = useMemo<EChartsCoreOption>(() => {
    const days = report?.daily ?? [];
    return {
      grid: { left: 44, right: 16, top: 24, bottom: 28, containLabel: true },
      xAxis: {
        type: "category",
        data: days.map((d) => d.day.slice(5)),
      },
      yAxis: { type: "value", minInterval: 1 },
      series: [
        {
          name: t("adminAnalytics.clientErrors.trendSeries"),
          type: "bar",
          barMaxWidth: 26,
          itemStyle: { borderRadius: [4, 4, 0, 0], color: "#dc2626" },
          data: days.map((d) => d.count),
        },
      ],
    };
  }, [report, t]);

  const kpiSeries = useMemo(() => (report?.daily ?? []).map((d) => d.count), [report]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <TimeRangeFilter value={range} onChange={setRange} />
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          onClick={() => void reportQuery.refetch()}
          disabled={reportQuery.isFetching}
        >
          {reportQuery.isFetching ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden />
          )}
          {t("adminAnalytics.common.refresh")}
        </Button>
      </div>

      {report?.capped && (
        <div className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {t("adminAnalytics.clientErrors.cappedNote", {
            cap: report.total.toLocaleString(locale),
            total: report.windowTotal.toLocaleString(locale),
          })}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <KpiTile
          label={t("adminAnalytics.clientErrors.kpiTotal")}
          value={(report?.windowTotal ?? 0).toLocaleString(locale)}
          series={kpiSeries}
          higherIsBetter={false}
          icon={<Bug className="h-3.5 w-3.5" aria-hidden />}
        />
        <KpiTile
          label={t("adminAnalytics.clientErrors.kpiGroups")}
          value={(report?.uniqueGroups ?? 0).toLocaleString(locale)}
          higherIsBetter={false}
          icon={<FileWarning className="h-3.5 w-3.5" aria-hidden />}
        />
        <KpiTile
          label={t("adminAnalytics.clientErrors.kpiPaths")}
          value={(report?.affectedPaths ?? 0).toLocaleString(locale)}
          higherIsBetter={false}
          icon={<RouteIcon className="h-3.5 w-3.5" aria-hidden />}
        />
        <KpiTile
          label={t("adminAnalytics.clientErrors.kpiLast24h")}
          value={(report?.last24h ?? 0).toLocaleString(locale)}
          higherIsBetter={false}
          icon={<AlertTriangle className="h-3.5 w-3.5" aria-hidden />}
        />
      </div>

      <ChartCard
        title={t("adminAnalytics.clientErrors.trendTitle")}
        subtitle={t("adminAnalytics.clientErrors.trendSubtitle")}
        option={trendOption}
        height={240}
        csv={{
          filename: "client-errors-daily",
          headers: ["day", "count"],
          rows: (report?.daily ?? []).map((d) => [d.day, d.count]),
        }}
      />

      <Card className="p-4">
        <div className="mb-3">
          <h3 className="text-sm font-semibold">{t("adminAnalytics.clientErrors.groupsTitle")}</h3>
          <p className="text-xs text-muted-foreground">
            {t("adminAnalytics.clientErrors.groupsSubtitle")}
          </p>
        </div>
        {reportQuery.isLoading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            {t("adminAnalytics.common.loadingData")}
          </div>
        ) : !report || report.groups.length === 0 ? (
          <p className="py-6 text-sm text-muted-foreground">
            {t("adminAnalytics.clientErrors.empty")}
          </p>
        ) : (
          <ul className="divide-y divide-border/60">
            {report.groups.map((group) => (
              <ErrorGroupRow
                key={group.fingerprint}
                group={group}
                windowTotal={Math.max(1, report.total)}
                locale={locale}
              />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function ErrorGroupRow({
  group,
  windowTotal,
  locale,
}: {
  group: ClientErrorGroup;
  windowTotal: number;
  locale: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const share = Math.round((group.count / windowTotal) * 100);
  const lastSeen = new Intl.DateTimeFormat(locale, {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(group.lastSeen));
  const firstSeen = new Intl.DateTimeFormat(locale, {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(group.firstSeen));

  return (
    <li className="py-2.5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="grid w-full grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 text-left sm:grid-cols-[minmax(0,1fr)_90px_120px_auto_16px]"
        title={
          open ? t("adminAnalytics.clientErrors.collapse") : t("adminAnalytics.clientErrors.expand")
        }
      >
        <span className="min-w-0 truncate font-mono text-xs" title={group.message}>
          {group.message}
        </span>
        <span className="justify-self-end text-sm font-semibold tabular-nums">
          {group.count.toLocaleString(locale)}
        </span>
        <span className="col-span-2 flex items-center gap-2 sm:col-span-1">
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <span
              className="block h-full rounded-full bg-destructive/70"
              style={{ width: `${Math.max(2, share)}%` }}
            />
          </span>
          <span className="w-9 text-right text-[11px] tabular-nums text-muted-foreground">
            {share}%
          </span>
        </span>
        <span className="hidden items-center gap-1 sm:flex">
          {group.sources.map((source) => (
            <Badge key={source} variant="outline" className="px-1.5 py-0 text-[10px] font-normal">
              {t(`adminAnalytics.clientErrors.sourceLabels.${source}`, {
                defaultValue: source,
              })}
            </Badge>
          ))}
        </span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 justify-self-end text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
          aria-hidden
        />
      </button>

      {open && (
        <div className="mt-2 space-y-2 rounded-md bg-muted/40 p-3 text-xs">
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
            <span>
              {t("adminAnalytics.clientErrors.firstSeen")}:{" "}
              <span className="tabular-nums text-foreground">{firstSeen}</span>
            </span>
            <span>
              {t("adminAnalytics.clientErrors.colLastSeen")}:{" "}
              <span className="tabular-nums text-foreground">{lastSeen}</span>
            </span>
          </div>
          {group.topPaths.length > 0 && (
            <div>
              <div className="mb-1 font-medium">{t("adminAnalytics.clientErrors.topPaths")}</div>
              <ul className="space-y-0.5">
                {group.topPaths.map((p) => (
                  <li key={p.path} className="flex items-center gap-2">
                    <code className="min-w-0 truncate font-mono text-[11px]">{p.path}</code>
                    <span className="tabular-nums text-muted-foreground">×{p.count}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <div className="mb-1 font-medium">{t("adminAnalytics.clientErrors.stack")}</div>
            {group.sampleStack ? (
              <pre className="max-h-56 overflow-auto rounded bg-background p-2 font-mono text-[11px] leading-relaxed">
                {group.sampleStack}
              </pre>
            ) : (
              <p className="text-muted-foreground">{t("adminAnalytics.clientErrors.noStack")}</p>
            )}
          </div>
        </div>
      )}
    </li>
  );
}
