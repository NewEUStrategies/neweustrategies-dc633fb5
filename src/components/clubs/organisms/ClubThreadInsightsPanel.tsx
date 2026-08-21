// Organizm: panel „Dane" - wizualizacje aktywności wątku.
//
// DLACZEGO GOŁE SVG, A NIE SILNIK WYKRESÓW. Platforma ma pełny silnik
// (`components/charts`, ECharts) i on jest właściwy tam, gdzie autor rysuje
// dowolne dane w treści wpisu. Tutaj rysujemy CZTERY serie po dwadzieścia
// kilka słupków o znanym z góry kształcie - a ECharts kosztuje kilkadziesiąt
// kB na trasie wątku, która ma być szybka. Ta sama decyzja i to samo
// uzasadnienie, co w `ClubThreadPulse`.
//
// Wykres jest `role="img"` z pełnym opisem w `aria-label`, a pod nim stoi
// TABELA z tymi samymi liczbami. Wykres, którego nie da się przeczytać inaczej
// niż wzrokiem, jest ozdobą, a nie danymi.
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { BarChart3 } from "lucide-react";
import { ClubWorkspaceEmpty } from "@/components/clubs/atoms/ClubWorkspaceEmpty";
import { ClubErrorNotice } from "@/components/clubs/molecules/ClubErrorNotice";
import { useClubThreadInsights } from "@/lib/clubs/useClubWorkspace";
import { toInsightSeries } from "@/lib/clubs/workspaceTypes";
import {
  INSIGHT_SERIES_KEYS,
  insightBarPercent,
  insightRangeLabel,
  insightSegments,
  type InsightSeriesKey,
} from "@/lib/clubs/insightChart";
import { formatDateShort } from "@/lib/i18n/format";

/** KOLEJNOŚĆ serii jest regułą i mieszka w `insightChart` (ta sama w legendzie,
 *  w słupku i w tabeli). Tutaj zostaje wyłącznie KOLOR - to jedyna część tej
 *  czwórki, która jest układem, a nie decyzją o danych. */
const SERIES_CLASS: Record<InsightSeriesKey, string> = {
  replies: "bg-primary/80",
  questions: "bg-amber-500/80",
  documents: "bg-sky-500/80",
  milestones: "bg-emerald-500/80",
};

export function ClubThreadInsightsPanel({
  threadId,
  lang,
}: {
  threadId: string;
  lang: "pl" | "en";
}) {
  const { t } = useTranslation();
  const query = useClubThreadInsights({ threadId });
  const series = useMemo(() => toInsightSeries(query.data ?? []), [query.data]);

  if (query.isPending) {
    return <div className="h-56 animate-pulse rounded-xl bg-muted/50" aria-busy="true" />;
  }
  if (query.isError) return <ClubErrorNotice onRetry={() => void query.refetch()} />;

  if (series.grandTotal === 0) {
    return (
      <ClubWorkspaceEmpty
        icon={<BarChart3 className="h-5 w-5" />}
        title={t("club.workspace.insights.empty")}
        hint={t("club.workspace.insights.emptyHint")}
      />
    );
  }

  const rangeLabel = insightRangeLabel(series.bars, lang);

  return (
    <div className="space-y-4">
      {/* Cztery liczby zbiorcze - to jest odpowiedź, po którą większość
          czytelników tu przychodzi; wykres jest dla tych, którzy chcą wiedzieć
          KIEDY. */}
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {INSIGHT_SERIES_KEYS.map((key) => (
          <div key={key} className="rounded-xl border border-border/60 bg-card p-3">
            <dt className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
              <span aria-hidden="true" className={`h-2 w-2 rounded-sm ${SERIES_CLASS[key]}`} />
              {t(`club.workspace.insights.series.${key}`)}
            </dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums">{series.totals[key]}</dd>
          </div>
        ))}
      </dl>

      <section className="rounded-xl border border-border/60 bg-card p-3 sm:p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("club.workspace.insights.timeline")}
          </h3>
          <p className="text-[11px] text-muted-foreground">{rangeLabel}</p>
        </div>

        <div
          role="img"
          aria-label={t("club.workspace.insights.chartAria", {
            total: series.grandTotal,
            range: rangeLabel,
          })}
          className="mt-3 flex h-32 items-end gap-[3px]"
        >
          {series.bars.map((bar) => (
            <div
              key={bar.index}
              className="flex h-full flex-1 flex-col justify-end gap-[1px]"
              title={`${formatDateShort(bar.start, lang)}: ${bar.total}`}
            >
              {bar.total === 0 ? (
                <span className="h-[3px] rounded-[2px] bg-muted" />
              ) : (
                insightSegments(bar).map((segment) => (
                  <span
                    key={segment.key}
                    className={`rounded-[2px] transition-[height] duration-500 ${SERIES_CLASS[segment.key]}`}
                    // Wysokość liczona wobec SZCZYTU, nie wobec sumy: słupki
                    // mają porównywać się między sobą.
                    style={{ height: `${insightBarPercent(segment.value, series.peak)}%` }}
                  />
                ))
              )}
            </div>
          ))}
        </div>

        {/* Tabela dostępnościowa: te same liczby, czytelne dla czytnika ekranu
            i do skopiowania. Ukryta wizualnie, bo obok stoi wykres. */}
        <table className="sr-only">
          <caption>{t("club.workspace.insights.tableCaption")}</caption>
          <thead>
            <tr>
              <th scope="col">{t("club.workspace.insights.period")}</th>
              {INSIGHT_SERIES_KEYS.map((key) => (
                <th key={key} scope="col">
                  {t(`club.workspace.insights.series.${key}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {series.bars.map((bar) => (
              <tr key={bar.index}>
                <th scope="row">{formatDateShort(bar.start, lang)}</th>
                {INSIGHT_SERIES_KEYS.map((key) => (
                  <td key={key}>{bar[key]}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
