import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Gauge, AlertTriangle, Loader2 } from "@/lib/lucide-shim";
import { getVitalsSummary } from "@/lib/observability/vitals.functions";
import type {
  VitalMetricSummary,
  VitalPathRow,
  VitalTrendPoint,
} from "@/lib/observability/aggregate";
import { rateVital, type VitalName, type VitalRating } from "@/lib/observability/vitalsThresholds";

export const Route = createFileRoute("/admin/performance")({
  component: PerformancePage,
});

const WINDOWS = [1, 7, 28] as const;

// Short human labels + one-liners for each metric the dashboard can show.
const META: Record<VitalName, { label: string; hint: string }> = {
  LCP: { label: "Largest Contentful Paint", hint: "Loading - largest element painted" },
  INP: { label: "Interaction to Next Paint", hint: "Responsiveness - slowest interaction" },
  CLS: { label: "Cumulative Layout Shift", hint: "Visual stability - unexpected shifts" },
  FCP: { label: "First Contentful Paint", hint: "First paint of any content" },
  TTFB: { label: "Time to First Byte", hint: "Server/network response" },
  FID: { label: "First Input Delay", hint: "Legacy responsiveness metric" },
};

const RATING_STYLE: Record<VitalRating, { dot: string; text: string; bar: string }> = {
  good: {
    dot: "bg-emerald-500",
    text: "text-emerald-600 dark:text-emerald-400",
    bar: "bg-emerald-500",
  },
  "needs-improvement": {
    dot: "bg-amber-500",
    text: "text-amber-600 dark:text-amber-400",
    bar: "bg-amber-500",
  },
  poor: { dot: "bg-red-500", text: "text-red-600 dark:text-red-400", bar: "bg-red-500" },
};

function formatVital(metric: VitalName, value: number): string {
  if (metric === "CLS") return value.toFixed(3);
  if (value >= 1000) return `${(value / 1000).toFixed(2)} s`;
  return `${Math.round(value)} ms`;
}

function PerformancePage() {
  const { t } = useTranslation();
  const [days, setDays] = useState<number>(7);
  const fetchFn = useServerFn(getVitalsSummary);
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-vitals", days],
    queryFn: () => fetchFn({ data: { days } }),
    staleTime: 60_000,
  });

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-1 flex-wrap">
        <div>
          <h1 className="font-display text-xl font-bold flex items-center gap-2">
            <Gauge className="w-5 h-5" />
            {t("admin.performance.title")}
          </h1>
          <p className="text-xs text-muted-foreground mt-1 max-w-2xl">
            {t("admin.performance.subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-1 bg-muted/40 rounded-md p-0.5">
          {WINDOWS.map((w) => (
            <button
              key={w}
              onClick={() => setDays(w)}
              className={`px-2.5 py-1 rounded text-xs font-medium transition ${
                days === w
                  ? "bg-card shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t(`admin.performance.window.${w}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4">
        {isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-10 justify-center">
            <Loader2 className="w-4 h-4 animate-spin" /> {t("admin.performance.loading")}
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 text-sm text-destructive py-10 justify-center">
            <AlertTriangle className="w-4 h-4" />
            {error instanceof Error ? error.message : t("admin.performance.error")}
          </div>
        )}

        {data && !isLoading && (
          <>
            <div className="flex items-center gap-3 text-xs text-muted-foreground mb-3">
              <span>{t("admin.performance.sampleCount", { count: data.windowTotal })}</span>
              {data.capped && (
                <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="w-3 h-3" />{" "}
                  {t("admin.performance.capped", { shown: data.total })}
                </span>
              )}
            </div>

            {data.total === 0 ? (
              <div className="border border-dashed border-border rounded-lg py-12 text-center">
                <Gauge className="w-8 h-8 mx-auto mb-3 text-muted-foreground/50" />
                <p className="text-sm font-medium">{t("admin.performance.emptyTitle")}</p>
                <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">
                  {t("admin.performance.emptyBody")}
                </p>
              </div>
            ) : (
              <>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {data.metrics.map((m) => (
                    <MetricCard key={m.metric} m={m} />
                  ))}
                </div>
                {data.trends.length > 1 && (
                  <TrendsSection metrics={data.metrics} trends={data.trends} />
                )}
                {data.paths.length > 0 && <PathsSection paths={data.paths} />}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// Per-metric daily p75 as a compact bar sparkline; bars colored by rating.
function TrendsSection({
  metrics,
  trends,
}: {
  metrics: VitalMetricSummary[];
  trends: VitalTrendPoint[];
}) {
  const { t } = useTranslation();
  const series = metrics
    .map((m) => ({
      metric: m.metric,
      points: trends
        .map((tp) => ({ day: tp.day, v: tp.p75[m.metric] }))
        .filter((d): d is { day: string; v: number } => typeof d.v === "number"),
    }))
    .filter((s) => s.points.length > 1);
  if (series.length === 0) return null;

  return (
    <div className="mt-6">
      <h2 className="text-sm font-semibold mb-2">{t("admin.performance.trends")}</h2>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {series.map(({ metric, points }) => {
          const max = Math.max(...points.map((p) => p.v)) || 1;
          return (
            <div key={metric} className="bg-card border border-border rounded-md p-3">
              <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-2">
                <span className="font-semibold text-foreground">{metric}</span>
                <span className="tabular-nums">
                  {points[0].day.slice(5)} → {points[points.length - 1].day.slice(5)}
                </span>
              </div>
              <div className="flex items-end gap-0.5 h-12">
                {points.map((p) => {
                  const rating = rateVital(metric, p.v);
                  const h = Math.max(8, Math.round((p.v / max) * 100));
                  return (
                    <div
                      key={p.day}
                      title={`${p.day}: ${formatVital(metric, p.v)}`}
                      className={`flex-1 rounded-t ${RATING_STYLE[rating].bar}`}
                      style={{ height: `${h}%` }}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Per-path breakdown table: which pages are fast/slow.
function PathsSection({ paths }: { paths: VitalPathRow[] }) {
  const { t } = useTranslation();
  return (
    <div className="mt-6">
      <h2 className="text-sm font-semibold mb-2">{t("admin.performance.byPath")}</h2>
      <div className="bg-card border border-border rounded-md overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-muted/30 text-muted-foreground">
            <tr>
              <th className="text-left p-2 font-medium">{t("admin.performance.path")}</th>
              <th className="text-right p-2 font-medium w-24">{t("admin.performance.samples")}</th>
              <th className="text-left p-2 font-medium">{t("admin.performance.metricsCol")}</th>
            </tr>
          </thead>
          <tbody>
            {paths.map((p) => (
              <tr key={p.path} className="border-t border-border align-top">
                <td className="p-2 font-mono truncate max-w-[280px]" title={p.path}>
                  {p.path}
                </td>
                <td className="p-2 text-right tabular-nums">{p.total}</td>
                <td className="p-2">
                  <div className="flex flex-wrap gap-1.5">
                    {p.metrics.map((pm) => (
                      <span
                        key={pm.metric}
                        className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 bg-muted/40 ${RATING_STYLE[pm.rating].text}`}
                        title={`${pm.metric} p75 (${pm.count})`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${RATING_STYLE[pm.rating].dot}`}
                        />
                        {pm.metric} {formatVital(pm.metric, pm.p75)}
                      </span>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MetricCard({ m }: { m: VitalMetricSummary }) {
  const { t } = useTranslation();
  const style = RATING_STYLE[m.rating];
  const meta = META[m.metric];
  const pct = (n: number) => (m.count > 0 ? (n / m.count) * 100 : 0);

  return (
    <div className="bg-card border border-border rounded-md p-3.5">
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">
            {m.metric}
          </div>
          <div className="text-[11px] text-muted-foreground truncate">{meta.label}</div>
        </div>
        <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${style.text}`}>
          <span className={`w-2 h-2 rounded-full ${style.dot}`} />
          {t(`admin.performance.rating.${m.rating === "needs-improvement" ? "ni" : m.rating}`)}
        </span>
      </div>

      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-2xl font-bold font-display leading-none">
          {formatVital(m.metric, m.p75)}
        </span>
        <span className="text-[10px] text-muted-foreground">{t("admin.performance.p75")}</span>
      </div>

      <div className="mt-1 text-[11px] text-muted-foreground">
        {t("admin.performance.median")}: {formatVital(m.metric, m.p50)} ·{" "}
        {t("admin.performance.range")}: {formatVital(m.metric, m.min)}–
        {formatVital(m.metric, m.max)}
      </div>

      {/* Distribution bar: good / needs-improvement / poor share of samples */}
      <div className="mt-2.5 h-1.5 w-full rounded-full overflow-hidden bg-muted flex">
        <div className="bg-emerald-500 h-full" style={{ width: `${pct(m.good)}%` }} />
        <div className="bg-amber-500 h-full" style={{ width: `${pct(m.needsImprovement)}%` }} />
        <div className="bg-red-500 h-full" style={{ width: `${pct(m.poor)}%` }} />
      </div>
      <div className="mt-1.5 flex items-center justify-between text-[10px] text-muted-foreground">
        <span>{t("admin.performance.sampleCount", { count: m.count })}</span>
        <span className="tabular-nums">
          {m.good} / {m.needsImprovement} / {m.poor}
        </span>
      </div>
    </div>
  );
}
