// Punkt wejścia silnika wykresów: ChartFrame (karta, legenda, tabela danych,
// źródło) + właściwy rysunek zależnie od `kind`. Konsumowany przez blok CMS
// ("chart") i widget buildera ("chart") - jedna implementacja, obie platformy.
import { useMemo } from "react";
import type { ChartConfig } from "@/lib/charts/types";
import { formatChartValue, formatPercent, type ChartLang } from "@/lib/charts/format";
import { ChartFrame, CHART_TABLE_CLS, type LegendItem } from "./ChartFrame";
import { CartesianChart } from "./CartesianChart";
import { PieChart } from "./PieChart";
import { pieModel, pieShare } from "./pieModel";

const L = {
  pl: { category: "Kategoria", value: "Wartość", share: "Udział", empty: "Brak danych wykresu." },
  en: { category: "Category", value: "Value", share: "Share", empty: "No chart data." },
} as const;

interface ChartProps {
  config: ChartConfig;
  lang: ChartLang;
  className?: string;
}

export function Chart({ config, lang, className }: ChartProps) {
  const t = L[lang];
  const isPie = config.kind === "pie" || config.kind === "donut";

  const legend: LegendItem[] = useMemo(() => {
    if (isPie) {
      // Próbka legendy musi wskazywać DOKŁADNIE jeden wycinek, więc klucz
      // idzie z tego samego modelu, co tarcza - razem z wycinkiem zbiorczym
      // nadmiaru kategorii i bez kategorii, których tarcza nie rysuje.
      return pieModel(config, lang).slices.map((s) => ({
        name: s.label,
        colorSlot: s.colorSlot,
        shape: "rect" as const,
      }));
    }
    const shape =
      config.kind === "line" || config.kind === "area" ? ("line" as const) : ("rect" as const);
    return config.series.map((s) => ({ name: s.name, colorSlot: s.colorSlot, shape }));
  }, [config, lang, isPie]);

  const hasData =
    config.categories.length > 0 &&
    config.series.length > 0 &&
    config.series.some((s) => s.values.some((v) => v !== null));

  if (!hasData) {
    return (
      <div
        className={`not-prose my-6 rounded-2xl border border-dashed border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground ${className ?? ""}`}
      >
        {t.empty}
      </div>
    );
  }

  const table = isPie ? (
    <PieDataTable config={config} lang={lang} />
  ) : (
    <SeriesDataTable config={config} lang={lang} />
  );

  return (
    <ChartFrame
      title={config.title}
      description={config.description}
      source={config.source}
      lang={lang}
      legend={legend}
      showLegend={config.showLegend}
      table={table}
      className={className}
    >
      {isPie ? (
        <PieChart config={config} lang={lang} />
      ) : (
        <CartesianChart config={config} lang={lang} />
      )}
    </ChartFrame>
  );
}

function SeriesDataTable({ config, lang }: { config: ChartConfig; lang: ChartLang }) {
  const t = L[lang];
  return (
    <table className={CHART_TABLE_CLS.table}>
      <thead>
        <tr>
          <th scope="col" className={CHART_TABLE_CLS.th}>
            {t.category}
          </th>
          {config.series.map((s) => (
            <th key={s.colorSlot + s.name} scope="col" className={CHART_TABLE_CLS.thNum}>
              {s.name || t.value}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {config.categories.map((cat, i) => (
          <tr key={i}>
            <th scope="row" className={`${CHART_TABLE_CLS.td} font-medium`}>
              {cat}
            </th>
            {config.series.map((s) => (
              <td key={s.colorSlot + s.name} className={CHART_TABLE_CLS.tdNum}>
                {s.values[i] === null
                  ? "-"
                  : formatChartValue(s.values[i] as number, lang, config.unit)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PieDataTable({ config, lang }: { config: ChartConfig; lang: ChartLang }) {
  const t = L[lang];
  const values = config.categories.map((label, i) => ({
    label,
    value: config.series[0]?.values[i] ?? null,
  }));
  // Mianownik TEN SAM, którym liczy kąty tarcza (`pieModel`): suma dodatnich.
  // Sumowanie wszystkiego rozjeżdżało grafikę z jej alternatywą tekstową -
  // zestaw [-10, 100] dawał na tarczy jeden wycinek 100%, a w tabeli "111%"
  // i "-11,1%". Każdy wiersz zostaje (tabela to jedyna pełna droga do liczb),
  // ale udział mówi o tym, co tarcza rzeczywiście rysuje.
  const { total } = pieModel(config, lang);
  return (
    <table className={CHART_TABLE_CLS.table}>
      <thead>
        <tr>
          <th scope="col" className={CHART_TABLE_CLS.th}>
            {t.category}
          </th>
          <th scope="col" className={CHART_TABLE_CLS.thNum}>
            {t.value}
          </th>
          <th scope="col" className={CHART_TABLE_CLS.thNum}>
            {t.share}
          </th>
        </tr>
      </thead>
      <tbody>
        {values.map((v, i) => (
          <tr key={i}>
            <th scope="row" className={`${CHART_TABLE_CLS.td} font-medium`}>
              {v.label}
            </th>
            <td className={CHART_TABLE_CLS.tdNum}>
              {v.value === null ? "-" : formatChartValue(v.value, lang, config.unit)}
            </td>
            <td className={CHART_TABLE_CLS.tdNum}>
              {v.value === null || total <= 0 ? "-" : formatPercent(pieShare(v.value, total), lang)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
