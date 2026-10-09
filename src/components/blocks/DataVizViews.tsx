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
  /** Numery przypisów źródeł nadane przez artykuł (patrz `precomputeFootnotes`). */
  footnotes?: ReadonlyMap<string, number>;
}

export function ChartBlockView({ data, lang = "pl", cls, footnotes }: ChartBlockViewProps) {
  const config = parseChartConfig(data);
  return (
    <Chart
      config={config}
      lang={lang}
      className={cls}
      footnoteNumbers={footnotes && footnotes.size > 0 ? footnotes : undefined}
    />
  );
}

export function DataMapBlockView({ data, lang = "pl", cls, footnotes }: ChartBlockViewProps) {
  const config = parseDataMapConfig(data);
  // Źródła mapy numeruje artykuł tak samo jak źródła wykresu - jedna
  // sekwencja przypisów i jedna bibliografia na stronę.
  return (
    <ChoroplethMap
      config={config}
      lang={lang}
      className={cls}
      footnoteNumbers={footnotes && footnotes.size > 0 ? footnotes : undefined}
    />
  );
}
