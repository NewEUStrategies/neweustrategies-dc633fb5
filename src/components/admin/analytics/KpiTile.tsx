/**
 * BI KPI tile: label + big value + delta chip vs previous period + sparkline.
 *
 * The sparkline is a compact ECharts line - reuses the theme/lazy loader so it
 * matches the big charts. When `previous` is provided we compute delta % and
 * pick the delta colour by direction (higher-is-better is toggleable per KPI:
 * position/CLS are lower-is-better).
 */
import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import type { EChartsCoreOption } from "echarts/core";
import { EChart } from "./EChart";

export interface KpiTileProps {
  label: string;
  value: string;
  /** Numeric current value for delta computation (optional). */
  current?: number;
  /** Numeric previous-period value for delta computation. */
  previous?: number;
  /** Series for the sparkline (chronological). */
  series?: number[];
  /** When true (default), higher = green. Set false for metrics like SERP position or CLS. */
  higherIsBetter?: boolean;
  /** Optional small icon shown next to the label. */
  icon?: React.ReactNode;
  /** Suffix appended to delta text (e.g. "pp" for percentage points). */
  deltaSuffix?: string;
  /** Force delta rendering to be absolute rather than percentage. */
  absoluteDelta?: boolean;
}

function formatDelta(current: number, previous: number, absolute: boolean, suffix?: string): string {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return "-";
  if (absolute) {
    const d = current - previous;
    const sign = d > 0 ? "+" : "";
    return `${sign}${d.toLocaleString("pl-PL", { maximumFractionDigits: 2 })}${suffix ?? ""}`;
  }
  if (previous === 0) return current === 0 ? "0%" : "+∞";
  const pct = ((current - previous) / Math.abs(previous)) * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

export function KpiTile({
  label,
  value,
  current,
  previous,
  series,
  higherIsBetter = true,
  icon,
  deltaSuffix,
  absoluteDelta,
}: KpiTileProps) {
  const hasDelta =
    typeof current === "number" && typeof previous === "number" && Number.isFinite(current) && Number.isFinite(previous);
  const dir = hasDelta ? Math.sign((current ?? 0) - (previous ?? 0)) : 0;
  const good = higherIsBetter ? dir > 0 : dir < 0;
  const neutral = dir === 0;
  const deltaColor = neutral ? "text-muted-foreground" : good ? "text-emerald-600" : "text-destructive";
  const DeltaIcon = neutral ? Minus : good ? ArrowUpRight : ArrowDownRight;

  const sparkOption = useMemo<EChartsCoreOption | null>(() => {
    if (!series || series.length < 2) return null;
    return {
      grid: { left: 2, right: 2, top: 2, bottom: 2, containLabel: false },
      xAxis: { type: "category", show: false, boundaryGap: false, data: series.map((_, i) => i) },
      yAxis: { type: "value", show: false, scale: true },
      tooltip: { show: false },
      legend: { show: false },
      series: [
        {
          type: "line",
          data: series,
          smooth: true,
          symbol: "none",
          lineStyle: { width: 1.5 },
          areaStyle: { opacity: 0.15 },
        },
      ],
    };
  }, [series]);

  return (
    <Card className="p-3 relative overflow-hidden">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground flex items-center gap-1">
            {icon}
            <span className="truncate">{label}</span>
          </div>
          <div className="text-xl font-semibold tabular-nums mt-1 leading-tight">{value}</div>
        </div>
        {hasDelta ? (
          <div
            className={
              "inline-flex items-center gap-0.5 text-[11px] font-medium px-1.5 py-0.5 rounded-md bg-muted/60 " +
              deltaColor
            }
          >
            <DeltaIcon className="w-3 h-3" />
            {formatDelta(current ?? 0, previous ?? 0, Boolean(absoluteDelta), deltaSuffix)}
          </div>
        ) : null}
      </div>
      {sparkOption ? (
        <div className="mt-2 -mx-1">
          <EChart option={sparkOption} height={40} />
        </div>
      ) : null}
    </Card>
  );
}
