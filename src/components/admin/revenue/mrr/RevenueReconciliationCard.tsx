// Organizm: zgodność źródeł przychodu - dokumenty sprzedaży (księga) wobec
// opłaconych zamówień z kasy, per waluta, z werdyktem (SPEC §2.2 `mrr`,
// AD-07: `reconcileAll` + `VerdictBadge` kończy „trzy definicje przychodu").
//
// WERDYKT Z REJESTRU, NIE Z PROGU KARTY. Ocena idzie przez `reconcileMetric`
// S6 z definicją `revenue_realized`: zamówienia z kasy nie mają odnowień,
// więc księga jest strukturalnie WYŻSZA i sama wielkość różnicy nie jest
// błędem; błędem jest odwrócony porządek (zamówienia ponad księgą = zgubione
// dokumenty). Karta nie dokłada żadnej własnej tolerancji.
//
// TEN SAM ODCZYT CO ROZBICIE. `revenueRealizedQueryOptions` z tymi samymi
// argumentami co `RealizedRevenueCard` - jedno żądanie dla obu kart.
//
// NAPRAWA W MODULE-WŁAŚCICIELU. Rozjazd naprawia się w księdze monetyzacji
// (dokumenty) albo w zamówieniach rozliczeń - odnośniki prowadzą wprost tam.
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { VerdictBadge } from "@/components/admin/analytics/semantic/atoms/VerdictBadge";
import { cardStatusOf } from "@/components/admin/revenue/overview/hubWindow";
import { Button } from "@/components/ui/button";
import { AREA_OWNER_LINK } from "@/lib/admin/revenue/hubTabs";
import { formatMoneyMinor } from "@/lib/analytics/semantic/format";
import { chartLangFrom } from "@/lib/charts/format";
import { ensureI18n as ensureFinanceI18n } from "@/lib/i18n-admin-revenue-finance";
import { ensureI18n as ensureShellI18n } from "@/lib/i18n-admin-revenue-shell";
import { ensureI18n } from "@/lib/i18n-admin-revenue-tabs";
import { revenueRealizedQueryOptions } from "@/lib/revenue/finance/queries";
import type { RevenueRange } from "@/lib/revenue/window";
import { FinanceCardFrame } from "./FinanceCardFrame";
import { reconciliationRows } from "./mrrModel";

export interface RevenueReconciliationCardProps {
  tenantId: string | null;
  roles: readonly string[];
  range: RevenueRange;
}

export function RevenueReconciliationCard({
  tenantId,
  roles,
  range,
}: RevenueReconciliationCardProps) {
  ensureFinanceI18n();
  ensureShellI18n();
  ensureI18n();
  const { t, i18n } = useTranslation();
  const lang = chartLangFrom(i18n.language);
  const isAdmin = roles.includes("admin");
  const query = useQuery(revenueRealizedQueryOptions(tenantId, range, { roleOk: isAdmin }));
  const status = cardStatusOf(query, tenantId);
  const ledger = AREA_OWNER_LINK.data_quality;

  let body = null;
  if (status === "ready" && query.data?.state === "ready") {
    const rows = reconciliationRows(query.data.data);
    body = (
      <div className="space-y-2">
        {rows.length === 0 ? (
          <p role="status" className="m-0 text-sm text-muted-foreground">
            {t("adminRevenue.mrr.reconciliationEmpty")}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="reconciliation-table">
              <caption className="sr-only">{t("adminRevenue.mrr.reconciliationCaption")}</caption>
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th scope="col" className="py-1 pr-3 font-medium">
                    {t("adminRevenue.mrr.currencyColumn")}
                  </th>
                  <th scope="col" className="py-1 pr-3 text-right font-medium">
                    {t("adminRevenue.mrr.reconciliationDocuments")}
                  </th>
                  <th scope="col" className="py-1 pr-3 text-right font-medium">
                    {t("adminRevenue.mrr.reconciliationOrders")}
                  </th>
                  <th scope="col" className="py-1 pr-3 text-right font-medium">
                    {t("adminRevenue.mrr.reconciliationDifference")}
                  </th>
                  <th scope="col" className="py-1 font-medium">
                    {t("adminRevenue.mrr.reconciliationVerdict")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((row) => {
                  const money = (minor: number) => formatMoneyMinor(minor, row.currency, lang);
                  return (
                    <tr key={row.currency} data-currency={row.currency} data-verdict={row.verdict}>
                      <th scope="row" className="py-1 pr-3 text-left font-normal">
                        {row.currency}
                      </th>
                      <td className="py-1 pr-3 text-right tabular-nums">
                        {money(row.documentsMinor)}
                      </td>
                      <td className="py-1 pr-3 text-right tabular-nums">
                        {money(row.ordersMinor)}
                      </td>
                      <td className="py-1 pr-3 text-right tabular-nums">
                        {money(row.differenceMinor)}
                      </td>
                      <td className="py-1">
                        <VerdictBadge verdict={row.verdict} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="m-0 text-xs text-muted-foreground">
          {t("adminRevenue.mrr.reconciliationRenewals")}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm" variant="outline" className="h-7">
            <Link to={ledger.to} search={ledger.search}>
              {t("adminRevenue.source.openOwner", {
                screen: t("adminRevenue.source.screen.monetization_ledger"),
              })}
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline" className="h-7">
            <Link to="/admin/billing" search={{ tab: "orders" }}>
              {t("adminRevenue.source.openOwner", {
                screen: t("adminRevenue.source.screen.billing_orders"),
              })}
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <FinanceCardFrame
      testId="revenue-reconciliation"
      title={t("adminRevenue.mrr.reconciliationTitle")}
      subtitle={t("adminRevenue.mrr.reconciliationHint")}
      isAdmin={isAdmin}
      status={status}
      onRetry={() => void query.refetch()}
    >
      {body}
    </FinanceCardFrame>
  );
}
