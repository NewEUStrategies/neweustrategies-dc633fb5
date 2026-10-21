// Powody wyjścia ze ścieżki (S8, SPEC §6.3 „Wyniki”: `bar-horizontal`) -
// zapisy zakończone przed końcem ścieżki według powodu (`journey.exited`).
//
// Słupki poziome, bo kategorie to zdania („Brak zgody marketingowej”), które
// pod słupkiem pionowym trzeba by łamać albo ucinać. Etykiety powodów
// z jednego słownika silnika (`exitReason`) - te same co na liście kontaktów
// i w karcie leada. Brak wyjść to zdanie, nie pusty wykres.
import { useTranslation } from "react-i18next";

import { ChartCard } from "@/components/admin/analytics/ChartCard";
import { biChart } from "@/components/admin/analytics/biChart";
import type { JourneyExitRow } from "@/lib/admin/journeys/results";
import { chartLangFrom } from "@/lib/charts/format";
import { ensureI18n as ensureJourneysI18n } from "@/lib/i18n-admin-journeys";
import { ensureI18n } from "@/lib/i18n-admin-journeys-results";
import { journeyLabelKey } from "@/lib/journeys/labels";

export interface JourneyExitsCardProps {
  rows: readonly JourneyExitRow[];
}

export function JourneyExitsCard({ rows }: JourneyExitsCardProps) {
  ensureJourneysI18n();
  ensureI18n();
  const { t, i18n } = useTranslation();
  const lang = chartLangFrom(i18n.language);

  if (rows.length === 0) {
    return (
      <div className="space-y-1 rounded-[6px] border border-border p-3">
        <p className="m-0 text-sm font-semibold">{t("adminJourneys.results.exits.title")}</p>
        <p className="m-0 text-sm text-muted-foreground">
          {t("adminJourneys.results.exits.empty")}
        </p>
      </div>
    );
  }

  const categories = rows.map((row) => t(journeyLabelKey("exitReason", row.reason)));
  const series = t("adminJourneys.results.exits.series");
  const config = biChart({
    kind: "bar-horizontal",
    categories,
    series: [{ name: series, values: rows.map((row) => row.count) }],
    showValues: true,
    showLegend: false,
    lang,
  });

  return (
    <ChartCard
      title={t("adminJourneys.results.exits.title")}
      subtitle={t("adminJourneys.results.exits.subtitle")}
      config={config}
      height={Math.max(160, rows.length * 36 + 48)}
      csv={{
        filename: "journey-exit-reasons.csv",
        headers: ["reason", series],
        rows: rows.map((row) => [row.reason, row.count]),
      }}
    />
  );
}
