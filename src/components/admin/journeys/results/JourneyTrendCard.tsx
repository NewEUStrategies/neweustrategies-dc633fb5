// Wejścia, cele i wyjścia dziennie (S8, SPEC §6.3 „Wyniki”: „wejścia/cele
// w czasie (`line`)”) - `ChartCard` + `biChart` silnika wykresów huba.
//
// PRZERWA ZAMIAST ZERA (Z-I9c-06). Seria czyta tylko surowe zapisy, a dni
// zapieczętowane retencją już ich nie mają - `journeySeriesChart` zamienia je
// w `null`, a karta mówi pod wykresem, od kiedy dane dzienne są pełne. Spadek
// do zera na starcie okna czytałby się jak „nikt nie wchodził”.
//
// Łamana bez wygładzania: szereg dzienny z małymi liczbami wygładzony
// rysowałby wartości pośrednie (pół zapisu), których nie było.
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { ChartCard } from "@/components/admin/analytics/ChartCard";
import { biChart } from "@/components/admin/analytics/biChart";
import { Button } from "@/components/ui/button";
import { journeySeriesChart } from "@/lib/admin/journeys/results";
import { chartLangFrom } from "@/lib/charts/format";
import { formatDateOnly } from "@/lib/i18n/format";
import { ensureI18n as ensureListI18n } from "@/lib/i18n-admin-journeys-list";
import { ensureI18n } from "@/lib/i18n-admin-journeys-results";
import type { JourneySeriesPoint } from "@/lib/journeys/dto";

export interface JourneyTrendCardProps {
  points: readonly JourneySeriesPoint[] | null;
  /** Pierwszy dzień z pełnymi danymi dziennymi (retencja); `null` = całe okno pełne albo nieznane. */
  fullDataFrom: string | null;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
}

export function JourneyTrendCard({
  points,
  fullDataFrom,
  isLoading,
  isError,
  onRetry,
}: JourneyTrendCardProps) {
  ensureListI18n();
  ensureI18n();
  const { t, i18n } = useTranslation();
  const lang = chartLangFrom(i18n.language);
  const chart = useMemo(() => journeySeriesChart(points, fullDataFrom), [points, fullDataFrom]);
  const labels = {
    enrolled: t("adminJourneys.results.trend.enrolled"),
    goalReached: t("adminJourneys.results.trend.goalReached"),
    exited: t("adminJourneys.results.trend.exited"),
  };

  if (isError) {
    return (
      <div role="alert" className="space-y-2 rounded-[6px] border border-border p-3 text-sm">
        <p className="m-0 text-destructive">{t("adminJourneys.results.trend.loadError")}</p>
        <Button type="button" size="sm" variant="outline" className="h-7" onClick={onRetry}>
          {t("adminJourneys.common.retry")}
        </Button>
      </div>
    );
  }
  if (isLoading && !points) {
    return (
      <p role="status" className="m-0 text-sm text-muted-foreground">
        {t("adminJourneys.results.loading")}
      </p>
    );
  }

  const gapNote = chart.gapBefore ? (
    <p className="m-0 text-[11px] text-muted-foreground" data-testid="journey-trend-gap">
      {t("adminJourneys.results.trend.gap", { date: formatDateOnly(chart.gapBefore, lang) })}
    </p>
  ) : null;

  if (!chart.hasData) {
    return (
      <div className="space-y-1 rounded-[6px] border border-border p-3">
        <p className="m-0 text-sm font-semibold">{t("adminJourneys.results.trend.title")}</p>
        <p className="m-0 text-sm text-muted-foreground">
          {t("adminJourneys.results.trend.empty")}
        </p>
        {gapNote}
      </div>
    );
  }

  const config = biChart({
    kind: "line",
    categories: chart.categories.map((day) =>
      formatDateOnly(day, lang, { day: "2-digit", month: "2-digit" }),
    ),
    series: [
      { name: labels.enrolled, values: chart.enrolled },
      { name: labels.goalReached, values: chart.goalReached },
      { name: labels.exited, values: chart.exited },
    ],
    smoothing: 0,
    lang,
  });

  return (
    <ChartCard
      title={t("adminJourneys.results.trend.title")}
      subtitle={t("adminJourneys.results.trend.subtitle")}
      config={config}
      height={240}
      csv={{
        filename: "journey-daily.csv",
        headers: ["day", labels.enrolled, labels.goalReached, labels.exited],
        rows: chart.categories.map((day, index) => [
          day,
          chart.enrolled[index],
          chart.goalReached[index],
          chart.exited[index],
        ]),
      }}
      footer={gapNote}
    />
  );
}
