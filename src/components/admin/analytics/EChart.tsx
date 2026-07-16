/**
 * Client-only ECharts wrapper.
 *
 * - Registers only the components we actually use (bar / line / pie / heatmap /
 *   treemap / gauge / radar / sankey + tooltip/legend/grid/dataZoom) so the
 *   client bundle stays smaller than a wholesale `import "echarts"`.
 * - SSR-safe: `use()` calls happen at module scope but the DOM renderer runs
 *   only on the client via `<ClientOnly>`-style guard.
 * - Exposes an imperative ref (`onReady`) so parent components can `getDataURL`
 *   for PNG export without reaching into `echarts-for-react`'s internals.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import ReactECharts from "echarts-for-react";
import { use, init } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import {
  BarChart,
  LineChart,
  PieChart,
  HeatmapChart,
  TreemapChart,
  GaugeChart,
  RadarChart,
  SankeyChart,
  ScatterChart,
} from "echarts/charts";
import {
  TooltipComponent,
  LegendComponent,
  GridComponent,
  DataZoomComponent,
  MarkAreaComponent,
  MarkLineComponent,
  TitleComponent,
  VisualMapComponent,
  ToolboxComponent,
  CalendarComponent,
} from "echarts/components";
import type { EChartsCoreOption, ECharts } from "echarts/core";
import { resolveChartTheme, baseOption, type ResolvedTheme } from "./chartTheme";

use([
  CanvasRenderer,
  BarChart,
  LineChart,
  PieChart,
  HeatmapChart,
  TreemapChart,
  GaugeChart,
  RadarChart,
  SankeyChart,
  ScatterChart,
  TooltipComponent,
  LegendComponent,
  GridComponent,
  DataZoomComponent,
  MarkAreaComponent,
  MarkLineComponent,
  TitleComponent,
  VisualMapComponent,
  ToolboxComponent,
  CalendarComponent,
]);

export interface EChartProps {
  option: EChartsCoreOption;
  height?: number | string;
  onReady?: (instance: ECharts) => void;
  className?: string;
  themeVersion?: number;
}

function mergeWithTheme(option: EChartsCoreOption, theme: ResolvedTheme): EChartsCoreOption {
  const base = baseOption(theme) as Record<string, unknown>;
  return { ...base, ...(option as Record<string, unknown>) } as EChartsCoreOption;
}

/**
 * Renders an ECharts canvas only on the client. During SSR / first hydration
 * pass we render a fixed-height skeleton so the layout doesn't jump when the
 * chart mounts.
 */
export function EChart({ option, height = 320, onReady, className, themeVersion = 0 }: EChartProps) {
  const [mounted, setMounted] = useState(false);
  const ref = useRef<ReactECharts | null>(null);
  const theme = useMemo(() => resolveChartTheme(), [themeVersion, mounted]);
  const merged = useMemo(() => mergeWithTheme(option, theme), [option, theme]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted || !ref.current) return;
    const inst = ref.current.getEchartsInstance();
    onReady?.(inst);
  }, [mounted, onReady]);

  if (!mounted) {
    return (
      <div
        aria-hidden
        className={"animate-pulse rounded-md bg-muted/40 " + (className ?? "")}
        style={{ height: typeof height === "number" ? `${height}px` : height }}
      />
    );
  }

  return (
    <div className={className} style={{ height: typeof height === "number" ? `${height}px` : height }}>
      <ReactECharts
        ref={ref}
        echarts={{ use, init } as unknown as never}
        option={merged}
        style={{ width: "100%", height: "100%" }}
        notMerge
        lazyUpdate
      />
    </div>
  );
}
