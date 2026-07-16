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

  const dims: Array<"date" | "query" | "page" | "country" | "device"> = ["date", "query", "page", "country", "device"];

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
    const sorted = dateRows.slice().sort((a, b) => (a.keys[0] ?? "").localeCompare(b.keys[0] ?? ""));
    return {
      legend: { data: ["Kliknięcia", "Wyświetlenia", "CTR"], top: 4 },
      tooltip: { trigger: "axis" },
      grid: { left: 44, right: 60, top: 32, bottom: 40, containLabel: true },
      xAxis: {
        type: "category",
        data: sorted.map((r) => r.keys[0] ?? ""),
        boundaryGap: false,
      },
      yAxis: [
        { type: "value", name: "Kliknięcia", nameTextStyle: { fontSize: 10 } },
        { type: "value", name: "Wyświetlenia", nameTextStyle: { fontSize: 10 }, splitLine: { show: false } },
        { type: "value", name: "CTR %", nameTextStyle: { fontSize: 10 }, show: false, max: 100 },
      ],
      dataZoom: [{ type: "inside", start: 0, end: 100 }],
      series: [
        {
          name: "Kliknięcia",
          type: "line",
          smooth: true,
          areaStyle: { opacity: 0.25 },
          data: sorted.map((r) => r.clicks),
          yAxisIndex: 0,
          symbol: "circle",
          symbolSize: 4,
        },
        {
          name: "Wyświetlenia",
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
  }, [dateRows]);

  const topQueriesOption = useMemo<EChartsCoreOption>(() => {
    const top = queryRows.slice().sort((a, b) => b.clicks - a.clicks).slice(0, 15).reverse();
    return {
      grid: { left: 8, right: 20, top: 8, bottom: 24, containLabel: true },
      tooltip: {
        trigger: "axis",
        formatter: (raw: unknown) => {
          const arr = raw as Array<{ name: string; value: number; dataIndex: number }>;
          const r = top[arr[0]?.dataIndex ?? 0];
          if (!r) return "";
          return `${r.keys[0] ?? ""}<br/>Kliknięcia: <b>${r.clicks}</b><br/>Wyświetlenia: ${r.impressions}<br/>CTR: ${(r.ctr * 100).toFixed(2)}%<br/>Pozycja: ${r.position.toFixed(1)}`;
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
  }, [queryRows]);

  const positionHistogramOption = useMemo<EChartsCoreOption>(() => {
    const buckets = POSITION_BUCKETS.map((b) => ({ ...b, impressions: 0, clicks: 0 }));
    for (const r of queryRows) {
      const b = buckets.find((x) => r.position >= x.min && r.position <= x.max);
      if (!b) continue;
      b.impressions += r.impressions;
      b.clicks += r.clicks;
    }
    return {
      legend: { data: ["Wyświetlenia", "Kliknięcia"], top: 4 },
      tooltip: { trigger: "axis" },
      xAxis: { type: "category", data: buckets.map((b) => b.label) },
      yAxis: [{ type: "value" }, { type: "value", splitLine: { show: false } }],
      series: [
        {
          name: "Wyświetlenia",
          type: "bar",
          data: buckets.map((b) => b.impressions),
          itemStyle: { borderRadius: [4, 4, 0, 0] },
        },
        {
          name: "Kliknięcia",
          type: "line",
          yAxisIndex: 1,
          data: buckets.map((b) => b.clicks),
          smooth: true,
        },
      ],
    };
  }, [queryRows]);

  const donutOption = (rows: GscRow[], title: string): EChartsCoreOption => {
    const top = rows.slice().sort((a, b) => b.clicks - a.clicks).slice(0, 8);
    const otherClicks = rows.slice(8).reduce((acc, r) => acc + r.clicks, 0);
    const data = top.map((r) => ({ name: r.keys[0] ?? "?", value: r.clicks }));
    if (otherClicks > 0) data.push({ name: "Inne", value: otherClicks });
    return {
      tooltip: {
        trigger: "item",
        formatter: (raw: unknown) => {
          const p = raw as { name: string; value: number; percent: number };
          return `${p.name}: <b>${p.value}</b> (${p.percent.toFixed(1)}%)`;
        },
      },
      legend: { orient: "vertical", right: 4, top: "middle", type: "scroll", textStyle: { fontSize: 11 } },
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
    const top = pageRows.slice().sort((a, b) => b.impressions - a.impressions).slice(0, 20);
    return {
      tooltip: {
        formatter: (raw: unknown) => {
          const p = raw as { name: string; value: number; data: { ctr: number; clicks: number } };
          return `${p.name}<br/>Wyświetlenia: <b>${p.value}</b><br/>Kliknięcia: ${p.data.clicks}<br/>CTR: ${(p.data.ctr * 100).toFixed(2)}%`;
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
            const path = (r.keys[0] ?? "/").replace(/^https?:\/\/[^/]+/, "");
            return {
              name: path.length > 30 ? path.slice(0, 30) + "…" : path,
              value: r.impressions,
              ctr: r.ctr,
              clicks: r.clicks,
            };
          }),
        },
      ],
    };
  }, [pageRows]);

  const calendarOption = useMemo<EChartsCoreOption>(() => {
    if (!dateRows.length) return { series: [] };
    const sorted = dateRows.slice().sort((a, b) => (a.keys[0] ?? "").localeCompare(b.keys[0] ?? ""));
    const data = sorted.map((r) => [r.keys[0] ?? "", r.clicks]);
    const max = Math.max(1, ...sorted.map((r) => r.clicks));
    const first = sorted[0]?.keys[0] ?? todayISO();
    const last = sorted[sorted.length - 1]?.keys[0] ?? todayISO();
    return {
      tooltip: {
        formatter: (raw: unknown) => {
          const p = raw as { value: [string, number] };
          return `${p.value[0]}: <b>${p.value[1]}</b> klik.`;
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
  }, [dateRows]);

  if (!configured) {
    return (
      <Card className="p-6 text-sm text-muted-foreground">
        Search Console nie jest jeszcze podłączony. Wróć do zakładki <b>Przegląd</b> i użyj przycisku „Połącz Search Console".
      </Card>
    );
  }

  const trendCsv = {
    filename: "gsc-trend",
    headers: ["data", "kliknięcia", "wyświetlenia", "ctr", "pozycja"],
    rows: dateRows.map((r) => [r.keys[0] ?? "", r.clicks, r.impressions, (r.ctr * 100).toFixed(2), r.position.toFixed(2)]),
  };
  const queriesCsv = {
    filename: "gsc-queries",
    headers: ["zapytanie", "kliknięcia", "wyświetlenia", "ctr", "pozycja"],
    rows: queryRows.map((r) => [r.keys[0] ?? "", r.clicks, r.impressions, (r.ctr * 100).toFixed(2), r.position.toFixed(2)]),
  };

  const sparkClicks = dateRows.slice().sort((a, b) => (a.keys[0] ?? "").localeCompare(b.keys[0] ?? "")).map((r) => r.clicks);
  const sparkImpr = dateRows.slice().sort((a, b) => (a.keys[0] ?? "").localeCompare(b.keys[0] ?? "")).map((r) => r.impressions);

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[220px]">
          <label className="text-xs text-muted-foreground block mb-1">Właściwość</label>
          <Select value={effectiveSite} onValueChange={setSiteUrl}>
            <SelectTrigger className="h-9 text-sm">
              <SelectValue placeholder="Wybierz właściwość" />
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
          <label className="text-xs text-muted-foreground block mb-1">Okno</label>
          <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
            <SelectTrigger className="h-9 text-sm w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">7 dni</SelectItem>
              <SelectItem value="14">14 dni</SelectItem>
              <SelectItem value="28">28 dni</SelectItem>
              <SelectItem value="90">90 dni</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button variant="outline" size="sm" onClick={() => queries.forEach((q) => q.refetch())} className="h-9">
          <RefreshCw className="w-3.5 h-3.5 mr-2" /> Odśwież
        </Button>
        {anyLoading ? (
          <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
            <Loader2 className="w-3 h-3 animate-spin" /> Ładowanie danych...
          </span>
        ) : null}
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiTile
          label="Kliknięcia"
          value={totals.clicks.toLocaleString("pl-PL")}
          current={totals.clicks}
          previous={prevTotals.clicks}
          series={sparkClicks}
          icon={<SearchIcon className="w-3 h-3" />}
        />
        <KpiTile
          label="Wyświetlenia"
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
          label="Śr. pozycja"
          value={totals.position ? totals.position.toFixed(1) : "-"}
          current={totals.position}
          previous={prevTotals.position}
          higherIsBetter={false}
        />
      </div>

      {/* Trend + top queries */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <ChartCard
          title="Trend widoczności"
          subtitle="Kliknięcia i wyświetlenia w czasie + CTR (linia przerywana)"
          option={trendOption}
          csv={trendCsv}
          height={320}
        />
        <ChartCard
          title="Top 15 zapytań"
          subtitle="Rank wg kliknięć"
          option={topQueriesOption}
          csv={queriesCsv}
          height={320}
        />
      </div>

      {/* Position histogram + donuts */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <ChartCard
          title="Rozkład pozycji SERP"
          subtitle="Wyświetlenia i kliknięcia wg przedziału pozycji"
          option={positionHistogramOption}
          height={280}
        />
        <ChartCard
          title="Kraje"
          subtitle="Kliknięcia wg kraju"
          option={donutOption(countryRows, "Kraje")}
          height={280}
        />
        <ChartCard
          title="Urządzenia"
          subtitle="Kliknięcia wg typu urządzenia"
          option={donutOption(deviceRows, "Urządzenia")}
          height={280}
        />
      </div>

      {/* Treemap + calendar */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <ChartCard
          title="Strony wg wyświetleń"
          subtitle="Treemap top 20 stron (wielkość = wyświetlenia)"
          option={treemapOption}
          height={320}
        />
        <ChartCard
          title="Aktywność dzienna"
          subtitle="Heatmapa kalendarzowa - kliknięcia per dzień"
          option={calendarOption}
          height={320}
        />
      </div>
    </div>
  );
}
