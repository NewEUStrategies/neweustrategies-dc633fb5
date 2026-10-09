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
  defaultChartConfig,
  parseChartBand,
  parseChartKind,
  parseChartSources,
  parseChartTarget,
  parseMapRegion,
} from "@/lib/charts/parse";
import { isMetricDirection } from "@/lib/charts/status";
import { isProvenance } from "@/lib/charts/sources";
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
    // Domyślne ustawienia uczciwości (wygładzanie 0,55, brak prognozy, pusty
    // podpis) - widget nadpisuje tylko to, co autor naprawdę ustawił.
    ...defaultChartConfig(),
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
    caption: i18nStr(c, "caption", lang),
    ...chartReferenceFields(c),
  };
  return <Chart config={config} lang={lang} className="my-0" />;
}

/**
 * Paleta, kierunek, pochodzenie, pasmo optimum ze swoim źródłem i cel - pola
 * płaskie widgetu złożone w kształt konfiguracji. Pasmo dostaje źródło
 * `band` wyłącznie wtedy, gdy autor podał tytuł albo adres źródła; bez niego
 * silnik pokaże „brak benchmarku", a nie przedział bez przypisu.
 */
function chartReferenceFields(
  c: WidgetNode["content"],
): Pick<ChartConfig, "palette" | "direction" | "provenance" | "band" | "target" | "sources"> {
  const direction = getStr(c, "direction");
  const provenance = getStr(c, "provenance");
  const sources = parseChartSources([
    {
      id: "band",
      author: getStr(c, "bandSourceAuthor"),
      title: getStr(c, "bandSourceTitle"),
      container: getStr(c, "bandSourceContainer"),
      publisher: getStr(c, "bandSourcePublisher"),
      published: getStr(c, "bandSourcePublished"),
      accessed: getStr(c, "bandSourceAccessed"),
      url: getStr(c, "bandSourceUrl"),
      reliability: getStr(c, "bandSourceReliability"),
    },
  ]);
  const band = parseChartBand({
    min: getStr(c, "bandMin"),
    max: getStr(c, "bandMax"),
    sourceId: sources.length > 0 ? "band" : "",
  });
  return {
    palette: getStr(c, "palette") === "categorical" ? "categorical" : "focus",
    direction: isMetricDirection(direction) ? direction : null,
    provenance: isProvenance(provenance) ? provenance : null,
    band,
    target: parseChartTarget(getStr(c, "target")),
    sources,
  };
}

export function DataMapWidgetView({ node, lang }: WidgetProps) {
  const c = node.content;
  // Region przez parser - ta sama droga, co w bloku CMS. Porównanie z dwoma
  // literałami degradowało do Europy KAŻDY region spoza tej pary, więc widget
  // buildera ignorowałby wybór autora z własnego schematu.
  const region: MapRegion = parseMapRegion(getStr(c, "region"));
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
