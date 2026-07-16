/**
 * Real ECharts renderer. Imported ONLY via `React.lazy` from ./EChart so the
 * SSR module graph never reaches it - see the comment in EChart.tsx for why.
 *
 * Registers only the components we actually use (bar / line / pie / heatmap /
 * treemap / gauge / radar / sankey + tooltip/legend/grid/dataZoom/etc.) so the
 * client chunk stays smaller than `import "echarts"`.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import ReactECharts from "echarts-for-react";
import { use } from "echarts/core";
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

export interface EChartClientProps {
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

export function EChartClient({
  option,
  height = 320,
  onReady,
  className,
  themeVersion = 0,
}: EChartClientProps) {
  const ref = useRef<ReactECharts | null>(null);
  const [tick, setTick] = useState(0);
  const theme = useMemo(() => resolveChartTheme(), [themeVersion, tick]);
  const merged = useMemo(() => mergeWithTheme(option, theme), [option, theme]);

  // Re-read tokens after mount in case the theme provider hasn't written
  // ready-to-use values on the html element on the very first paint.
  useEffect(() => {
    setTick((v) => v + 1);
  }, []);

  useEffect(() => {
    if (!ref.current) return;
    const inst = ref.current.getEchartsInstance();
    onReady?.(inst);
  }, [onReady]);

  return (
    <div
      className={className}
      style={{ height: typeof height === "number" ? `${height}px` : height }}
    >
      <ReactECharts
        ref={ref}
        option={merged}
        style={{ width: "100%", height: "100%" }}
        notMerge
        lazyUpdate
      />
    </div>
  );
}
