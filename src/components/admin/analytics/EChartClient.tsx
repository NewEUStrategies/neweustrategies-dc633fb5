/**
 * Real ECharts renderer. Imported ONLY via `React.lazy` from ./EChart so the
 * SSR module graph never reaches it - see the comment in EChart.tsx for why.
 *
 * Registers only the components we actually use (bar / line / pie / heatmap /
 * treemap / gauge / radar / sankey + tooltip/legend/grid/dataZoom/etc.) so the
 * client chunk stays smaller than `import "echarts"`.
 */
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
// `echarts-for-react` (główny entry) robi `import * as echarts from "echarts"`,
// czyli ciągnie CAŁĄ bibliotekę i unieważnia modularną rejestrację poniżej
// (chunk miał ~590 KB gzip). Wariant lib/core przyjmuje instancję echarts
// przez prop - podajemy odchudzony `echarts/core`, więc do bundla wchodzą
// tylko zarejestrowane wykresy/komponenty.
import ReactECharts from "echarts-for-react/lib/core";
import * as echartsCore from "echarts/core";
// Alias: `use` z echarts/core to funkcja rejestracji modułów, nie hook Reacta -
// pod oryginalną nazwą wpada pod react-hooks/rules-of-hooks.
const echartsUse = echartsCore.use;
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
import {
  baseOption,
  chartThemeSnapshot,
  mergeChartOption,
  scheduleChartThemeRefresh,
  subscribeChartTheme,
  type ResolvedTheme,
} from "./chartTheme";
import type { ChartClickParams } from "./ChartDrillDialog";

echartsUse([
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
  onDataClick?: (params: ChartClickParams) => void;
  className?: string;
  themeVersion?: number;
}

/**
 * Opcja panelu ZŁOŻONA na bazie motywu - GŁĘBOKO, nie płasko.
 *
 * Stało tu `{ ...base, ...option }`. Rozłożenie płaskie podmienia CAŁĄ wartość
 * pod kluczem, więc panel, który podawał `yAxis` choćby tylko po to, żeby
 * ustawić `max` albo `axisLabel.formatter`, wyrzucał z tej osi WSZYSTKO, co
 * baza w niej umotywowała (`axisLine`, `axisTick`, `splitLine`, `axisLabel`).
 * ZMIERZONE: 27 opcji wykresów w 8 plikach, 89 wystąpień sekcji, 74 z nich
 * z kolorami motywu - rachunek i reguły złączenia stoją nad
 * `mergeChartOption` w `./chartTheme.ts`.
 *
 * Rzutowania są tutaj, a nie w `mergeChartOption`, bo tamta funkcja jest
 * strukturalna i nie wie nic o ECharts - dzięki temu sprawdza się bez atrapy
 * silnika wykresów.
 */
function mergeWithTheme(option: EChartsCoreOption, theme: ResolvedTheme): EChartsCoreOption {
  return mergeChartOption(
    baseOption(theme) as Record<string, unknown>,
    option as Record<string, unknown>,
  ) as EChartsCoreOption;
}

export function EChartClient({
  option,
  height = 320,
  onReady,
  onDataClick,
  className,
  themeVersion = 0,
}: EChartClientProps) {
  const ref = useRef<ReactECharts | null>(null);
  // JEDNA subskrypcja motywu na dokument, nie jeden efekt na wykres.
  //
  // Stało tu `useState` + `useEffect(() => setTick(v => v + 1), [])`: efekt
  // bezwarunkowy, więc KAŻDY wykres renderował się dwa razy i dwa razy
  // rozwiązywał motyw, choćby tokeny były gotowe od pierwszego malowania.
  // Powód, dla którego istniał, jest prawdziwy (`DesignTokensStyle` wstrzykuje
  // paletę tenanta z bazy i może dojechać po montowaniu) i został ZACHOWANY -
  // przeniesiony do wspólnego magazynu w `chartTheme.ts`, który przelicza motyw
  // raz, porównuje z poprzednim i budzi wykresy tylko przy realnej zmianie.
  // Zmierzone na panelu dziesięciu wykresów: 20 -> 10 renderów, 20 -> 2
  // rozwiązania motywu, 200 -> 2 wywołania `getComputedStyle`.
  const theme = useSyncExternalStore(subscribeChartTheme, chartThemeSnapshot, chartThemeSnapshot);
  const merged = useMemo(() => mergeWithTheme(option, theme), [option, theme]);
  const clickRef = useRef<((p: ChartClickParams) => void) | undefined>(onDataClick);
  clickRef.current = onDataClick;

  // Po zamontowaniu: JEDNO odświeżenie na turę dla całego panelu, choćby
  // zawołało je dziesięć wykresów naraz (koalescencja w `chartTheme.ts`).
  useEffect(() => {
    scheduleChartThemeRefresh();
  }, []);

  // Jawny sygnał od wywołującego (przełącznik trybu jasny/ciemny wędruje przez
  // `ChartCard`): przelicz i rozgłoś WSZYSTKIM wykresom, żeby panel nie został
  // z dwiema paletami naraz. Referencja zjada przebieg montujący - bez niej
  // każdy wykres wołałby to na starcie i wróciłby koszt sprzed zmiany.
  //
  // Przez `scheduleChartThemeRefresh`, NIE przez `notifyChartThemeChanged`:
  // `themeVersion` zmienia się CAŁEMU panelowi naraz, więc bezpośrednie
  // rozgłoszenie znaczyło N rozwiązań motywu na jedno przełączenie trybu
  // (ZMIERZONE na dziesięciu wykresach: 10 wywołań `getComputedStyle` -> 1).
  // Ścieżka montująca koalescencjonuje od początku; ta nie miała powodu być inna.
  const lastThemeVersion = useRef(themeVersion);
  useEffect(() => {
    if (lastThemeVersion.current === themeVersion) return;
    lastThemeVersion.current = themeVersion;
    scheduleChartThemeRefresh();
  }, [themeVersion]);

  useEffect(() => {
    if (!ref.current) return;
    const inst = ref.current.getEchartsInstance();
    onReady?.(inst);
    // Register once; ref keeps handler fresh across renders.
    const handler = (params: unknown) => clickRef.current?.(params as ChartClickParams);
    inst.on("click", handler);
    return () => {
      inst.off("click", handler);
    };
  }, [onReady]);

  return (
    <div
      className={className}
      style={{
        height: typeof height === "number" ? `${height}px` : height,
        cursor: onDataClick ? "pointer" : undefined,
      }}
    >
      <ReactECharts
        ref={ref}
        echarts={echartsCore}
        option={merged}
        style={{ width: "100%", height: "100%" }}
        notMerge
        lazyUpdate
      />
    </div>
  );
}
