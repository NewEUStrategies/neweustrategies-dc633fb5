/**
 * GSC BI dashboard.
 *
 * Fires five parallel Search Analytics queries (by date / query / page / country
 * / device) plus a sixth query over the previous window to compute delta %
 * against the primary window. All queries use the existing `queryGscAnalytics`
 * server fn, so no new server surface is added.
 *
 * Charts:
 *   1. KPI row (clicks, impressions, CTR, avg. position) with delta + sparkline
 *   2. Trend area chart - clicks vs impressions dual-axis
 *   3. Horizontal bar rank - top 15 queries by clicks
 *   4. Position histogram (buckets 1-3 / 4-10 / 11-20 / 21-50 / 51+)
 *   5. Donut - country distribution (top 8 + "inne")
 *   6. Donut - device distribution
 *   7. Treemap - top 20 pages by impressions with CTR colour scale
 *   8. Calendar heatmap - daily clicks activity
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import "@/lib/i18n-admin-analytics";
import { useServerFn } from "@tanstack/react-start";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Loader2, RefreshCw, Search as SearchIcon } from "lucide-react";
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
import { listGscSites, queryGscAnalytics, type GscRow } from "@/lib/analytics/gsc.functions";
import { ChartCard } from "./ChartCard";
import type { ChartClickParams, ChartDrillDetail } from "./ChartDrillDialog";
import { KpiTile } from "./KpiTile";
import { InsightSection } from "./InsightSection";
import { buildGscInsights } from "./gscInsights";

function daysAgoISO(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}
function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

interface Totals {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

function totalsOf(rows: GscRow[]): Totals {
  let clicks = 0;
  let impressions = 0;
  let posWeighted = 0;
  for (const r of rows) {
    clicks += r.clicks;
    impressions += r.impressions;
    posWeighted += r.position * Math.max(r.impressions, 1);
  }
  const ctr = impressions > 0 ? clicks / impressions : 0;
  const position = impressions > 0 ? posWeighted / impressions : 0;
  return { clicks, impressions, ctr, position };
}

const POSITION_BUCKETS = [
  { label: "1-3", min: 1, max: 3 },
  { label: "4-10", min: 4, max: 10 },
  { label: "11-20", min: 11, max: 20 },
  { label: "21-50", min: 21, max: 50 },
  { label: "51+", min: 51, max: Number.POSITIVE_INFINITY },
];

export function GscBiDashboard({ configured }: { configured: boolean }) {
  const { t } = useTranslation();
  const fetchSites = useServerFn(listGscSites);
  const fetchAnalytics = useServerFn(queryGscAnalytics);
  const [siteUrl, setSiteUrl] = useState<string>("");
  const [days, setDays] = useState<number>(28);

  const sitesQ = useQuery({
    queryKey: ["gsc-sites"],
    queryFn: () => fetchSites(),
    enabled: configured,
  });

  const sites = sitesQ.data?.sites ?? [];
  const preferredSite = useMemo(() => {
    const match = sites.find((s) => s.siteUrl.toLowerCase().includes("neweuropeanstrategies.com"));
    return match?.siteUrl ?? sites[0]?.siteUrl ?? "";
  }, [sites]);
  const effectiveSite = siteUrl || preferredSite;

  const startDate = daysAgoISO(days);
  const prevStart = daysAgoISO(days * 2);
  const prevEnd = daysAgoISO(days);

  const dims: Array<"date" | "query" | "page" | "country" | "device"> = [
    "date",
    "query",
    "page",
    "country",
    "device",
  ];

  const queries = useQueries({
    queries: [
      ...dims.map((d) => ({
        queryKey: ["gsc-bi", effectiveSite, days, d],
        queryFn: () =>
          fetchAnalytics({
            data: {
              siteUrl: effectiveSite,
              startDate,
              endDate: todayISO(),
              dimensions: [d],
              rowLimit: d === "date" ? 400 : 200,
            },
          }),
        enabled: Boolean(effectiveSite),
        staleTime: 60_000,
      })),
      {
        queryKey: ["gsc-bi", effectiveSite, days, "date-prev"],
        queryFn: () =>
          fetchAnalytics({
            data: {
              siteUrl: effectiveSite,
              startDate: prevStart,
              endDate: prevEnd,
              dimensions: ["date" as const],
              rowLimit: 400,
            },
          }),
        enabled: Boolean(effectiveSite),
        staleTime: 60_000,
      },
    ],
  });

  const [dateQ, queryQ, pageQ, countryQ, deviceQ, prevDateQ] = queries;
  const anyLoading = queries.some((q) => q.isLoading);
  const dateRows = dateQ.data?.rows ?? [];
  const queryRows = queryQ.data?.rows ?? [];
  const pageRows = pageQ.data?.rows ?? [];
  const countryRows = countryQ.data?.rows ?? [];
  const deviceRows = deviceQ.data?.rows ?? [];
  const prevRows = prevDateQ.data?.rows ?? [];

  const totals = useMemo(() => totalsOf(dateRows), [dateRows]);
  const prevTotals = useMemo(() => totalsOf(prevRows), [prevRows]);

  const trendOption = useMemo<EChartsCoreOption>(() => {
    const sorted = dateRows
      .slice()
      .sort((a, b) => (a.keys[0] ?? "").localeCompare(b.keys[0] ?? ""));
    return {
      legend: {
        data: [t("adminAnalytics.gsc.clicks"), t("adminAnalytics.gsc.impressions"), "CTR"],
        top: 4,
      },
      tooltip: { trigger: "axis" },
      grid: { left: 44, right: 60, top: 32, bottom: 40, containLabel: true },
      xAxis: {
        type: "category",
        data: sorted.map((r) => r.keys[0] ?? ""),
        boundaryGap: false,
      },
      yAxis: [
        { type: "value", name: t("adminAnalytics.gsc.clicks"), nameTextStyle: { fontSize: 10 } },
        {
          type: "value",
          name: t("adminAnalytics.gsc.impressions"),
          nameTextStyle: { fontSize: 10 },
          splitLine: { show: false },
        },
        {
          type: "value",
          name: t("adminAnalytics.gsc.ctrPct"),
          nameTextStyle: { fontSize: 10 },
          show: false,
          max: 100,
        },
      ],
      dataZoom: [{ type: "inside", start: 0, end: 100 }],
      series: [
        {
          name: t("adminAnalytics.gsc.clicks"),
          type: "line",
          smooth: true,
          areaStyle: { opacity: 0.25 },
          data: sorted.map((r) => r.clicks),
          yAxisIndex: 0,
          symbol: "circle",
          symbolSize: 4,
        },
        {
          name: t("adminAnalytics.gsc.impressions"),
          type: "line",
          smooth: true,
          data: sorted.map((r) => r.impressions),
          yAxisIndex: 1,
          symbol: "circle",
          symbolSize: 4,
        },
        {
          name: "CTR",
          type: "line",
          smooth: true,
          data: sorted.map((r) => Number((r.ctr * 100).toFixed(2))),
          yAxisIndex: 2,
          symbol: "none",
          lineStyle: { type: "dashed", width: 1 },
        },
      ],
    };
  }, [dateRows, t]);

  const topQueriesOption = useMemo<EChartsCoreOption>(() => {
    const top = queryRows
      .slice()
      .sort((a, b) => b.clicks - a.clicks)
      .slice(0, 15)
      .reverse();
    return {
      grid: { left: 8, right: 20, top: 8, bottom: 24, containLabel: true },
      tooltip: {
        trigger: "axis",
        formatter: (raw: unknown) => {
          const arr = raw as Array<{ name: string; value: number; dataIndex: number }>;
          const r = top[arr[0]?.dataIndex ?? 0];
          if (!r) return "";
          return `${r.keys[0] ?? ""}<br/>${t("adminAnalytics.gsc.clicksLabel")}<b>${r.clicks}</b><br/>${t("adminAnalytics.gsc.impressionsLabel")}${r.impressions}<br/>${t("adminAnalytics.gsc.ctrLabel")}${(r.ctr * 100).toFixed(2)}%<br/>${t("adminAnalytics.gsc.positionLabel")}${r.position.toFixed(1)}`;
        },
      },
      xAxis: { type: "value" },
      yAxis: {
        type: "category",
        data: top.map((r) => (r.keys[0] ?? "").slice(0, 40)),
        axisLabel: { fontSize: 11 },
      },
      series: [
        {
          type: "bar",
          data: top.map((r) => r.clicks),
          itemStyle: { borderRadius: [0, 4, 4, 0] },
        },
      ],
    };
  }, [queryRows, t]);

  const positionHistogramOption = useMemo<EChartsCoreOption>(() => {
    const buckets = POSITION_BUCKETS.map((b) => ({ ...b, impressions: 0, clicks: 0 }));
    for (const r of queryRows) {
      const b = buckets.find((x) => r.position >= x.min && r.position <= x.max);
      if (!b) continue;
      b.impressions += r.impressions;
      b.clicks += r.clicks;
    }
    return {
      legend: {
        data: [t("adminAnalytics.gsc.impressions"), t("adminAnalytics.gsc.clicks")],
        top: 4,
      },
      tooltip: { trigger: "axis" },
      xAxis: { type: "category", data: buckets.map((b) => b.label) },
      yAxis: [{ type: "value" }, { type: "value", splitLine: { show: false } }],
      series: [
        {
          name: t("adminAnalytics.gsc.impressions"),
          type: "bar",
          data: buckets.map((b) => b.impressions),
          itemStyle: { borderRadius: [4, 4, 0, 0] },
        },
        {
          name: t("adminAnalytics.gsc.clicks"),
          type: "line",
          yAxisIndex: 1,
          data: buckets.map((b) => b.clicks),
          smooth: true,
        },
      ],
    };
  }, [queryRows, t]);

  const donutOption = (rows: GscRow[], title: string): EChartsCoreOption => {
    const top = rows
      .slice()
      .sort((a, b) => b.clicks - a.clicks)
      .slice(0, 8);
    const otherClicks = rows.slice(8).reduce((acc, r) => acc + r.clicks, 0);
    const data = top.map((r) => ({ name: r.keys[0] ?? "?", value: r.clicks }));
    if (otherClicks > 0) data.push({ name: t("adminAnalytics.gsc.other"), value: otherClicks });
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
          name: title,
          type: "pie",
          radius: ["45%", "72%"],
          center: ["38%", "50%"],
          avoidLabelOverlap: true,
          label: { show: false },
          labelLine: { show: false },
          itemStyle: { borderRadius: 4, borderWidth: 2, borderColor: "transparent" },
          data,
        },
      ],
    };
  };

  const treemapOption = useMemo<EChartsCoreOption>(() => {
    const top = pageRows
      .slice()
      .sort((a, b) => b.impressions - a.impressions)
      .slice(0, 20);
    return {
      tooltip: {
        formatter: (raw: unknown) => {
          const p = raw as { name: string; value: number; data: { ctr: number; clicks: number } };
          return `${p.name}<br/>${t("adminAnalytics.gsc.impressionsLabel")}<b>${p.value}</b><br/>${t("adminAnalytics.gsc.clicksLabel")}${p.data.clicks}<br/>${t("adminAnalytics.gsc.ctrLabel")}${(p.data.ctr * 100).toFixed(2)}%`;
        },
      },
      series: [
        {
          type: "treemap",
          roam: false,
          nodeClick: false,
          breadcrumb: { show: false },
          label: { show: true, formatter: "{b}", fontSize: 10, color: "#fff" },
          upperLabel: { show: false },
          itemStyle: { borderColor: "hsl(var(--background))", borderWidth: 2, gapWidth: 2 },
          levels: [{ colorSaturation: [0.35, 0.7] }],
          data: top.map((r) => {
            const raw = r.keys[0] ?? "/";
            const path = raw.replace(/^https?:\/\/[^/]+/, "");
            return {
              name: path.length > 30 ? path.slice(0, 30) + "…" : path,
              value: r.impressions,
              ctr: r.ctr,
              clicks: r.clicks,
              position: r.position,
              fullPath: path,
              rawUrl: raw,
            };
          }),
        },
      ],
    };
  }, [pageRows, t]);

  const calendarOption = useMemo<EChartsCoreOption>(() => {
    if (!dateRows.length) return { series: [] };
    const sorted = dateRows
      .slice()
      .sort((a, b) => (a.keys[0] ?? "").localeCompare(b.keys[0] ?? ""));
    const data = sorted.map((r) => [r.keys[0] ?? "", r.clicks]);
    const max = Math.max(1, ...sorted.map((r) => r.clicks));
    const first = sorted[0]?.keys[0] ?? todayISO();
    const last = sorted[sorted.length - 1]?.keys[0] ?? todayISO();
    return {
      tooltip: {
        formatter: (raw: unknown) => {
          const p = raw as { value: [string, number] };
          return `${p.value[0]}: <b>${p.value[1]}</b> ${t("adminAnalytics.gsc.clicksShort")}`;
        },
      },
      visualMap: {
        min: 0,
        max,
        show: false,
        inRange: { color: ["#e0e7ff", "#4f46e5", "#312e81"] },
      },
      calendar: {
        top: 30,
        left: 30,
        right: 20,
        cellSize: ["auto", 14],
        range: [first, last],
        itemStyle: { borderWidth: 1, borderColor: "hsl(var(--background))" },
        splitLine: { show: false },
        yearLabel: { show: false },
        dayLabel: { color: "hsl(var(--muted-foreground))", fontSize: 10 },
        monthLabel: { color: "hsl(var(--muted-foreground))", fontSize: 10 },
      },
      series: [{ type: "heatmap", coordinateSystem: "calendar", data }],
    };
  }, [dateRows, t]);

  // ---- Drill-down handlers ----
  const gscRowMetrics = (r: GscRow) => [
    { label: t("adminAnalytics.gsc.clicks"), value: r.clicks.toLocaleString("pl-PL") },
    { label: t("adminAnalytics.gsc.impressions"), value: r.impressions.toLocaleString("pl-PL") },
    { label: "CTR", value: `${(r.ctr * 100).toFixed(2)}%` },
    { label: t("adminAnalytics.gsc.avgPosition"), value: r.position.toFixed(1) },
  ];

  const trendClick = (p: ChartClickParams): ChartDrillDetail | null => {
    const sorted = dateRows
      .slice()
      .sort((a, b) => (a.keys[0] ?? "").localeCompare(b.keys[0] ?? ""));
    const idx = typeof p.dataIndex === "number" ? p.dataIndex : -1;
    const row = sorted[idx];
    if (!row) return null;
    return {
      title: t("adminAnalytics.gsc.charts.trendTitle"),
      subtitle: p.seriesName,
      date: row.keys[0] ?? "",
      metrics: gscRowMetrics(row),
    };
  };

  const topQueriesClick = (p: ChartClickParams): ChartDrillDetail | null => {
    const top = queryRows.slice().sort((a, b) => b.clicks - a.clicks).slice(0, 15).reverse();
    const idx = typeof p.dataIndex === "number" ? p.dataIndex : -1;
    const row = top[idx];
    if (!row) return null;
    return {
      title: row.keys[0] ?? "",
      subtitle: t("adminAnalytics.gsc.charts.topQueriesTitle"),
      metrics: gscRowMetrics(row),
    };
  };

  const positionBucketClick = (p: ChartClickParams): ChartDrillDetail | null => {
    const idx = typeof p.dataIndex === "number" ? p.dataIndex : -1;
    const bucket = POSITION_BUCKETS[idx];
    if (!bucket) return null;
    let clicks = 0;
    let impressions = 0;
    for (const r of queryRows) {
      if (r.position >= bucket.min && r.position <= bucket.max) {
        clicks += r.clicks;
        impressions += r.impressions;
      }
    }
    const ctr = impressions > 0 ? clicks / impressions : 0;
    return {
      title: `${t("adminAnalytics.gsc.avgPosition")}: ${bucket.label}`,
      subtitle: t("adminAnalytics.gsc.charts.positionTitle"),
      metrics: [
        { label: t("adminAnalytics.gsc.clicks"), value: clicks.toLocaleString("pl-PL") },
        { label: t("adminAnalytics.gsc.impressions"), value: impressions.toLocaleString("pl-PL") },
        { label: "CTR", value: `${(ctr * 100).toFixed(2)}%` },
      ],
    };
  };

  const donutClickFrom =
    (rows: GscRow[], dimLabel: string) =>
    (p: ChartClickParams): ChartDrillDetail | null => {
      const name = p.name ?? "?";
      const row = rows.find((r) => (r.keys[0] ?? "?") === name);
      if (!row) return null;
      return { title: name, subtitle: dimLabel, metrics: gscRowMetrics(row) };
    };

  const pageTreemapClick = (p: ChartClickParams): ChartDrillDetail | null => {
    const d = p.data as
      | { fullPath?: string; rawUrl?: string; value?: number; ctr?: number; clicks?: number; position?: number }
      | undefined;
    if (!d?.fullPath) return null;
    const impressions = d.value ?? 0;
    const ctr = d.ctr ?? 0;
    return {
      title: d.fullPath,
      subtitle: t("adminAnalytics.gsc.charts.pagesTitle"),
      url: d.rawUrl ?? d.fullPath,
      urlLabel: d.fullPath,
      metrics: [
        { label: t("adminAnalytics.gsc.clicks"), value: (d.clicks ?? 0).toLocaleString("pl-PL") },
        { label: t("adminAnalytics.gsc.impressions"), value: impressions.toLocaleString("pl-PL") },
        { label: "CTR", value: `${(ctr * 100).toFixed(2)}%` },
        { label: t("adminAnalytics.gsc.avgPosition"), value: (d.position ?? 0).toFixed(1) },
      ],
      links: [
        {
          href: d.rawUrl ?? d.fullPath,
          label: t("adminAnalytics.drillDialog.openInNewTab"),
        },
      ],
    };
  };

  const calendarClick = (p: ChartClickParams): ChartDrillDetail | null => {
    const value = p.value as [string, number] | undefined;
    if (!value) return null;
    const [day, clicks] = value;
    const row = dateRows.find((r) => (r.keys[0] ?? "") === day);
    return {
      title: t("adminAnalytics.gsc.charts.calendarTitle"),
      date: day,
      metrics: row
        ? gscRowMetrics(row)
        : [{ label: t("adminAnalytics.gsc.clicks"), value: String(clicks) }],
    };
  };


  if (!configured) {
    return (
      <Card className="p-6 text-sm text-muted-foreground">
        {t("adminAnalytics.gsc.notConfiguredPre")}
        <b>{t("adminAnalytics.gsc.notConfiguredTab")}</b>
        {t("adminAnalytics.gsc.notConfiguredPost")}
      </Card>
    );
  }

  const trendCsv = {
    filename: "gsc-trend",
    headers: t("adminAnalytics.gsc.csvTrendHeaders", { returnObjects: true }) as string[],
    rows: dateRows.map((r) => [
      r.keys[0] ?? "",
      r.clicks,
      r.impressions,
      (r.ctr * 100).toFixed(2),
      r.position.toFixed(2),
    ]),
  };
  const queriesCsv = {
    filename: "gsc-queries",
    headers: t("adminAnalytics.gsc.csvQueriesHeaders", { returnObjects: true }) as string[],
    rows: queryRows.map((r) => [
      r.keys[0] ?? "",
      r.clicks,
      r.impressions,
      (r.ctr * 100).toFixed(2),
      r.position.toFixed(2),
    ]),
  };

  const sparkClicks = dateRows
    .slice()
    .sort((a, b) => (a.keys[0] ?? "").localeCompare(b.keys[0] ?? ""))
    .map((r) => r.clicks);
  const sparkImpr = dateRows
    .slice()
    .sort((a, b) => (a.keys[0] ?? "").localeCompare(b.keys[0] ?? ""))
    .map((r) => r.impressions);

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[220px]">
          <label className="text-xs text-muted-foreground block mb-1">
            {t("adminAnalytics.gsc.property")}
          </label>
          <Select value={effectiveSite} onValueChange={setSiteUrl}>
            <SelectTrigger className="h-9 text-sm">
              <SelectValue placeholder={t("adminAnalytics.gsc.selectProperty")} />
            </SelectTrigger>
            <SelectContent>
              {sites.map((s) => (
                <SelectItem key={s.siteUrl} value={s.siteUrl}>
                  {s.siteUrl}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">
            {t("adminAnalytics.gsc.window")}
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
        {anyLoading ? (
          <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
            <Loader2 className="w-3 h-3 animate-spin" /> {t("adminAnalytics.common.loadingData")}
          </span>
        ) : null}
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiTile
          label={t("adminAnalytics.gsc.clicks")}
          value={totals.clicks.toLocaleString("pl-PL")}
          current={totals.clicks}
          previous={prevTotals.clicks}
          series={sparkClicks}
          icon={<SearchIcon className="w-3 h-3" />}
        />
        <KpiTile
          label={t("adminAnalytics.gsc.impressions")}
          value={totals.impressions.toLocaleString("pl-PL")}
          current={totals.impressions}
          previous={prevTotals.impressions}
          series={sparkImpr}
        />
        <KpiTile
          label="CTR"
          value={`${(totals.ctr * 100).toFixed(2)}%`}
          current={totals.ctr}
          previous={prevTotals.ctr}
          absoluteDelta
          deltaSuffix="pp"
        />
        <KpiTile
          label={t("adminAnalytics.gsc.avgPosition")}
          value={totals.position ? totals.position.toFixed(1) : "-"}
          current={totals.position}
          previous={prevTotals.position}
          higherIsBetter={false}
        />
      </div>

      {/* Trend + top queries */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <ChartCard
          title={t("adminAnalytics.gsc.charts.trendTitle")}
          subtitle={t("adminAnalytics.gsc.charts.trendSubtitle")}
          option={trendOption}
          csv={trendCsv}
          height={320}
          onDataClick={trendClick}
        />
        <ChartCard
          title={t("adminAnalytics.gsc.charts.topQueriesTitle")}
          subtitle={t("adminAnalytics.gsc.charts.topQueriesSubtitle")}
          option={topQueriesOption}
          csv={queriesCsv}
          height={320}
          onDataClick={topQueriesClick}
        />
      </div>

      {/* Position histogram + donuts */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <ChartCard
          title={t("adminAnalytics.gsc.charts.positionTitle")}
          subtitle={t("adminAnalytics.gsc.charts.positionSubtitle")}
          option={positionHistogramOption}
          height={280}
          onDataClick={positionBucketClick}
        />
        <ChartCard
          title={t("adminAnalytics.gsc.charts.countriesTitle")}
          subtitle={t("adminAnalytics.gsc.charts.countriesSubtitle")}
          option={donutOption(countryRows, t("adminAnalytics.gsc.charts.countriesTitle"))}
          height={280}
          onDataClick={donutClickFrom(countryRows, t("adminAnalytics.gsc.charts.countriesTitle"))}
        />
        <ChartCard
          title={t("adminAnalytics.gsc.charts.devicesTitle")}
          subtitle={t("adminAnalytics.gsc.charts.devicesSubtitle")}
          option={donutOption(deviceRows, t("adminAnalytics.gsc.charts.devicesTitle"))}
          height={280}
          onDataClick={donutClickFrom(deviceRows, t("adminAnalytics.gsc.charts.devicesTitle"))}
        />
      </div>

      {/* Treemap + calendar */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <ChartCard
          title={t("adminAnalytics.gsc.charts.pagesTitle")}
          subtitle={t("adminAnalytics.gsc.charts.pagesSubtitle")}
          option={treemapOption}
          height={320}
          onDataClick={pageTreemapClick}
        />
        <ChartCard
          title={t("adminAnalytics.gsc.charts.calendarTitle")}
          subtitle={t("adminAnalytics.gsc.charts.calendarSubtitle")}
          option={calendarOption}
          height={320}
          onDataClick={calendarClick}
        />
      </div>



      {/* Interpretacja + rekomendacje per element dashboardu */}
      <InsightSection
        subtitle={t("adminAnalytics.gsc.insightsSubtitle", { site: effectiveSite, days })}
        insights={buildGscInsights({
          totals,
          prevTotals,
          dateRows,
          queryRows,
          pageRows,
          countryRows,
          deviceRows,
          windowDays: days,
          t,
        })}
      />
    </div>
  );
}
