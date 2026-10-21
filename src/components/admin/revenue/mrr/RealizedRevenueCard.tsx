// Organizm: przychód zrealizowany per kategoria i waluta (SPEC §2.2 `mrr`,
// §6.1; karta S7; Z-S2-12).
//
// DWIE LICZBY, DWA KLUCZE - ŚWIADOMIE. Kafel „Przychód zrealizowany" w wierszu
// KPI czyta migawkę S6 (`revenueSnapshotQueryOptions`) - ten sam wpis cache
// co pulpit i BI (pakiet S7 §8). Ta karta to ROZBICIE: `revenueRealizedQueryOptions`
// (S2) - jedna RPC i jeden klucz z kartą zgodności źródeł obok, więc obie
// karty to jedno żądanie.
//
// NIGDY SUMA WALUT. Wiersze są grupami walut (`tbody` na walutę) z wierszem
// „Razem w <waluta>" z `totals` serwera - suma przekraczająca walutę nie
// istnieje nigdzie w karcie.
//
// DOKUMENTY BEZ ŚRODOWISKA (Z-S2-07). Dokument, któremu nie da się przypisać
// środowiska płatności, jest POZA przychodem (mógł być testowy). Karta mówi,
// ile ich jest, i prowadzi do księgi monetyzacji - inaczej przychód byłby
// zaniżony bez śladu.
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { cardStatusOf } from "@/components/admin/revenue/overview/hubWindow";
import { Button } from "@/components/ui/button";
import { AREA_OWNER_LINK } from "@/lib/admin/revenue/hubTabs";
import { formatMoneyMinor } from "@/lib/analytics/semantic/format";
import { chartLangFrom } from "@/lib/charts/format";
import { ensureI18n as ensureRevenueI18n } from "@/lib/i18n-admin-revenue";
import { ensureI18n as ensureFinanceI18n } from "@/lib/i18n-admin-revenue-finance";
import { ensureI18n as ensureShellI18n } from "@/lib/i18n-admin-revenue-shell";
import { ensureI18n } from "@/lib/i18n-admin-revenue-tabs";
import { REALIZED_CATEGORIES, type RealizedDto } from "@/lib/revenue/finance/dto";
import { revenueRealizedQueryOptions } from "@/lib/revenue/finance/queries";
import type { RevenueRange } from "@/lib/revenue/window";
import { FinanceCardFrame } from "./FinanceCardFrame";

export interface RealizedRevenueCardProps {
  tenantId: string | null;
  roles: readonly string[];
  range: RevenueRange;
}

/** Waluty w kolejności serwera (`totals`), potem waluty obecne tylko w kategoriach. */
function currenciesOf(dto: RealizedDto): string[] {
  const out = dto.totals.map((row) => row.currency);
  for (const row of dto.categories) if (!out.includes(row.currency)) out.push(row.currency);
  return out;
}

export function RealizedRevenueCard({ tenantId, roles, range }: RealizedRevenueCardProps) {
  ensureRevenueI18n();
  ensureFinanceI18n();
  ensureShellI18n();
  ensureI18n();
  const { t, i18n } = useTranslation();
  const lang = chartLangFrom(i18n.language);
  const isAdmin = roles.includes("admin");
  const query = useQuery(revenueRealizedQueryOptions(tenantId, range, { roleOk: isAdmin }));
  const status = cardStatusOf(query, tenantId);
  const number = new Intl.NumberFormat(lang === "en" ? "en-GB" : "pl-PL");

  let body = null;
  if (status === "ready" && query.data?.state === "ready") {
    const dto = query.data.data;
    const currencies = currenciesOf(dto);
    const ledger = AREA_OWNER_LINK.data_quality;
    body = (
      <div className="space-y-2">
        {currencies.length === 0 ? (
          <p role="status" className="m-0 text-sm text-muted-foreground">
            {t("adminRevenue.mrr.realizedEmpty")}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="realized-table">
              <caption className="sr-only">{t("adminRevenue.mrr.categoriesCaption")}</caption>
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th scope="col" className="py-1 pr-3 font-medium">
                    {t("adminRevenue.mrr.categoryColumn")}
                  </th>
                  <th scope="col" className="py-1 pr-3 font-medium">
                    {t("adminRevenue.mrr.currencyColumn")}
                  </th>
                  <th scope="col" className="py-1 pr-3 text-right font-medium">
                    {t("adminRevenue.finance.realized.gross")}
                  </th>
                  <th scope="col" className="py-1 pr-3 text-right font-medium">
                    {t("adminRevenue.finance.realized.refunds")}
                  </th>
                  <th scope="col" className="py-1 pr-3 text-right font-medium">
                    {t("adminRevenue.finance.realized.net")}
                  </th>
                  <th scope="col" className="py-1 text-right font-medium">
                    {t("adminRevenue.finance.realized.documents")}
                  </th>
                </tr>
              </thead>
              {currencies.map((currency) => {
                const money = (minor: number) => formatMoneyMinor(minor, currency, lang);
                const rows = dto.categories
                  .filter((row) => row.currency === currency)
                  .sort(
                    (a, b) =>
                      REALIZED_CATEGORIES.indexOf(a.category) -
                      REALIZED_CATEGORIES.indexOf(b.category),
                  );
                const total = dto.totals.find((row) => row.currency === currency);
                return (
                  <tbody
                    key={currency}
                    data-currency={currency}
                    className="divide-y divide-border border-t border-border"
                  >
                    {rows.map((row) => (
                      <tr key={row.category} data-category={row.category}>
                        <th scope="row" className="py-1 pr-3 text-left font-normal">
                          {t(`adminRevenue.finance.realized.category.${row.category}`)}
                        </th>
                        <td className="py-1 pr-3">{currency}</td>
                        <td className="py-1 pr-3 text-right tabular-nums">
                          {money(row.grossMinor)}
                        </td>
                        <td className="py-1 pr-3 text-right tabular-nums">
                          {money(row.refundsMinor)}
                        </td>
                        <td className="py-1 pr-3 text-right tabular-nums">{money(row.netMinor)}</td>
                        <td className="py-1 text-right tabular-nums">
                          {number.format(row.documents)}
                        </td>
                      </tr>
                    ))}
                    {total ? (
                      <tr data-total={currency} className="font-medium">
                        <th scope="row" colSpan={2} className="py-1 pr-3 text-left font-medium">
                          {t("adminRevenue.mrr.totalRow", { currency })}
                        </th>
                        <td className="py-1 pr-3 text-right tabular-nums">
                          {money(total.grossMinor)}
                        </td>
                        <td className="py-1 pr-3 text-right tabular-nums">
                          {money(total.refundsMinor)}
                        </td>
                        <td className="py-1 pr-3 text-right tabular-nums">
                          {money(total.netMinor)}
                        </td>
                        <td className="py-1 text-right tabular-nums">
                          {number.format(rows.reduce((sum, row) => sum + row.documents, 0))}
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                );
              })}
            </table>
          </div>
        )}
        {dto.unknownEnvironmentDocuments > 0 ? (
          <div
            role="status"
            data-testid="realized-unknown-environment"
            className="flex flex-wrap items-center justify-between gap-2 rounded-[6px] border border-border bg-muted/30 p-2 text-xs"
          >
            <span>
              {t("adminRevenue.finance.realized.unknownEnvironment", {
                count: dto.unknownEnvironmentDocuments,
              })}
            </span>
            <Button asChild size="sm" variant="outline" className="h-7">
              <Link to={ledger.to} search={ledger.search}>
                {t("adminRevenue.source.openOwner", {
                  screen: t("adminRevenue.source.screen.monetization_ledger"),
                })}
              </Link>
            </Button>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <FinanceCardFrame
      testId="realized-revenue"
      title={t("adminRevenue.finance.realized.title")}
      subtitle={t("adminRevenue.finance.realized.subtitle")}
      isAdmin={isAdmin}
      status={status}
      onRetry={() => void query.refetch()}
    >
      {body}
    </FinanceCardFrame>
  );
}
