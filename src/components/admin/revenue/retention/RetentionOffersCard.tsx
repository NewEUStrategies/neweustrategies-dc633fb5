// Organizm: oferty zatrzymania i wyniki przepływu anulowania - rozpoczęte,
// zatrzymane, anulowane, porzucone, w toku, pokazane i przyjęte oferty oraz
// skuteczność brutto i netto (SPEC §2.2 `retention`, §6.1; karta S7).
//
// DWIE SKUTECZNOŚCI, BO DWA MIANOWNIKI. Brutto liczy zatrzymane wobec decyzji
// (zatrzymane + anulowane), netto - także porzucone przepływy (osoba
// zamknęła okno i wróciła płacić albo nie). Bez obu admin wziąłby
// skuteczność brutto za skuteczność oferty.
//
// `null` ≠ 0. Skuteczność bez żadnej decyzji to „-" z przypisem, a nie 0 %.
// Ankiety sprzed przepływu S2 (bez wyniku) są policzone osobno - nie
// zawyżają rozpoczętych anulowań.
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import {
  FinanceCardFrame,
  NoValue,
  NoValueFootnote,
} from "@/components/admin/revenue/mrr/FinanceCardFrame";
import { cardStatusOf } from "@/components/admin/revenue/overview/hubWindow";
import { formatMetricValue } from "@/lib/analytics/semantic/format";
import { chartLangFrom } from "@/lib/charts/format";
import { ensureI18n as ensureFinanceI18n } from "@/lib/i18n-admin-revenue-finance";
import { ensureI18n } from "@/lib/i18n-admin-revenue-tabs";
import { revenueRetentionOffersQueryOptions } from "@/lib/revenue/finance/queries";
import type { RevenueRange } from "@/lib/revenue/window";

export interface RetentionOffersCardProps {
  tenantId: string | null;
  roles: readonly string[];
  range: RevenueRange;
}

export function RetentionOffersCard({ tenantId, roles, range }: RetentionOffersCardProps) {
  ensureFinanceI18n();
  ensureI18n();
  const { t, i18n } = useTranslation();
  const lang = chartLangFrom(i18n.language);
  const isAdmin = roles.includes("admin");
  const query = useQuery(
    revenueRetentionOffersQueryOptions(tenantId, range, { roleOk: isAdmin }),
  );
  const status = cardStatusOf(query, tenantId);
  const number = new Intl.NumberFormat(lang === "en" ? "en-GB" : "pl-PL");
  const noData = t("adminRevenue.finance.noData");

  let body = null;
  if (status === "ready" && query.data?.state === "ready") {
    const flow = query.data.data;
    const counts = [
      ["flowsStarted", flow.flowsStarted],
      ["saved", flow.saved],
      ["canceled", flow.canceled],
      ["abandoned", flow.abandoned],
      ["open", flow.open],
      ["offersShown", flow.offersShown],
      ["offersAccepted", flow.offersAccepted],
      ["legacyResponses", flow.legacyResponses],
    ] as const;
    const rates = [
      ["saveRateGross", flow.saveRateGross],
      ["saveRateNet", flow.saveRateNet],
    ] as const;
    body = (
      <div className="space-y-3">
        <dl className="m-0 grid grid-cols-2 gap-x-3 gap-y-2 text-sm sm:grid-cols-4">
          {rates.map(([key, value]) => (
            <div key={key} className="space-y-0.5" data-rate={key}>
              <dt className="text-xs text-muted-foreground">
                {t(`adminRevenue.finance.retention.${key}`)}
              </dt>
              <dd className="m-0 font-medium tabular-nums">
                {value === null ? (
                  <NoValue label={noData} />
                ) : (
                  formatMetricValue(value, "ratio", lang)
                )}
              </dd>
            </div>
          ))}
          {counts.map(([key, value]) => (
            <div key={key} className="space-y-0.5" data-count={key}>
              <dt className="text-xs text-muted-foreground">
                {t(`adminRevenue.finance.retention.${key}`)}
              </dt>
              <dd className="m-0 tabular-nums">{number.format(value)}</dd>
            </div>
          ))}
        </dl>
        {flow.saveRateGross === null || flow.saveRateNet === null ? (
          <NoValueFootnote label={noData} hint={t("adminRevenue.finance.noDataHint")} />
        ) : null}
        <p className="m-0 text-xs text-muted-foreground">
          {t("adminRevenue.finance.retention.abandonedHint")}
        </p>
      </div>
    );
  }

  return (
    <FinanceCardFrame
      testId="retention-offers"
      title={t("adminRevenue.retention.offersTitle")}
      isAdmin={isAdmin}
      status={status}
      onRetry={() => void query.refetch()}
    >
      {body}
    </FinanceCardFrame>
  );
}
