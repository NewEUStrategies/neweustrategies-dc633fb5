// Organizm: „Brak danych - czego brakuje" (SPEC §6.5) - wskaźniki huba bez
// wartości w oknie, pogrupowane według przyczyny z `metricValuesModel`.
//
// BRAK TO NIE ZERO. Kreska w słowniku mówi tylko „nie ma liczby"; ta karta
// mówi DLACZEGO i co z tym zrobić: brakujące dane wejściowe prowadzą do
// zakładki Dane wejściowe (wyłącznie administrator - redaktor dostaje
// w tym miejscu powód „widzi administrator", nie odnośnik do bramki roli),
// zły okres - do okresu 12 miesięcy, inna waluta - do filtra waluty.
//
// Nazwa wskaźnika otwiera arkusz objaśnienia przez adres (`?metric=`),
// więc ten sam arkusz da się udostępnić odnośnikiem.
import { Link } from "@tanstack/react-router";
import { useId } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import type { MetricId } from "@/lib/analytics/semantic/metrics";
import { chartLangFrom } from "@/lib/charts/format";
import { ensureI18n as ensureFinanceI18n } from "@/lib/i18n-admin-revenue-finance";
import { ensureI18n } from "@/lib/i18n-admin-revenue-tabs";
import { metricNames, type MissingGroup, type MissingReason } from "./metricsModel";

const REASON_KEY: Readonly<Record<MissingReason["kind"], string>> = {
  admin_only: "adminRevenue.metrics.reason.admin_only",
  not_configured: "adminRevenue.metrics.reason.not_configured",
  read_failed: "adminRevenue.metrics.reason.read_failed",
  no_data: "adminRevenue.metrics.reason.no_data",
  history: "adminRevenue.metrics.reason.history",
  full_year: "adminRevenue.metrics.reason.full_year",
  inputs: "adminRevenue.metrics.reason.inputs",
  other_currency: "adminRevenue.metrics.reason.other_currency",
  no_base: "adminRevenue.metrics.reason.no_base",
  not_measured: "adminRevenue.metrics.reason.not_measured",
};

export interface MissingDataCardProps {
  groups: readonly MissingGroup[];
  /** Dokładna rola `admin` - tylko wtedy odnośnik do Danych wejściowych. */
  isAdmin: boolean;
  onOpenMetric: (id: MetricId) => void;
}

export function MissingDataCard({ groups, isAdmin, onOpenMetric }: MissingDataCardProps) {
  ensureFinanceI18n();
  ensureI18n();
  const { t, i18n } = useTranslation();
  const lang = chartLangFrom(i18n.language);
  const headingId = useId();

  const reasonText = (reason: MissingReason): string => {
    switch (reason.kind) {
      case "inputs":
        return t(REASON_KEY.inputs, {
          inputs: reason.inputs
            .map((kind) => t(`adminRevenue.finance.inputs.kind.${kind}`))
            .join(", "),
        });
      case "other_currency":
        return t(REASON_KEY.other_currency, { currencies: reason.currencies.join(", ") });
      case "history":
        return t(REASON_KEY.history, { since: reason.since, full: reason.full });
      default:
        return t(REASON_KEY[reason.kind]);
    }
  };

  return (
    <section
      aria-labelledby={headingId}
      data-testid="metrics-missing"
      className="min-w-0 space-y-2 rounded-[6px] border border-border p-3"
    >
      <div className="space-y-0.5">
        <h3 id={headingId} className="text-sm font-semibold">
          {t("adminRevenue.metrics.missingTitle")}
        </h3>
        <p className="m-0 text-xs text-muted-foreground">
          {t("adminRevenue.metrics.missingIntro")}
        </p>
      </div>
      {groups.length === 0 ? (
        <p role="status" className="m-0 text-sm text-muted-foreground">
          {t("adminRevenue.metrics.missingNone")}
        </p>
      ) : (
        <ul className="m-0 list-none space-y-3 p-0">
          {groups.map((group) => (
            <li
              key={JSON.stringify(group.reason)}
              className="space-y-1"
              data-reason={group.reason.kind}
            >
              <p className="m-0 text-sm">
                {t("adminRevenue.metrics.missingReason", { reason: reasonText(group.reason) })}
              </p>
              <ul className="m-0 flex list-none flex-wrap gap-1 p-0">
                {group.metricIds.map((id) => {
                  const { abbr, label } = metricNames(id, lang);
                  return (
                    <li key={id}>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7"
                        data-metric={id}
                        aria-haspopup="dialog"
                        aria-label={t("adminRevenue.metrics.sheetTitle", {
                          name: abbr === label ? label : `${abbr} - ${label}`,
                        })}
                        onClick={() => onOpenMetric(id)}
                      >
                        {abbr}
                      </Button>
                    </li>
                  );
                })}
              </ul>
              {group.reason.kind === "inputs" && isAdmin ? (
                <Button asChild size="sm" variant="link" className="h-7 px-0">
                  <Link to="/admin/revenue/$tab" params={{ tab: "inputs" }}>
                    {t("adminRevenue.metrics.inputsLink")}
                  </Link>
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
