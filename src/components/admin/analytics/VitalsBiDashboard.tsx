/**
 * Web Vitals BI dashboard.
 *
 * Uses the already-aggregated `getVitalsSummary` server function (no extra
 * round-trips - the report includes metrics, per-path breakdown, and daily
 * p75 trends). Adds a second call over the previous window for KPI deltas.
 *
 * Charts:
 *   1. KPI row: LCP / INP / CLS / FCP / TTFB p75 with delta vs previous period
 *      and per-metric sparkline built from the daily trend.
 *   2. Trend line per metric with markArea bands showing the Good / Needs
 *      improvement / Poor thresholds - one card per metric so the eye can read
 *      each threshold without a shared axis.
 *   3. Stacked rating bar per metric (good / needs / poor sample counts).
 *   4. Treemap of paths by sample volume, colour-coded by LCP p75.
 *   5. Rating pie of the whole window.
 */
import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Loader2, RefreshCw, Gauge } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { EChartsCoreOption } from "echarts/core";
import { getVitalsSummary, type VitalsSummaryResult } from "@/lib/observability/vitals.functions";
import { VITAL_THRESHOLDS, type VitalName } from "@/lib/observability/vitalsThresholds";
import { ChartCard } from "./ChartCard";
import { KpiTile } from "./KpiTile";
import { VitalsRecommendations } from "./VitalsRecommendations";
import { TimeRangeFilter, buildPresetRange, type TimeRangeValue } from "./TimeRangeFilter";


const METRIC_ORDER: VitalName[] = ["LCP", "INP", "CLS", "FCP", "TTFB"];

function fmtValue(metric: VitalName, v: number): string {
  if (!Number.isFinite(v)) return "-";
  if (metric === "CLS") return v.toFixed(3);
  if (v >= 1000) return `${(v / 1000).toFixed(2)} s`;
  return `${Math.round(v)} ms`;
}

function sparkForMetric(report: VitalsSummaryResult, metric: VitalName): number[] {
  return report.trends.map((t) => t.p75[metric] ?? 0).filter((v) => Number.isFinite(v));
}

export function VitalsBiDashboard() {
  const fetchVitals = useServerFn(getVitalsSummary);
  const [range, setRange] = useState<TimeRangeValue>(() => buildPresetRange("7d"));

  const curQ = useQuery({
    queryKey: ["vitals-bi", range.presetId, range.sinceIso, range.untilIso],
    queryFn: () =>
      fetchVitals({ data: { sinceIso: range.sinceIso, untilIso: range.untilIso } }),
    staleTime: 60_000,
  });
  const report = curQ.data;
  const isLoading = curQ.isLoading;


  const metricsByName = useMemo(() => {
    const map = new Map<VitalName, NonNullable<typeof report>["metrics"][number]>();
    for (const m of report?.metrics ?? []) map.set(m.metric, m);
    return map;
  }, [report]);

  const trendOption = (metric: VitalName): EChartsCoreOption => {
    const [thGood, thPoor] = VITAL_THRESHOLDS[metric];
    const trend = (report?.trends ?? []).map((t) => [t.day, t.p75[metric] ?? null] as [string, number | null]);
    return {
      tooltip: {
        trigger: "axis",
        formatter: (raw: unknown) => {
          const p = (raw as Array<{ axisValue: string; value: [string, number | null] }>)[0];
          if (!p) return "";
          const v = p.value?.[1];
          return `${p.axisValue}<br/>${metric} p75: <b>${v === null || v === undefined ? "-" : fmtValue(metric, v)}</b>`;
        },
      },
      xAxis: { type: "category", data: trend.map((d) => d[0]), boundaryGap: false },
      yAxis: {
        type: "value",
        scale: true,
        axisLabel: {
          formatter: (v: number) => (metric === "CLS" ? v.toFixed(2) : v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${v}ms`),
          fontSize: 10,
        },
      },
      series: [
        {
          type: "line",
          smooth: true,
          symbol: "circle",
          symbolSize: 5,
          data: trend.map((d) => d[1]),
          areaStyle: { opacity: 0.18 },
          connectNulls: true,
          markArea: {
            silent: true,
            itemStyle: { opacity: 0.12 },
            data: [
              [{ yAxis: 0, itemStyle: { color: "#16a34a" } }, { yAxis: thGood }],
              [{ yAxis: thGood, itemStyle: { color: "#f59e0b" } }, { yAxis: thPoor }],
              [{ yAxis: thPoor, itemStyle: { color: "#dc2626" } }, { yAxis: "max" }],
            ],
          },
          markLine: {
            silent: true,
            symbol: "none",
            lineStyle: { color: "hsl(var(--muted-foreground))", type: "dashed", width: 1 },
            data: [
              { yAxis: thGood, label: { formatter: `Good ${fmtValue(metric, thGood)}`, fontSize: 9 } },
              { yAxis: thPoor, label: { formatter: `Poor ${fmtValue(metric, thPoor)}`, fontSize: 9 } },
            ],
          },
        },
      ],
    };
  };

  const ratingStackOption = useMemo<EChartsCoreOption>(() => {
    const metrics = METRIC_ORDER.filter((m) => metricsByName.has(m));
    return {
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      legend: { top: 4, data: ["Good", "Needs improvement", "Poor"] },
      grid: { left: 8, right: 8, top: 32, bottom: 24, containLabel: true },
      xAxis: { type: "category", data: metrics },
      yAxis: { type: "value" },
      series: [
        {
          name: "Good",
          type: "bar",
          stack: "rating",
          color: "#16a34a",
          data: metrics.map((m) => metricsByName.get(m)?.good ?? 0),
          itemStyle: { borderRadius: [0, 0, 0, 0] },
        },
        {
          name: "Needs improvement",
          type: "bar",
          stack: "rating",
          color: "#f59e0b",
          data: metrics.map((m) => metricsByName.get(m)?.needsImprovement ?? 0),
        },
        {
          name: "Poor",
          type: "bar",
          stack: "rating",
          color: "#dc2626",
          data: metrics.map((m) => metricsByName.get(m)?.poor ?? 0),
          itemStyle: { borderRadius: [4, 4, 0, 0] },
        },
      ],
    };
  }, [metricsByName]);

  const pathTreemapOption = useMemo<EChartsCoreOption>(() => {
    const paths = (report?.paths ?? []).slice(0, 25);
    const [, lcpPoor] = VITAL_THRESHOLDS.LCP;
    return {
      tooltip: {
        formatter: (raw: unknown) => {
          const p = raw as { name: string; value: number; data: { lcp: number } };
          return `${p.name}<br/>Próbek: <b>${p.value}</b><br/>LCP p75: ${p.data.lcp ? fmtValue("LCP", p.data.lcp) : "-"}`;
        },
      },
      visualMap: {
        min: 0,
        max: lcpPoor * 1.5,
        dimension: "lcp",
        show: false,
        inRange: { color: ["#16a34a", "#f59e0b", "#dc2626"] },
      },
      series: [
        {
          type: "treemap",
          roam: false,
          nodeClick: false,
          breadcrumb: { show: false },
          label: { show: true, formatter: "{b}", fontSize: 10, color: "#fff" },
          itemStyle: { borderColor: "hsl(var(--background))", borderWidth: 2, gapWidth: 2 },
          data: paths.map((p) => {
            const lcp = p.metrics.find((m) => m.metric === "LCP")?.p75 ?? 0;
            const shown = p.path.length > 26 ? p.path.slice(0, 26) + "…" : p.path;
            return { name: shown, value: p.total, lcp };
          }),
        },
      ],
    };
  }, [report]);

  const overallPieOption = useMemo<EChartsCoreOption>(() => {
    const good = (report?.metrics ?? []).reduce((acc, m) => acc + m.good, 0);
    const ni = (report?.metrics ?? []).reduce((acc, m) => acc + m.needsImprovement, 0);
    const poor = (report?.metrics ?? []).reduce((acc, m) => acc + m.poor, 0);
    return {
      tooltip: { trigger: "item" },
      legend: { orient: "vertical", right: 4, top: "middle" },
      series: [
        {
          type: "pie",
          radius: ["55%", "78%"],
          center: ["38%", "50%"],
          label: {
            show: true,
            position: "center",
            formatter: `{a|${good + ni + poor}}\n{b|próbek}`,
            rich: {
              a: { fontSize: 22, fontWeight: 700, color: "hsl(var(--foreground))" },
              b: { fontSize: 10, color: "hsl(var(--muted-foreground))" },
            },
          },
          data: [
            { name: "Good", value: good, itemStyle: { color: "#16a34a" } },
            { name: "Needs improvement", value: ni, itemStyle: { color: "#f59e0b" } },
            { name: "Poor", value: poor, itemStyle: { color: "#dc2626" } },
          ],
        },
      ],
    };
  }, [report]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <TimeRangeFilter value={range} onChange={setRange} />
        <Button variant="outline" size="sm" onClick={() => curQ.refetch()} className="h-7">
          <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Odśwież
        </Button>
        <div className="text-xs text-muted-foreground inline-flex items-center gap-1">
          <Gauge className="w-3 h-3" /> Próbek w oknie: {report?.windowTotal ?? 0}
          {report?.capped ? " (agregacja z najnowszych 20 000)" : ""}
        </div>
        {isLoading ? (
          <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
            <Loader2 className="w-3 h-3 animate-spin" /> Ładowanie...
          </span>
        ) : null}
      </div>


      {!report || report.total === 0 ? (
        <Card className="p-6 text-sm text-muted-foreground">
          Brak próbek RUM w wybranym oknie. Otwórz kilka podstron w prawdziwym trybie (nie w edytorze) - beacony trafią do tabeli i pojawią się tu automatycznie.
        </Card>
      ) : (
        <>
          {/* KPI tiles per metric */}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
            {METRIC_ORDER.map((metric) => {
              const m = metricsByName.get(metric);
              if (!m) return <KpiTile key={metric} label={metric} value="-" />;
              return (
                <KpiTile
                  key={metric}
                  label={metric}
                  value={fmtValue(metric, m.p75)}
                  current={m.p75}
                  series={sparkForMetric(report, metric)}
                  higherIsBetter={false}
                />
              );
            })}
          </div>

          {/* Trends per metric */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {METRIC_ORDER.filter((m) => metricsByName.has(m)).map((metric) => (
              <ChartCard
                key={metric}
                title={`${metric} - trend p75`}
                subtitle="Pasma: zielone Good, żółte Needs, czerwone Poor"
                option={trendOption(metric)}
                height={260}
              />
            ))}
          </div>

          {/* Rating stack + overall */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <ChartCard
              title="Ratingi per metryka"
              subtitle="Liczba próbek Good / Needs / Poor"
              option={ratingStackOption}
              height={280}
              className="xl:col-span-2"
            />
            <ChartCard title="Rating ogółem" subtitle="Cały panel próbek w oknie" option={overallPieOption} height={280} />
          </div>

          {/* Path treemap */}
          <ChartCard
            title="Ścieżki wg liczby próbek"
            subtitle="Wielkość = próbki, kolor = LCP p75 (zielony → czerwony)"
            option={pathTreemapOption}
            height={340}
          />

          {/* Interpretacja + rekomendacje - priorytetyzowana lista działań
              per metryka i per ścieżka, zbudowana z tego samego raportu. */}
          <VitalsRecommendations report={report} />
        </>
      )}
    </div>
  );
}
