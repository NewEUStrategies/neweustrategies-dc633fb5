// Porównywarka państw - tabela wskaźnik x kolumna (państwo), z opcjonalnymi
// paskami wewnątrz komórek (udział wartości względem maksimum w wierszu).
// Sama w sobie jest kanałem dostępności (to tabela), paski są dekoracją
// (aria-hidden). Wyróżniona kolumna dostaje akcent marki.
import { useMemo } from "react";
import type { CountryCompareConfig, FeatureLang } from "@/lib/features/types";
import { pickBi } from "@/lib/features/types";
import { formatChartValue } from "@/lib/charts/format";
import { FeatureFrame, FEATURE_TABLE_CLS } from "./FeatureFrame";

const L = {
  pl: { empty: "Brak danych do porównania.", indicator: "Wskaźnik", noData: "—" },
  en: { empty: "No comparison data.", indicator: "Indicator", noData: "—" },
} as const;

interface Props {
  config: CountryCompareConfig;
  lang: FeatureLang;
  className?: string;
}

export function CountryCompare({ config, lang, className }: Props) {
  const t = L[lang];

  // Maksimum bezwzględne per wiersz - baza dla szerokości pasków.
  const rowMax = useMemo(
    () =>
      config.rows.map((r) =>
        r.values.reduce<number>((m, v) => (v !== null && Math.abs(v) > m ? Math.abs(v) : m), 0),
      ),
    [config.rows],
  );

  if (config.columns.length === 0 || config.rows.length === 0) {
    return (
      <div
        className={`not-prose my-6 rounded-2xl border border-dashed border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground ${className ?? ""}`}
      >
        {t.empty}
      </div>
    );
  }

  return (
    <FeatureFrame
      title={config.title}
      description={config.description}
      source={config.source}
      className={className}
    >
      <div className="overflow-x-auto">
        <table className={FEATURE_TABLE_CLS.table}>
          <thead>
            <tr>
              <th scope="col" className={FEATURE_TABLE_CLS.th}>
                {t.indicator}
              </th>
              {config.columns.map((col, i) => (
                <th
                  key={i}
                  scope="col"
                  className={`${FEATURE_TABLE_CLS.thNum} ${
                    config.highlight === i ? "text-brand" : ""
                  }`}
                >
                  {pickBi(col, lang)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {config.rows.map((row, ri) => (
              <tr key={ri}>
                <th scope="row" className={`${FEATURE_TABLE_CLS.td} font-medium`}>
                  {pickBi(row.indicator, lang)}
                  {row.unit && (
                    <span className="ml-1 text-xs font-normal text-muted-foreground">
                      [{row.unit}]
                    </span>
                  )}
                </th>
                {config.columns.map((_, ci) => {
                  const v = row.values[ci] ?? null;
                  const max = rowMax[ri];
                  const pct = v !== null && max > 0 ? Math.round((Math.abs(v) / max) * 100) : 0;
                  const highlighted = config.highlight === ci;
                  return (
                    <td key={ci} className={FEATURE_TABLE_CLS.tdNum}>
                      {config.showBars && v !== null && (
                        <span
                          aria-hidden
                          className="mr-2 inline-block h-1.5 rounded-full align-middle"
                          style={{
                            width: `${Math.max(4, pct * 0.5)}px`,
                            background: highlighted
                              ? "var(--brand)"
                              : "color-mix(in oklab, var(--chart-1) 70%, transparent)",
                          }}
                        />
                      )}
                      <span className={highlighted ? "font-semibold text-brand" : ""}>
                        {v !== null ? formatChartValue(v, lang, row.unit) : t.noData}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </FeatureFrame>
  );
}
