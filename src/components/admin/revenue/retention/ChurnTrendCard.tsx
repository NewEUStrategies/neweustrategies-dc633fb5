// Organizm: odejścia i retencja przychodu - churn klientów, udział odejść
// przez nieopłacenie i GRC/GRR/NRR per waluta, ten okres wobec poprzedniego
// (SPEC §2.2 `retention`, §6.1, §6.2; karta S7).
//
// TREND = TEN SAM ODCZYT DLA DWÓCH OKIEN. Poprzednie okno to `range.previous`
// huba (ta sama arytmetyka co pulpit), czytane tą samą fabryką
// (`revenueChurnQueryOptions`) - przejście na poprzedni okres trafia potem
// w gotowy wpis cache, a obie liczby liczy jedna funkcja SQL.
//
// NIGDY SUMA WALUT, `null` ≠ 0. NRR/GRR są ilorazami kwot jednej waluty:
// wiersz na walutę, a wskaźnik bez mianownika (brak MRR na początku okresu)
// to „-" z przypisem, a nie 0 %.
//
// „DANE OD …" (SPEC §6.2). NRR, GRR i powroty w 12 miesięcy porównuje się
// z benchmarkami rocznymi; przed upływem 12 miesięcy od początku księgi
// `ProvenanceNote` mówi „Historia od X - wynik pełny od Y", zamiast
// pozwolić czytać niepełny wynik jak pełny.
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { ProvenanceNote } from "@/components/admin/revenue/atoms/ProvenanceNote";
import {
  FinanceCardFrame,
  NoValue,
  NoValueFootnote,
} from "@/components/admin/revenue/mrr/FinanceCardFrame";
import type { SnapshotMeta } from "@/components/admin/revenue/mrr/useSnapshotMeta";
import { cardStatusOf } from "@/components/admin/revenue/overview/hubWindow";
import { formatMetricValue, formatMoneyMinor } from "@/lib/analytics/semantic/format";
import { chartLangFrom, type ChartLang } from "@/lib/charts/format";
import { ensureI18n as ensureFinanceI18n } from "@/lib/i18n-admin-revenue-finance";
import { ensureI18n } from "@/lib/i18n-admin-revenue-tabs";
import type { ChurnCurrencyRow, ChurnDto } from "@/lib/revenue/finance/dto";
import { revenueChurnQueryOptions } from "@/lib/revenue/finance/queries";
import type { RevenueRange } from "@/lib/revenue/window";

export interface ChurnTrendCardProps {
  tenantId: string | null;
  roles: readonly string[];
  range: RevenueRange;
  /** Metadane migawki (`useSnapshotMeta`) - początek księgi i win-back 12 m. */
  meta: SnapshotMeta | undefined;
}

type RatioKey = "grossRevenueChurn" | "grossRevenueRetention" | "netRevenueRetention";
const RATIOS: readonly RatioKey[] = [
  "grossRevenueChurn",
  "grossRevenueRetention",
  "netRevenueRetention",
];

/** Poprzednie okno w kształcie wejścia fabryki - domknięte z definicji. */
function previousRangeOf(range: RevenueRange) {
  return range.previous
    ? { period: range.period, current: range.previous, complete: true }
    : null;
}

export function ChurnTrendCard({ tenantId, roles, range, meta }: ChurnTrendCardProps) {
  ensureFinanceI18n();
  ensureI18n();
  const { t, i18n } = useTranslation();
  const lang = chartLangFrom(i18n.language);
  const isAdmin = roles.includes("admin");
  const query = useQuery(revenueChurnQueryOptions(tenantId, range, { roleOk: isAdmin }));
  const previousRange = previousRangeOf(range);
  const previousQuery = useQuery(
    revenueChurnQueryOptions(tenantId, previousRange ?? range, {
      roleOk: isAdmin && previousRange !== null,
    }),
  );
  const status = cardStatusOf(query, tenantId);
  const ratio = (value: number | null) => formatMetricValue(value, "ratio", lang, "");

  let body = null;
  if (status === "ready" && query.data?.state === "ready") {
    const churn = query.data.data;
    const previous: ChurnDto | null =
      previousRange && previousQuery.data?.state === "ready" ? previousQuery.data.data : null;
    const previousOf = (currency: string): ChurnCurrencyRow | null =>
      previous?.currencies.find((row) => row.currency === currency) ?? null;
    // Bez migawki (jeszcze się wczytuje albo odmowa) win-back też jest „-".
    const winback = meta?.winback12m ?? null;
    const hasNone =
      churn.logoChurnRate === null ||
      churn.involuntaryShare === null ||
      winback === null ||
      churn.currencies.some((row) => RATIOS.some((key) => row[key] === null));

    body = (
      <div className="space-y-3">
        <dl className="m-0 grid grid-cols-2 gap-x-3 gap-y-2 text-sm sm:grid-cols-4">
          <Stat
            label={t("adminRevenue.finance.churn.logoChurnRate")}
            value={churn.logoChurnRate}
            previous={previous?.logoChurnRate ?? null}
            lang={lang}
          />
          <Stat
            label={t("adminRevenue.finance.churn.involuntaryShare")}
            value={churn.involuntaryShare}
            previous={previous?.involuntaryShare ?? null}
            lang={lang}
          />
          <div className="space-y-0.5">
            <dt className="text-xs text-muted-foreground">
              {t("adminRevenue.finance.churn.customersStart")}
            </dt>
            <dd className="m-0 tabular-nums">{churn.customersStart}</dd>
          </div>
          <div className="space-y-0.5">
            <dt className="text-xs text-muted-foreground">
              {t("adminRevenue.finance.churn.customersChurned")}
            </dt>
            <dd className="m-0 tabular-nums">{churn.customersChurned}</dd>
          </div>
        </dl>
        {churn.currencies.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="churn-trend-table">
              <caption className="sr-only">{t("adminRevenue.retention.trendCaption")}</caption>
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th scope="col" className="py-1 pr-3 font-medium">
                    {t("adminRevenue.mrr.currencyColumn")}
                  </th>
                  {RATIOS.map((key) => (
                    <th key={key} scope="col" className="py-1 pr-3 text-right font-medium">
                      {t(`adminRevenue.finance.churn.${key}`)}
                    </th>
                  ))}
                  <th scope="col" className="py-1 text-right font-medium">
                    {t("adminRevenue.finance.movementKind.reactivation")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {churn.currencies.map((row) => {
                  const before = previousOf(row.currency);
                  return (
                    <tr key={row.currency} data-currency={row.currency}>
                      <th scope="row" className="py-1 pr-3 text-left font-normal">
                        {row.currency}
                      </th>
                      {RATIOS.map((key) => (
                        <td
                          key={key}
                          data-ratio={key}
                          className="py-1 pr-3 text-right align-top tabular-nums"
                        >
                          {row[key] === null ? (
                            <NoValue label={t("adminRevenue.finance.noData")} />
                          ) : (
                            ratio(row[key])
                          )}
                          {before && before[key] !== null ? (
                            <span className="block text-xs text-muted-foreground">
                              {t("adminRevenue.retention.previousValue", {
                                value: ratio(before[key]),
                              })}
                            </span>
                          ) : null}
                        </td>
                      ))}
                      <td className="py-1 text-right align-top tabular-nums">
                        {formatMoneyMinor(row.reactivationMinor, row.currency, lang)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
        <div className="space-y-0.5 text-sm" data-testid="churn-winback">
          <h4 className="m-0 text-xs font-semibold">{t("adminRevenue.retention.winbackTitle")}</h4>
          <p className="m-0 tabular-nums">
            {winback === null ? (
              <NoValue label={t("adminRevenue.finance.noData")} />
            ) : (
              ratio(winback)
            )}
          </p>
        </div>
        {hasNone ? (
          <NoValueFootnote
            label={t("adminRevenue.finance.noData")}
            hint={t("adminRevenue.finance.noDataHint")}
          />
        ) : null}
        <ProvenanceNote dataSince={meta?.dataSince ?? null} environment="live" />
      </div>
    );
  }

  return (
    <FinanceCardFrame
      testId="churn-trend"
      title={t("adminRevenue.finance.churn.title")}
      isAdmin={isAdmin}
      status={status}
      onRetry={() => void query.refetch()}
    >
      {body}
    </FinanceCardFrame>
  );
}

/** Wskaźnik okresu z wartością poprzedniego okna pod spodem. */
function Stat({
  label,
  value,
  previous,
  lang,
}: {
  label: string;
  value: number | null;
  previous: number | null;
  lang: ChartLang;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="m-0 tabular-nums">
        {value === null ? (
          <NoValue label={t("adminRevenue.finance.noData")} />
        ) : (
          formatMetricValue(value, "ratio", lang)
        )}
        {previous !== null ? (
          <span className="block text-xs text-muted-foreground">
            {t("adminRevenue.retention.previousValue", {
              value: formatMetricValue(previous, "ratio", lang),
            })}
          </span>
        ) : null}
      </dd>
    </div>
  );
}
