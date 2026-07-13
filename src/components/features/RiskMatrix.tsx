// Macierz ryzyka 5x5: oś X = wpływ, oś Y = prawdopodobieństwo. Komórki
// cieniowane od zieleni (niskie) do czerwieni (wysokie) wg iloczynu
// prawdopodobieństwo x wpływ. Elementy ryzyka są rozmieszczane w komórkach;
// gdy kilka trafia w tę samą komórkę, numerujemy je i legenda pod spodem
// rozwiązuje numery na nazwy (jest też pełna tabela dostępności).
import { useMemo } from "react";
import type { RiskMatrixConfig, FeatureLang } from "@/lib/features/types";
import { pickBi } from "@/lib/features/types";
import { FeatureFrame, FeatureDataTable, FEATURE_TABLE_CLS } from "./FeatureFrame";

const L = {
  pl: {
    empty: "Brak elementów ryzyka.",
    impact: "Wpływ →",
    likelihood: "Prawdopodobieństwo →",
    lo: "niskie",
    hi: "wysokie",
    risk: "Ryzyko",
    l: "Prawdop.",
    i: "Wpływ",
    score: "Wynik",
    data: "Pokaż tabelę ryzyk",
    legend: "Legenda",
  },
  en: {
    empty: "No risk items.",
    impact: "Impact →",
    likelihood: "Likelihood →",
    lo: "low",
    hi: "high",
    risk: "Risk",
    l: "Likelihood",
    i: "Impact",
    score: "Score",
    data: "Show risk table",
    legend: "Legend",
  },
} as const;

interface Props {
  config: RiskMatrixConfig;
  lang: FeatureLang;
  className?: string;
}

/** Kolor komórki wg wyniku 1..25: zielony -> bursztyn -> czerwony. */
function cellColor(score: number): string {
  const share = (score - 1) / 24; // 0..1
  // Interpolacja przez punkt środkowy (bursztyn) dla czytelnego "ciepła".
  if (share < 0.5) {
    const k = Math.round(share * 2 * 100);
    return `color-mix(in oklab, var(--chart-3) ${k}%, var(--chart-2))`;
  }
  const k = Math.round((share - 0.5) * 2 * 100);
  return `color-mix(in oklab, var(--chart-6) ${k}%, var(--chart-3))`;
}

export function RiskMatrix({ config, lang, className }: Props) {
  const t = L[lang];

  // Rozmieszczenie w komórkach: klucz "L-I" -> lista indeksów elementów.
  const byCell = useMemo(() => {
    const m = new Map<string, number[]>();
    config.items.forEach((it, idx) => {
      const key = `${it.likelihood}-${it.impact}`;
      const arr = m.get(key);
      if (arr) arr.push(idx);
      else m.set(key, [idx]);
    });
    return m;
  }, [config.items]);

  if (config.items.length === 0) {
    return (
      <div
        className={`not-prose my-6 rounded-2xl border border-dashed border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground ${className ?? ""}`}
      >
        {t.empty}
      </div>
    );
  }

  const rows = [5, 4, 3, 2, 1]; // likelihood od góry
  const cols = [1, 2, 3, 4, 5]; // impact od lewej

  const table = (
    <table className={FEATURE_TABLE_CLS.table}>
      <thead>
        <tr>
          <th scope="col" className={FEATURE_TABLE_CLS.th}>
            #
          </th>
          <th scope="col" className={FEATURE_TABLE_CLS.th}>
            {t.risk}
          </th>
          <th scope="col" className={FEATURE_TABLE_CLS.thNum}>
            {t.l}
          </th>
          <th scope="col" className={FEATURE_TABLE_CLS.thNum}>
            {t.i}
          </th>
          <th scope="col" className={FEATURE_TABLE_CLS.thNum}>
            {t.score}
          </th>
        </tr>
      </thead>
      <tbody>
        {config.items.map((it, idx) => (
          <tr key={idx}>
            <td className={FEATURE_TABLE_CLS.tdNum}>{idx + 1}</td>
            <th scope="row" className={`${FEATURE_TABLE_CLS.td} font-medium`}>
              {pickBi(it.name, lang)}
              {pickBi(it.description, lang) && (
                <span className="block text-xs font-normal text-muted-foreground">
                  {pickBi(it.description, lang)}
                </span>
              )}
            </th>
            <td className={FEATURE_TABLE_CLS.tdNum}>{it.likelihood}</td>
            <td className={FEATURE_TABLE_CLS.tdNum}>{it.impact}</td>
            <td className={FEATURE_TABLE_CLS.tdNum}>{it.likelihood * it.impact}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <FeatureFrame
      title={config.title}
      description={config.description}
      source={config.source}
      className={className}
      footer={<FeatureDataTable label={t.data}>{table}</FeatureDataTable>}
    >
      <div className="flex gap-2">
        {/* Etykieta osi Y (pionowa). */}
        <div className="flex flex-col items-center justify-center">
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground [writing-mode:vertical-rl] rotate-180">
            {config.axisYLabel || t.likelihood}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="grid grid-cols-5 gap-1">
            {rows.map((likelihood) =>
              cols.map((impact) => {
                const score = likelihood * impact;
                const idxs = byCell.get(`${likelihood}-${impact}`) ?? [];
                return (
                  <div
                    key={`${likelihood}-${impact}`}
                    className="relative flex aspect-[4/3] items-center justify-center gap-1 rounded-md p-1 text-center"
                    style={{ background: cellColor(score) }}
                  >
                    {idxs.map((idx) => (
                      <span
                        key={idx}
                        title={pickBi(config.items[idx].name, lang)}
                        className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-background/85 text-xs font-bold text-foreground shadow-sm"
                      >
                        {idx + 1}
                      </span>
                    ))}
                  </div>
                );
              }),
            )}
          </div>
          <div className="mt-1 flex justify-between text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            <span>{config.axisXLabel || t.impact}</span>
            <span>
              {t.lo} → {t.hi}
            </span>
          </div>
        </div>
      </div>

      {/* Legenda numerów -> nazwy (pierwsze 8, reszta w tabeli). */}
      <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {config.items.slice(0, 8).map((it, idx) => (
          <li key={idx} className="flex items-center gap-1.5">
            <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-muted text-[10px] font-bold text-foreground">
              {idx + 1}
            </span>
            {pickBi(it.name, lang)}
          </li>
        ))}
      </ul>
    </FeatureFrame>
  );
}
