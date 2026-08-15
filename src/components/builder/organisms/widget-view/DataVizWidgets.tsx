// Buildera renderery widgetów wizualizacji danych: "chart" i "data-map".
// Cienkie adaptery: treść widgetu (pola i18n *_pl/_en + textarea CSV) ->
// konfiguracja wspólnego silnika src/components/charts (ten sam, którego
// używają bloki CMS - jedna implementacja na obu platformach).
//
// Ładowane przez lazyWidgets.tsx (React.lazy), więc silnik wykresów nie
// trafia do współdzielonego bundla Header/Footer.
import type { WidgetNode } from "@/lib/builder/types";
import type { ChartConfig, DataMapConfig, MapRegion } from "@/lib/charts/types";
import {
  CHART_HEIGHT_DEFAULT,
  CHART_HEIGHT_MAX,
  CHART_HEIGHT_MIN,
  parseChartKind,
} from "@/lib/charts/parse";
import { parseChartData, parseMapData } from "@/lib/charts/csv";
import { Chart } from "@/components/charts/Chart";
import { ChoroplethMap } from "@/components/charts/ChoroplethMap";
import { getStr, getNum, type Lang } from "./frame";

interface WidgetProps {
  node: WidgetNode;
  lang: Lang;
}

function i18nStr(c: WidgetNode["content"], base: string, lang: Lang): string {
  return getStr(c, `${base}_${lang}`) || getStr(c, `${base}_pl`) || getStr(c, `${base}_en`);
}

export function ChartWidgetView({ node, lang }: WidgetProps) {
  const c = node.content;
  const { categories, series } = parseChartData(getStr(c, "data"));
  const config: ChartConfig = {
    kind: parseChartKind(getStr(c, "kind")),
    title: i18nStr(c, "title", lang),
    description: i18nStr(c, "description", lang),
    categories,
    series,
    stacked: getStr(c, "stacked") === "on",
    unit: getStr(c, "unit"),
    height: Math.max(
      CHART_HEIGHT_MIN,
      Math.min(CHART_HEIGHT_MAX, getNum(c, "height", CHART_HEIGHT_DEFAULT)),
    ),
    showLegend: getStr(c, "showLegend") !== "off",
    showGrid: getStr(c, "showGrid") !== "off",
    showValues: getStr(c, "showValues") === "on",
    animate: getStr(c, "animate") !== "off",
    source: i18nStr(c, "source", lang),
  };
  return <Chart config={config} lang={lang} className="my-0" />;
}

export function DataMapWidgetView({ node, lang }: WidgetProps) {
  const c = node.content;
  const region: MapRegion = getStr(c, "region") === "world" ? "world" : "europe";
  const config: DataMapConfig = {
    region,
    title: i18nStr(c, "title", lang),
    description: i18nStr(c, "description", lang),
    unit: getStr(c, "unit"),
    values: parseMapData(getStr(c, "data")),
    showLegend: getStr(c, "showLegend") !== "off",
    animate: getStr(c, "animate") !== "off",
    source: i18nStr(c, "source", lang),
  };
  return <ChoroplethMap config={config} lang={lang} className="my-0" />;
}
