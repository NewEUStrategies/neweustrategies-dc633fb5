// Organizm: powody odejść podane w przepływie anulowania - ranking z liczbą
// odpowiedzi i udziałem (SPEC §2.2 `retention`, §6.1; karta S7; Z-S2-04).
//
// „BEZ PODANEGO POWODU" POZA RANKINGIEM (Z-S2-04, Z-09). Osoba, która
// kliknęła „Anuluj mimo to" przed wyborem powodu, nie wskazała powodu -
// policzenie jej jako powodu wypchnęłoby prawdziwe powody w dół rankingu
// i zaniżyło ich udziały. Stoi więc osobno, z etykietą i wyjaśnieniem
// (`reasonNotGiven` + `reasonNotGivenHint`), a udział rankingu liczymy
// z odpowiedzi Z POWODEM.
//
// `stripe:<kod>` (Z-S2-11). Rezygnacja z portalu klienta Stripe niesie kod
// powodu operatora - pokazujemy „Portal Stripe: <kod>" zamiast surowego
// napisu, żeby admin wiedział, że ankieta nie pochodzi z dialogu serwisu.
//
// TEN SAM ODCZYT CO KARTA OFERT. `revenueRetentionOffersQueryOptions` z tymi
// samymi argumentami - obie karty to jedno żądanie.
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { FinanceCardFrame } from "@/components/admin/revenue/mrr/FinanceCardFrame";
import { cardStatusOf } from "@/components/admin/revenue/overview/hubWindow";
import { formatMetricValue } from "@/lib/analytics/semantic/format";
import { chartLangFrom } from "@/lib/charts/format";
import { ensureI18n as ensureFinanceI18n } from "@/lib/i18n-admin-revenue-finance";
import { ensureI18n } from "@/lib/i18n-admin-revenue-tabs";
import { revenueRetentionOffersQueryOptions } from "@/lib/revenue/finance/queries";
import type { RevenueRange } from "@/lib/revenue/window";
import { rankReasons, type ReasonLabel } from "./retentionModel";

export interface ChurnReasonsCardProps {
  tenantId: string | null;
  roles: readonly string[];
  range: RevenueRange;
}

export function ChurnReasonsCard({ tenantId, roles, range }: ChurnReasonsCardProps) {
  ensureFinanceI18n();
  ensureI18n();
  const { t, i18n } = useTranslation();
  const lang = chartLangFrom(i18n.language);
  const isAdmin = roles.includes("admin");
  const query = useQuery(revenueRetentionOffersQueryOptions(tenantId, range, { roleOk: isAdmin }));
  const status = cardStatusOf(query, tenantId);
  const number = new Intl.NumberFormat(lang === "en" ? "en-GB" : "pl-PL");
  const labelOf = (label: ReasonLabel) =>
    label.kind === "stripe"
      ? t("adminRevenue.retention.stripePortalReason", { code: label.code })
      : label.text;

  let body = null;
  if (status === "ready" && query.data?.state === "ready") {
    const flow = query.data.data;
    const ranked = rankReasons(flow.reasons);
    body = (
      <div className="space-y-3">
        {ranked.length === 0 ? (
          <p role="status" className="m-0 text-sm text-muted-foreground">
            {t("adminRevenue.retention.reasonsEmpty")}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="churn-reasons-table">
              <caption className="sr-only">{t("adminRevenue.retention.reasonsCaption")}</caption>
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th scope="col" className="py-1 pr-3 font-medium">
                    {t("adminRevenue.retention.reasonRank")}
                  </th>
                  <th scope="col" className="py-1 pr-3 font-medium">
                    {t("adminRevenue.retention.reasonColumn")}
                  </th>
                  <th scope="col" className="py-1 pr-3 text-right font-medium">
                    {t("adminRevenue.retention.responsesColumn")}
                  </th>
                  <th scope="col" className="py-1 text-right font-medium">
                    {t("adminRevenue.retention.shareColumn")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {ranked.map((row) => (
                  <tr key={row.key} data-reason-kind={row.label.kind}>
                    <td className="py-1 pr-3 tabular-nums">{row.rank}</td>
                    <th scope="row" className="py-1 pr-3 text-left font-normal">
                      {labelOf(row.label)}
                    </th>
                    <td className="py-1 pr-3 text-right tabular-nums">
                      {number.format(row.responses)}
                    </td>
                    <td className="py-1 text-right tabular-nums">
                      {formatMetricValue(row.share, "ratio", lang)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div
          className="space-y-1 rounded-[6px] border border-dashed border-border p-2 text-xs"
          data-testid="churn-reasons-not-given"
        >
          <p className="m-0 flex flex-wrap items-baseline justify-between gap-2 text-sm">
            <span>{t("adminRevenue.finance.retention.reasonNotGiven")}</span>
            <span className="tabular-nums">{number.format(flow.reasonNotGiven)}</span>
          </p>
          <p className="m-0 text-muted-foreground">
            {t("adminRevenue.finance.retention.reasonNotGivenHint")}
          </p>
          <p className="m-0 text-muted-foreground">
            {t("adminRevenue.retention.notGivenOutsideRanking")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <FinanceCardFrame
      testId="churn-reasons"
      title={t("adminRevenue.retention.reasonsTitle")}
      isAdmin={isAdmin}
      status={status}
      onRetry={() => void query.refetch()}
    >
      {body}
    </FinanceCardFrame>
  );
}
