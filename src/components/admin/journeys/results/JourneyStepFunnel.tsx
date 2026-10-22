// Przejścia kroków ścieżki (S8, SPEC §6.3 „Wyniki”) - lejek `FunnelBars`
// z liczbą wejść każdego kroku w kolejności numeracji kanwy.
//
// UDZIAŁ WZGLĘDEM RODZICA, NIE POPRZEDNIEGO WIERSZA. Po rozgałęzieniu
// „poprzedni wiersz” to sąsiednia gałąź (4.1.2 stoi nad 4.2.1), a iloraz dwóch
// gałęzi nic nie znaczy - `journeyStepRows` liczy udział wobec kroku
// nadrzędnego w drzewie i podaje go wprost (`rate`). Krok łączący gałęzie nie
// ma jednego mianownika, więc zamiast procentu ma kreskę i dopisek.
//
// Lejek to lista (molekuła S6): liczby i udziały jako tekst, paski
// `aria-hidden` - czytnik dostaje to samo co oko.
import { useId } from "react";
import { useTranslation } from "react-i18next";

import { FunnelBars, type FunnelBarsStep } from "@/components/admin/analytics/FunnelBars";
import type { JourneyStepRow } from "@/lib/admin/journeys/results";
import { chartLangFrom, formatPercent } from "@/lib/charts/format";
import { formatNumber } from "@/lib/i18n/format";
import { ensureI18n } from "@/lib/i18n-admin-journeys-results";

export interface JourneyStepFunnelProps {
  rows: readonly JourneyStepRow[];
  /** Nazwa kroku („Krok 3: Wyślij e-mail”) - ta sama w lejku, tabeli maili i karcie A/B. */
  stepLabel: (row: JourneyStepRow) => string;
}

export function JourneyStepFunnel({ rows, stepLabel }: JourneyStepFunnelProps) {
  ensureI18n();
  const { t, i18n } = useTranslation();
  const lang = chartLangFrom(i18n.language);
  const headingId = useId();

  const steps: FunnelBarsStep[] = rows.map((row) => ({
    key: row.nodeId,
    label: (
      <span data-node-id={row.nodeId}>
        {stepLabel(row)}
        {row.merge ? (
          <span className="block text-[11px] font-normal text-muted-foreground">
            {t("adminJourneys.results.funnel.merge")}
          </span>
        ) : null}
      </span>
    ),
    value: row.stats ? row.stats.entered : null,
    rate: row.rate,
  }));

  return (
    <section
      aria-labelledby={headingId}
      className="space-y-2 rounded-[6px] border border-border p-3"
      data-testid="journey-step-funnel"
    >
      <h3 id={headingId} className="m-0 text-sm font-semibold">
        {t("adminJourneys.results.funnel.title")}
      </h3>
      <p className="m-0 text-xs text-muted-foreground">
        {t("adminJourneys.results.funnel.description")}
      </p>
      <FunnelBars
        steps={steps}
        variant="compact"
        labels={{
          list: t("adminJourneys.results.funnel.list"),
          empty: t("adminJourneys.results.funnel.empty"),
          ofPrevious: (percent) => t("adminJourneys.results.funnel.ofParent", { percent }),
        }}
        formatValue={(value) => formatNumber(value, lang)}
        formatRate={(rate) => (rate === null ? "—" : formatPercent(rate, lang))}
      />
    </section>
  );
}
