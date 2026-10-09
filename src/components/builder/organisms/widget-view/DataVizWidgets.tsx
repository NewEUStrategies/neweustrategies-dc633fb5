// Buildera renderery widgetów wizualizacji danych: "chart" i "data-map".
// Cienkie widoki: treść widgetu (pola i18n *_pl/_en + textarea CSV) ->
// konfiguracja wspólnego silnika src/components/charts (ten sam, którego
// używają bloki CMS - jedna implementacja na obu platformach).
//
// Przekład treści na konfigurację NIE mieszka tutaj, tylko w
// `src/lib/charts/widgetConfig.ts`: idzie przez ten sam parser co blok CMS
// i czyta go też podgląd w dialogu arkusza, więc widok, podgląd i blok nie
// mogą się rozjechać co do żadnego pola.
//
// Ładowane przez lazyWidgets.tsx (React.lazy), więc silnik wykresów nie
// trafia do współdzielonego bundla Header/Footer.
import { useMemo } from "react";
import type { WidgetNode } from "@/lib/builder/types";
import { widgetChartConfig, widgetMapConfig } from "@/lib/charts/widgetConfig";
import { Chart } from "@/components/charts/Chart";
import { ChoroplethMap } from "@/components/charts/ChoroplethMap";
import type { Lang } from "./frame";

interface WidgetProps {
  node: WidgetNode;
  lang: Lang;
}

export function ChartWidgetView({ node, lang }: WidgetProps) {
  const config = useMemo(() => widgetChartConfig(node.content, lang), [node.content, lang]);
  return <Chart config={config} lang={lang} className="my-0" />;
}

export function DataMapWidgetView({ node, lang }: WidgetProps) {
  const config = useMemo(() => widgetMapConfig(node.content, lang), [node.content, lang]);
  return <ChoroplethMap config={config} lang={lang} className="my-0" />;
}
