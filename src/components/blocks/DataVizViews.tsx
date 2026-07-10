// Publiczne renderery bloków wizualizacji danych: "chart" i "data-map".
// Cienkie adaptery: defensywne parsowanie Json -> silnik src/components/charts.
import type { Json } from "@/lib/blocks/types";
import { parseChartConfig, parseDataMapConfig } from "@/lib/charts/parse";
import { Chart } from "@/components/charts/Chart";
import { ChoroplethMap } from "@/components/charts/ChoroplethMap";

type Lang = "pl" | "en";

interface ChartBlockViewProps {
  data: Record<string, Json>;
  lang?: Lang;
  cls?: string;
}

export function ChartBlockView({ data, lang = "pl", cls }: ChartBlockViewProps) {
  const config = parseChartConfig(data);
  return <Chart config={config} lang={lang} className={cls} />;
}

export function DataMapBlockView({ data, lang = "pl", cls }: ChartBlockViewProps) {
  const config = parseDataMapConfig(data);
  return <ChoroplethMap config={config} lang={lang} className={cls} />;
}
