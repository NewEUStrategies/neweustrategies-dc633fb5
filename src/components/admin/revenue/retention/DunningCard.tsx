// Organizm: windykacja płatności - zaległości okresu, odzyskane, utracone,
// w toku, skuteczność i MRR zagrożone per waluta (SPEC §2.2 `retention`,
// §6.1; karta S7).
//
// KWOTY PER WALUTA, `null` ≠ 0. MRR zagrożone, odzyskane i utracone to listy
// per waluta (`MoneyByCurrencyText` - waluta na wierzchu, reszta obok, nigdy
// suma). Skuteczność bez mianownika (żadnej zakończonej zaległości) i mediana
// bez odzysków to „-" z przypisem, a nie 0.
//
// NAPRAWA W MODULE-WŁAŚCICIELU. Zaległą subskrypcję obsługuje się
// w Rozliczeniach (`AREA_OWNER_LINK.dunning`) - przycisk prowadzi wprost tam.
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { MoneyByCurrencyText } from "@/components/admin/revenue/molecules/MoneyByCurrencyText";
import {
  FinanceCardFrame,
  NoValue,
  NoValueFootnote,
} from "@/components/admin/revenue/mrr/FinanceCardFrame";
import { cardStatusOf } from "@/components/admin/revenue/overview/hubWindow";
import { Button } from "@/components/ui/button";
import { AREA_OWNER_LINK } from "@/lib/admin/revenue/hubTabs";
import { formatMetricValue } from "@/lib/analytics/semantic/format";
import { chartLangFrom } from "@/lib/charts/format";
import { ensureI18n as ensureFinanceI18n } from "@/lib/i18n-admin-revenue-finance";
import { ensureI18n as ensureShellI18n } from "@/lib/i18n-admin-revenue-shell";
import { ensureI18n } from "@/lib/i18n-admin-revenue-tabs";
import { revenueDunningQueryOptions } from "@/lib/revenue/finance/queries";
import type { RevenueRange } from "@/lib/revenue/window";

export interface DunningCardProps {
  tenantId: string | null;
  roles: readonly string[];
  range: RevenueRange;
}

export function DunningCard({ tenantId, roles, range }: DunningCardProps) {
  ensureFinanceI18n();
  ensureShellI18n();
  ensureI18n();
  const { t, i18n } = useTranslation();
  const lang = chartLangFrom(i18n.language);
  const isAdmin = roles.includes("admin");
  const query = useQuery(revenueDunningQueryOptions(tenantId, range, { roleOk: isAdmin }));
  const status = cardStatusOf(query, tenantId);
  const owner = AREA_OWNER_LINK.dunning;
  const number = new Intl.NumberFormat(lang === "en" ? "en-GB" : "pl-PL");
  const noData = t("adminRevenue.finance.noData");

  let body = null;
  if (status === "ready" && query.data?.state === "ready") {
    const dunning = query.data.data;
    const counts = [
      ["started", dunning.started],
      ["recovered", dunning.recovered],
      ["lost", dunning.lost],
      ["open", dunning.open],
    ] as const;
    const amounts = [
      ["atRisk", dunning.atRisk],
      ["recoveredMrr", dunning.recoveredMrr],
      ["lostMrr", dunning.lostMrr],
    ] as const;
    body = (
      <div className="space-y-3">
        <dl className="m-0 grid grid-cols-2 gap-x-3 gap-y-2 text-sm sm:grid-cols-4">
          {counts.map(([key, value]) => (
            <div key={key} className="space-y-0.5" data-count={key}>
              <dt className="text-xs text-muted-foreground">
                {t(`adminRevenue.finance.dunning.${key}`)}
              </dt>
              <dd className="m-0 tabular-nums">{number.format(value)}</dd>
            </div>
          ))}
          <div className="space-y-0.5" data-rate="recoveryRate">
            <dt className="text-xs text-muted-foreground">
              {t("adminRevenue.finance.dunning.recoveryRate")}
            </dt>
            <dd className="m-0 tabular-nums">
              {dunning.recoveryRate === null ? (
                <NoValue label={noData} />
              ) : (
                formatMetricValue(dunning.recoveryRate, "ratio", lang)
              )}
            </dd>
          </div>
          <div className="space-y-0.5" data-rate="medianDaysToRecover">
            <dt className="text-xs text-muted-foreground">
              {t("adminRevenue.finance.dunning.medianDaysToRecover")}
            </dt>
            <dd className="m-0 tabular-nums">
              {dunning.medianDaysToRecover === null ? (
                <NoValue label={noData} />
              ) : (
                formatMetricValue(dunning.medianDaysToRecover, "days", lang)
              )}
            </dd>
          </div>
          {amounts.map(([key, value]) => (
            <div key={key} className="space-y-0.5" data-amount={key}>
              <dt className="text-xs text-muted-foreground">
                {t(`adminRevenue.finance.dunning.${key}`)}
              </dt>
              <dd className="m-0">
                <MoneyByCurrencyText amounts={value} lang={lang} />
              </dd>
            </div>
          ))}
        </dl>
        {dunning.recoveryRate === null || dunning.medianDaysToRecover === null ? (
          <NoValueFootnote label={noData} hint={t("adminRevenue.finance.noDataHint")} />
        ) : null}
        <p className="m-0 text-xs text-muted-foreground">
          {t("adminRevenue.finance.dunning.lostHint")}
        </p>
      </div>
    );
  }

  return (
    <FinanceCardFrame
      testId="dunning"
      title={t("adminRevenue.finance.dunning.title")}
      isAdmin={isAdmin}
      status={status}
      onRetry={() => void query.refetch()}
      actions={
        <Button asChild size="sm" variant="outline" className="h-7">
          <Link to={owner.to} search={owner.search}>
            {t("adminRevenue.source.openOwner", {
              screen: t("adminRevenue.source.screen.billing_subscriptions"),
            })}
          </Link>
        </Button>
      }
    >
      {body}
    </FinanceCardFrame>
  );
}
