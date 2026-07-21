/**
 * GA4 BI dashboard.
 *
 * Fires four parallel Data API reports (by date, sessionSource, country,
 * deviceCategory) plus one previous-period date report for delta computation.
 * All go through the existing `runGa4Report` server fn - no new backend
 * surface. Falls back to a friendly message when GA4 is not configured or the
 * report handler returns `error`.
 *
 * Charts:
 *   1. KPI row: sesje, aktywni użytkownicy, odsłony, wskaźnik zaangażowania
 *   2. Trend area: sesje vs użytkownicy vs odsłony
 *   3. Donut: źródła ruchu (sessionSource)
 *   4. Donut: kraje
 *   5. Donut: urządzenia
 *   6. Radar: zaangażowanie (5 metryk z tego samego okna)
 *   7. Bar rank: top strony wg odsłon
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import "@/lib/i18n-admin-analytics";
import { useServerFn } from "@tanstack/react-start";
import { useQueries } from "@tanstack/react-query";
import { Loader2, RefreshCw, BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { EChartsCoreOption } from "echarts/core";
import { runGa4Report, type Ga4Report } from "@/lib/analytics/ga4.functions";
import { ChartCard } from "./ChartCard";
import type { ChartClickParams, ChartDrillDetail } from "./ChartDrillDialog";
import { KpiTile } from "./KpiTile";
import { InsightSection } from "./InsightSection";
import { buildGa4Insights } from "./ga4Insights";

const CORE_METRICS = ["sessions", "activeUsers", "screenPageViews", "engagementRate"] as const;
type CoreMetric = (typeof CORE_METRICS)[number];

function parseNumber(v: string | undefined): number {
  if (v === undefined) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function totalsFromReport(report: Ga4Report | undefined): Record<CoreMetric, number> {
  const out = { sessions: 0, activeUsers: 0, screenPageViews: 0, engagementRate: 0 };
  if (!report) return out;
  for (let i = 0; i < report.metricHeaders.length; i++) {
    const name = report.metricHeaders[i] as CoreMetric;
    if (CORE_METRICS.includes(name)) out[name] = parseNumber(report.totals[i]);
  }
  return out;
}

export function Ga4BiDashboard({
  configured,
  activeMode,
}: {
  configured: boolean;
  activeMode?: string;
}) {
  const { t } = useTranslation();
  const fetchReport = useServerFn(runGa4Report);
  const [days, setDays] = useState<number>(28);

  const start = `${days}daysAgo`;
  const prevStart = `${days * 2}daysAgo`;
  const prevEnd = `${days}daysAgo`;

  const requests: Array<{
    key: string;
    dims: string[];
    metrics: string[];
    range: [string, string];
    limit: number;
  }> = [
    {
      key: "date",
      dims: ["date"],
      metrics: [...CORE_METRICS],
      range: [start, "today"],
      limit: 400,
    },
    {
      key: "date-prev",
      dims: ["date"],
      metrics: [...CORE_METRICS],
      range: [prevStart, prevEnd],
      limit: 400,
    },
    {
      key: "source",
      dims: ["sessionSource"],
      metrics: ["sessions"],
      range: [start, "today"],
      limit: 20,
    },
    {
      key: "country",
      dims: ["country"],
      metrics: ["sessions"],
      range: [start, "today"],
      limit: 30,
    },
    {
      key: "device",
      dims: ["deviceCategory"],
      metrics: ["sessions"],
      range: [start, "today"],
      limit: 10,
    },
    {
      key: "page",
      dims: ["pagePath"],
      metrics: ["screenPageViews", "engagementRate"],
      range: [start, "today"],
      limit: 20,
    },
    {
      key: "engagement",
      dims: [],
      metrics: [
        "engagementRate",
        "averageSessionDuration",
        "screenPageViewsPerSession",
        "bounceRate",
        "eventCount",
      ],
      range: [start, "today"],
      limit: 1,
    },
  ];

  const queries = useQueries({
    queries: requests.map((r) => ({
      queryKey: ["ga4-bi", days, r.key],
      queryFn: () =>
        fetchReport({
          data: {
            startDate: r.range[0],
            endDate: r.range[1],
            dimensions: r.dims,
            metrics: r.metrics,
            limit: r.limit,
          },
        }),
      enabled: configured,
      staleTime: 60_000,
    })),
  });

  const [dateQ, prevQ, sourceQ, countryQ, deviceQ, pageQ, engageQ] = queries;
  const anyLoading = queries.some((q) => q.isLoading);
  const anyError = queries.find((q) => q.data && "error" in q.data && q.data.error);

  const totals = useMemo(() => totalsFromReport(dateQ.data), [dateQ.data]);
  const prevTotals = useMemo(() => totalsFromReport(prevQ.data), [prevQ.data]);

  const trendOption = useMemo<EChartsCoreOption>(() => {
    const rows = (dateQ.data?.rows ?? [])
      .slice()
      .sort((a, b) => (a.dims[0] ?? "").localeCompare(b.dims[0] ?? ""));
    const dates = rows.map((r) => {
      const d = r.dims[0] ?? "";
      return d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : d;
    });
    const headers = dateQ.data?.metricHeaders ?? [];
    const idx = (m: CoreMetric): number => headers.indexOf(m);
    const idxSessions = idx("sessions");
    const idxUsers = idx("activeUsers");
    const idxViews = idx("screenPageViews");
    return {
      legend: {
        top: 4,
        data: [
          t("adminAnalytics.ga4.sessions"),
          t("adminAnalytics.ga4.activeUsers"),
          t("adminAnalytics.ga4.views"),
        ],
      },
      tooltip: { trigger: "axis" },
      dataZoom: [{ type: "inside", start: 0, end: 100 }],
      xAxis: { type: "category", data: dates, boundaryGap: false },
      yAxis: { type: "value" },
      series: [
        {
          name: t("adminAnalytics.ga4.sessions"),
          type: "line",
          smooth: true,
          areaStyle: { opacity: 0.2 },
          data: rows.map((r) => parseNumber(r.metrics[idxSessions])),
        },
        {
          name: t("adminAnalytics.ga4.activeUsers"),
          type: "line",
          smooth: true,
          data: rows.map((r) => parseNumber(r.metrics[idxUsers])),
        },
        {
          name: t("adminAnalytics.ga4.views"),
          type: "line",
          smooth: true,
          data: rows.map((r) => parseNumber(r.metrics[idxViews])),
        },
      ],
    };
  }, [dateQ.data, t]);

  const donutFrom = (report: Ga4Report | undefined, top = 8): EChartsCoreOption => {
    const rows = (report?.rows ?? []).slice();
    const idxSessions = (report?.metricHeaders ?? []).indexOf("sessions");
    if (idxSessions === -1) return { series: [] };
    rows.sort((a, b) => parseNumber(b.metrics[idxSessions]) - parseNumber(a.metrics[idxSessions]));
    const head = rows.slice(0, top);
    const rest = rows.slice(top);
    const data = head.map((r) => ({
      name: r.dims[0] || "?",
      value: parseNumber(r.metrics[idxSessions]),
    }));
    const other = rest.reduce((acc, r) => acc + parseNumber(r.metrics[idxSessions]), 0);
    if (other > 0) data.push({ name: t("adminAnalytics.ga4.other"), value: other });
    return {
      tooltip: {
        trigger: "item",
        formatter: (raw: unknown) => {
          const p = raw as { name: string; value: number; percent: number };
          return `${p.name}: <b>${p.value}</b> (${p.percent.toFixed(1)}%)`;
        },
      },
      legend: {
        orient: "vertical",
        right: 4,
        top: "middle",
        type: "scroll",
        textStyle: { fontSize: 11 },
      },
      series: [
        {
          type: "pie",
          radius: ["45%", "72%"],
          center: ["38%", "50%"],
          label: { show: false },
          labelLine: { show: false },
          itemStyle: { borderRadius: 4, borderWidth: 2, borderColor: "transparent" },
          data,
        },
      ],
    };
  };

  const radarOption = useMemo<EChartsCoreOption>(() => {
    const totals = engageQ.data?.totals ?? [];
    const headers = engageQ.data?.metricHeaders ?? [];
    const get = (m: string): number => {
      const i = headers.indexOf(m);
      return i >= 0 ? parseNumber(totals[i]) : 0;
    };
    const values = [
      get("engagementRate") * 100,
      Math.min(100, get("averageSessionDuration") / 3),
      Math.min(100, get("screenPageViewsPerSession") * 20),
      Math.max(0, 100 - get("bounceRate") * 100),
      Math.min(100, get("eventCount") / 50),
    ];
    return {
      tooltip: {},
      radar: {
        indicator: [
          { name: t("adminAnalytics.ga4.radar.engagement"), max: 100 },
          { name: t("adminAnalytics.ga4.radar.sessionTime"), max: 100 },
          { name: t("adminAnalytics.ga4.radar.viewsPerSession"), max: 100 },
          { name: t("adminAnalytics.ga4.radar.retention"), max: 100 },
          { name: t("adminAnalytics.ga4.radar.events"), max: 100 },
        ],
        radius: "62%",
        splitLine: { lineStyle: { color: "hsl(var(--border))" } },
        splitArea: { areaStyle: { color: ["rgba(0,0,0,0.02)", "rgba(0,0,0,0.05)"] } },
        axisName: { color: "hsl(var(--muted-foreground))", fontSize: 10 },
      },
      series: [
        {
          type: "radar",
          symbol: "circle",
          areaStyle: { opacity: 0.25 },
          data: [{ value: values, name: t("adminAnalytics.ga4.radar.seriesName", { days }) }],
        },
      ],
    };
  }, [engageQ.data, days, t]);

  const topPagesOption = useMemo<EChartsCoreOption>(() => {
    const rows = (pageQ.data?.rows ?? []).slice();
    const idxViews = (pageQ.data?.metricHeaders ?? []).indexOf("screenPageViews");
    rows.sort((a, b) => parseNumber(b.metrics[idxViews]) - parseNumber(a.metrics[idxViews]));
    const top = rows.slice(0, 15).reverse();
    return {
      grid: { left: 8, right: 20, top: 8, bottom: 24, containLabel: true },
      tooltip: { trigger: "axis" },
      xAxis: { type: "value" },
      yAxis: {
        type: "category",
        data: top.map((r) => (r.dims[0] ?? "/").slice(0, 40)),
        axisLabel: { fontSize: 11 },
      },
      series: [
        {
          type: "bar",
          data: top.map((r) => parseNumber(r.metrics[idxViews])),
          itemStyle: { borderRadius: [0, 4, 4, 0] },
        },
      ],
    };
  }, [pageQ.data]);

  // ---- Drill-down handlers ----
  const trendClick = (p: ChartClickParams): ChartDrillDetail | null => {
    const rows = (dateQ.data?.rows ?? [])
      .slice()
      .sort((a, b) => (a.dims[0] ?? "").localeCompare(b.dims[0] ?? ""));
    const idx = typeof p.dataIndex === "number" ? p.dataIndex : -1;
    const row = rows[idx];
    if (!row) return null;
    const raw = row.dims[0] ?? "";
    const date =
      raw.length === 8 ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : raw;
    const headers = dateQ.data?.metricHeaders ?? [];
    const val = (m: CoreMetric): number => parseNumber(row.metrics[headers.indexOf(m)]);
    return {
      title: t("adminAnalytics.ga4.charts.trendTitle"),
      subtitle: p.seriesName,
      date,
      metrics: [
        { label: t("adminAnalytics.ga4.sessions"), value: val("sessions").toLocaleString("pl-PL") },
        {
          label: t("adminAnalytics.ga4.activeUsers"),
          value: val("activeUsers").toLocaleString("pl-PL"),
        },
        {
          label: t("adminAnalytics.ga4.views"),
          value: val("screenPageViews").toLocaleString("pl-PL"),
        },
        {
          label: t("adminAnalytics.ga4.engagement"),
          value: `${(val("engagementRate") * 100).toFixed(1)}%`,
        },
      ],
    };
  };

  const donutClickFrom =
    (report: Ga4Report | undefined, dimLabel: string) =>
    (p: ChartClickParams): ChartDrillDetail | null => {
      if (typeof p.value !== "number" && typeof (p.data as { value?: unknown })?.value !== "number")
        return null;
      const name = p.name ?? "?";
      const value = typeof p.value === "number" ? p.value : (p.data as { value: number }).value;
      const total = (report?.rows ?? []).reduce(
        (acc, r) => acc + parseNumber(r.metrics[(report?.metricHeaders ?? []).indexOf("sessions")]),
        0,
      );
      const pct = total > 0 ? (value / total) * 100 : 0;
      return {
        title: name,
        subtitle: dimLabel,
        metrics: [
          { label: t("adminAnalytics.ga4.sessions"), value: value.toLocaleString("pl-PL") },
          { label: "%", value: `${pct.toFixed(1)}%` },
        ],
      };
    };

  const topPagesClick = (p: ChartClickParams): ChartDrillDetail | null => {
    const rows = (pageQ.data?.rows ?? []).slice();
    const headers = pageQ.data?.metricHeaders ?? [];
    const idxViews = headers.indexOf("screenPageViews");
    const idxEng = headers.indexOf("engagementRate");
    rows.sort((a, b) => parseNumber(b.metrics[idxViews]) - parseNumber(a.metrics[idxViews]));
    const top = rows.slice(0, 15).reverse();
    const idx = typeof p.dataIndex === "number" ? p.dataIndex : -1;
    const row = top[idx];
    if (!row) return null;
    const path = row.dims[0] ?? "/";
    return {
      title: path,
      subtitle: t("adminAnalytics.ga4.charts.topPagesTitle"),
      url: path,
      urlLabel: path,
      metrics: [
        {
          label: t("adminAnalytics.ga4.views"),
          value: parseNumber(row.metrics[idxViews]).toLocaleString("pl-PL"),
        },
        {
          label: t("adminAnalytics.ga4.engagement"),
          value: `${(parseNumber(row.metrics[idxEng]) * 100).toFixed(1)}%`,
        },
      ],
      links: [{ href: path, label: t("adminAnalytics.drillDialog.openInNewTab"), external: false }],
    };
  };

  const modeText =
    activeMode === "oauth_refresh"
      ? t("adminAnalytics.ga4.modeOauth")
      : t("adminAnalytics.ga4.modeServiceAccount");

  if (!configured) {
    return (
      <Card className="p-6 text-sm text-muted-foreground">
        {t("adminAnalytics.ga4.notConfiguredPre")}
        <b>{t("adminAnalytics.ga4.notConfiguredTab")}</b>
        {t("adminAnalytics.ga4.notConfiguredPost")}
      </Card>
    );
  }

  if (anyError && anyError.data && "error" in anyError.data) {
    return (
      <Card className="p-6 text-sm text-destructive">
        {t("adminAnalytics.ga4.apiError", {
          error: String((anyError.data as { error?: string }).error),
        })}
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="text-xs text-muted-foreground block mb-1">
            {t("adminAnalytics.ga4.window")}
          </label>
          <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
            <SelectTrigger className="h-9 text-sm w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">{t("adminAnalytics.timeRange.preset7d")}</SelectItem>
              <SelectItem value="14">{t("adminAnalytics.timeRange.preset14d")}</SelectItem>
              <SelectItem value="28">{t("adminAnalytics.timeRange.preset28d")}</SelectItem>
              <SelectItem value="90">{t("adminAnalytics.timeRange.preset90d")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => queries.forEach((q) => q.refetch())}
          className="h-9"
        >
          <RefreshCw className="w-3.5 h-3.5 mr-2" /> {t("adminAnalytics.common.refresh")}
        </Button>
        <div className="text-xs text-muted-foreground inline-flex items-center gap-1">
          <BarChart3 className="w-3 h-3" /> {t("adminAnalytics.ga4.modeLabel")}
          {modeText}
        </div>
        {anyLoading ? (
          <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
            <Loader2 className="w-3 h-3 animate-spin" /> {t("adminAnalytics.common.loading")}
          </span>
        ) : null}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiTile
          label={t("adminAnalytics.ga4.sessions")}
          value={totals.sessions.toLocaleString("pl-PL")}
          current={totals.sessions}
          previous={prevTotals.sessions}
        />
        <KpiTile
          label={t("adminAnalytics.ga4.activeUsers")}
          value={totals.activeUsers.toLocaleString("pl-PL")}
          current={totals.activeUsers}
          previous={prevTotals.activeUsers}
        />
        <KpiTile
          label={t("adminAnalytics.ga4.views")}
          value={totals.screenPageViews.toLocaleString("pl-PL")}
          current={totals.screenPageViews}
          previous={prevTotals.screenPageViews}
        />
        <KpiTile
          label={t("adminAnalytics.ga4.engagement")}
          value={`${(totals.engagementRate * 100).toFixed(1)}%`}
          current={totals.engagementRate}
          previous={prevTotals.engagementRate}
          absoluteDelta
          deltaSuffix="pp"
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <ChartCard
          title={t("adminAnalytics.ga4.charts.trendTitle")}
          subtitle={t("adminAnalytics.ga4.charts.trendSubtitle")}
          option={trendOption}
          height={320}
          className="xl:col-span-2"
          onDataClick={trendClick}
        />
        <ChartCard
          title={t("adminAnalytics.ga4.charts.engagementTitle")}
          subtitle={t("adminAnalytics.ga4.charts.engagementSubtitle")}
          option={radarOption}
          height={320}
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <ChartCard
          title={t("adminAnalytics.ga4.charts.sourcesTitle")}
          subtitle={t("adminAnalytics.ga4.charts.sourcesSubtitle")}
          option={donutFrom(sourceQ.data)}
          height={280}
          onDataClick={donutClickFrom(sourceQ.data, t("adminAnalytics.ga4.charts.sourcesTitle"))}
        />
        <ChartCard
          title={t("adminAnalytics.ga4.charts.countriesTitle")}
          subtitle={t("adminAnalytics.ga4.charts.countriesSubtitle")}
          option={donutFrom(countryQ.data)}
          height={280}
          onDataClick={donutClickFrom(countryQ.data, t("adminAnalytics.ga4.charts.countriesTitle"))}
        />
        <ChartCard
          title={t("adminAnalytics.ga4.charts.devicesTitle")}
          subtitle={t("adminAnalytics.ga4.charts.devicesSubtitle")}
          option={donutFrom(deviceQ.data, 5)}
          height={280}
          onDataClick={donutClickFrom(deviceQ.data, t("adminAnalytics.ga4.charts.devicesTitle"))}
        />
      </div>

      <ChartCard
        title={t("adminAnalytics.ga4.charts.topPagesTitle")}
        subtitle={t("adminAnalytics.ga4.charts.topPagesSubtitle")}
        option={topPagesOption}
        height={340}
        onDataClick={topPagesClick}
      />

      {/* Interpretacja + rekomendacje per element dashboardu */}
      <InsightSection
        subtitle={t("adminAnalytics.ga4.insightsSubtitle", { days, mode: modeText })}
        insights={buildGa4Insights({
          dateReport: dateQ.data,
          prevReport: prevQ.data,
          sourceReport: sourceQ.data,
          countryReport: countryQ.data,
          deviceReport: deviceQ.data,
          pageReport: pageQ.data,
          engagementReport: engageQ.data,
          windowDays: days,
          t,
        })}
      />
    </div>
  );
}
