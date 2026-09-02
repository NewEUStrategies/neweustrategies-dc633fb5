/**
 * Kompaktowy pasek analityki modułu 17 do osadzania POZA /admin/analytics.
 *
 * Po co osobny komponent zamiast wstawiania pełnych dashboardów: strona
 * startowa panelu i ekrany modułowe mają pokazać SYGNAŁ (czy coś się psuje,
 * czy strona jest szybka), a nie cały warsztat BI. Pasek czyta DOKŁADNIE te
 * same funkcje serwerowe co pełne dashboardy (`getVitalsSummary`,
 * `getClientErrorsReport`), więc liczby nigdy nie rozjadą się z /admin/analytics.
 *
 * ECharts wchodzi tu wyłącznie przez `ChartCard` -> `EChart`, czyli lazy po
 * stronie klienta - graf SSR nie dotyka echarts (patrz komentarz w EChart.tsx).
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import type { EChartsCoreOption } from "echarts/core";

import "@/lib/i18n-admin-analytics";
import { Card } from "@/components/ui/card";
import { ChartCard } from "./ChartCard";
import { useChartTheme } from "./useChartTheme";
import { getVitalsSummary } from "@/lib/observability/vitals.functions";
import { getClientErrorsReport } from "@/lib/observability/clientErrors.functions";

export interface AdminBiStripProps {
  /** Okno analityczne w dniach (domyślnie 14). */
  days?: number;
  /** Czy pokazać link do pełnego panelu BI (domyślnie tak). */
  showLink?: boolean;
  className?: string;
}

function KpiTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="p-3">
      <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
      <div className="text-xl font-bold font-display leading-tight mt-0.5">{value}</div>
      {hint ? <div className="text-[10px] text-muted-foreground mt-0.5">{hint}</div> : null}
    </Card>
  );
}

export function AdminBiStrip({ days = 14, showLink = true, className }: AdminBiStripProps) {
  const { t } = useTranslation();
  const theme = useChartTheme();
  const fetchVitals = useServerFn(getVitalsSummary);
  const fetchErrors = useServerFn(getClientErrorsReport);

  const vitalsQ = useQuery({
    queryKey: ["admin-bi-strip", "vitals", days],
    queryFn: () => fetchVitals({ data: { days } }),
    staleTime: 120_000,
  });
  const errorsQ = useQuery({
    queryKey: ["admin-bi-strip", "errors", days],
    queryFn: () => fetchErrors({ data: { days } }),
    staleTime: 120_000,
  });

  const lcp = vitalsQ.data?.metrics.find((m) => m.metric === "LCP");
  const trend = useMemo(
    () =>
      (vitalsQ.data?.trends ?? [])
        .map((p) => ({ day: p.day, value: p.p75.LCP }))
        .filter((p): p is { day: string; value: number } => typeof p.value === "number"),
    [vitalsQ.data],
  );

  const lcpOption: EChartsCoreOption = useMemo(
    () => ({
      tooltip: { trigger: "axis" },
      grid: { left: 44, right: 12, top: 16, bottom: 28 },
      xAxis: { type: "category", data: trend.map((p) => p.day.slice(5)) },
      yAxis: { type: "value", axisLabel: { formatter: "{value} ms" } },
      series: [
        {
          type: "line",
          smooth: true,
          showSymbol: false,
          data: trend.map((p) => p.value),
          lineStyle: { width: 2, color: theme.primary },
          itemStyle: { color: theme.primary },
          areaStyle: { opacity: 0.12, color: theme.primary },
          markLine: {
            silent: true,
            symbol: "none",
            lineStyle: { color: theme.success, type: "dashed" },
            data: [{ yAxis: 2500 }],
          },
        },
      ],
    }),
    [trend, theme],
  );

  const daily = errorsQ.data?.daily ?? [];
  const errorsOption: EChartsCoreOption = useMemo(
    () => ({
      tooltip: { trigger: "axis" },
      grid: { left: 44, right: 12, top: 16, bottom: 28 },
      xAxis: { type: "category", data: daily.map((d) => d.day.slice(5)) },
      yAxis: { type: "value" },
      series: [
        {
          type: "bar",
          data: daily.map((d) => d.count),
          itemStyle: { color: theme.danger, borderRadius: [3, 3, 0, 0] },
        },
      ],
    }),
    [daily, theme],
  );

  return (
    <section className={className}>
      <div className="flex flex-wrap items-end justify-between gap-2 mb-2">
        <div>
          <h2 className="font-display text-base font-bold">{t("adminAnalytics.bi.stripTitle")}</h2>
          <p className="text-[11px] text-muted-foreground">
            {t("adminAnalytics.bi.stripSubtitle", { days })}
          </p>
        </div>
        {showLink ? (
          <Link to="/admin/analytics/bi" className="text-xs text-primary hover:underline">
            {t("adminAnalytics.bi.openFull")}
          </Link>
        ) : null}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        <KpiTile
          label={t("adminAnalytics.bi.kpi.samples")}
          value={String(vitalsQ.data?.windowTotal ?? 0)}
        />
        <KpiTile
          label={t("adminAnalytics.bi.kpi.lcp")}
          value={lcp ? `${Math.round(lcp.p75)} ms` : "-"}
          hint={lcp ? lcp.rating : undefined}
        />
        <KpiTile
          label={t("adminAnalytics.bi.kpi.errors")}
          value={String(errorsQ.data?.windowTotal ?? 0)}
        />
        <KpiTile
          label={t("adminAnalytics.bi.kpi.errorGroups")}
          value={String(errorsQ.data?.uniqueGroups ?? 0)}
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-2.5 mt-2.5">
        <ChartCard
          title={t("adminAnalytics.bi.charts.lcpTrend")}
          subtitle={t("adminAnalytics.bi.charts.lcpTrendSub")}
          option={lcpOption}
          height={220}
          csv={{
            filename: "lcp-p75",
            headers: [t("adminAnalytics.bi.cols.day"), t("adminAnalytics.bi.cols.value")],
            rows: trend.map((p) => [p.day, p.value]),
          }}
        />
        <ChartCard
          title={t("adminAnalytics.bi.charts.errorsDaily")}
          subtitle={t("adminAnalytics.bi.charts.errorsDailySub")}
          option={errorsOption}
          height={220}
          csv={{
            filename: "client-errors-daily",
            headers: [t("adminAnalytics.bi.cols.day"), t("adminAnalytics.bi.cols.count")],
            rows: daily.map((d) => [d.day, d.count]),
          }}
        />
      </div>
    </section>
  );
}
