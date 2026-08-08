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
import { toInsightSeries, type InsightBar } from "@/lib/clubs/workspaceTypes";
import { formatDateShort } from "@/lib/i18n/format";

/** Cztery serie w stałej kolejności i stałych kolorach. Kolejność jest
 *  kolejnością W LEGENDZIE, w słupku i w tabeli - trzy różne porządki dla tych
 *  samych danych zmuszałyby do czytania wykresu za każdym razem od nowa. */
const SERIES = [
  { key: "replies", cls: "bg-primary/80" },
  { key: "questions", cls: "bg-amber-500/80" },
  { key: "documents", cls: "bg-sky-500/80" },
  { key: "milestones", cls: "bg-emerald-500/80" },
] as const;

function segments(bar: InsightBar): { key: string; value: number; cls: string }[] {
  return SERIES.map((series) => ({
    key: series.key,
    value: bar[series.key],
    cls: series.cls,
  })).filter((segment) => segment.value > 0);
}

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

  const first = series.bars[0];
  const last = series.bars[series.bars.length - 1];
  const rangeLabel =
    first !== undefined && last !== undefined
      ? `${formatDateShort(first.start, lang)} - ${formatDateShort(last.end, lang)}`
      : "";

  return (
    <div className="space-y-4">
      {/* Cztery liczby zbiorcze - to jest odpowiedź, po którą większość
          czytelników tu przychodzi; wykres jest dla tych, którzy chcą wiedzieć
          KIEDY. */}
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {SERIES.map((entry) => (
          <div key={entry.key} className="rounded-xl border border-border/60 bg-card p-3">
            <dt className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
              <span aria-hidden="true" className={`h-2 w-2 rounded-sm ${entry.cls}`} />
              {t(`club.workspace.insights.series.${entry.key}`)}
            </dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums">{series.totals[entry.key]}</dd>
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
                segments(bar).map((segment) => (
                  <span
                    key={segment.key}
                    className={`rounded-[2px] transition-[height] duration-500 ${segment.cls}`}
                    style={{
                      // Wysokość liczona wobec SZCZYTU, nie wobec sumy: słupki
                      // mają porównywać się między sobą.
                      height: `${Math.max(3, Math.round((segment.value / Math.max(1, series.peak)) * 100))}%`,
                    }}
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
              {SERIES.map((entry) => (
                <th key={entry.key} scope="col">
                  {t(`club.workspace.insights.series.${entry.key}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {series.bars.map((bar) => (
              <tr key={bar.index}>
                <th scope="row">{formatDateShort(bar.start, lang)}</th>
                {SERIES.map((entry) => (
                  <td key={entry.key}>{bar[entry.key]}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
