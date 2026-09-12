// SEKCJA "MARKETING": newsletter, pop-upy, reklamy i pieniądze.
//
// WSKAŹNIKI ZAWSZE Z MIANOWNIKIEM. "Otwarcia 42%" bez informacji, z ilu wysyłek,
// jest liczbą, której nie da się zważyć - 42% z dwunastu maili to nie jest ta
// sama wiadomość, co 42% z dwunastu tysięcy. Każdy kafelek wskaźnikowy niesie
// więc mianownik w podpowiedzi, a pusty mianownik daje kreskę, nie zero.
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import "@/lib/i18n-admin-dashboard";
import {
  BadgePercent,
  Banknote,
  HeartHandshake,
  MailCheck,
  MailX,
  MousePointerClick,
} from "lucide-react";

import { Card } from "@/components/ui/card";
import { ChartCard } from "@/components/admin/analytics/ChartCard";
import { biChart } from "@/components/admin/analytics/biChart";
import { chartLangFrom } from "@/lib/charts/format";
import {
  computeDelta,
  formatCount,
  formatMoneyCents,
  rate,
  type MetricDelta,
} from "@/lib/admin/dashboard/compare";
import { bucketLabel } from "@/lib/admin/dashboard/labels";
import type { DashboardRange } from "@/lib/admin/dashboard/period";
import type { MarketingReport, MoneyByCurrency } from "@/lib/admin/dashboard/types";
import { StatTile } from "./StatTile";

/**
 * Waluta użyta wtedy, gdy ANI okres bieżący, ANI odniesienia nie ma żadnej
 * płatności. To jest wyłącznie jednostka przy wypisanym zerze - nigdy nie
 * przelicza ani nie podmienia kwoty rzeczywistej. Domyślna waluta rozliczeń
 * tego repozytorium (patrz `adhocCheckoutOrder.server.ts`).
 */
const DEFAULT_CURRENCY = "PLN";

export interface MarketingPanelProps {
  report: MarketingReport;
  range: DashboardRange;
}

/** Wskaźnik jako procent albo kreska; delta tylko wtedy, gdy OBA okresy mierzalne. */
function ratioTile(numerator: number, denominator: number, prevNum: number, prevDen: number) {
  const now = rate(numerator, denominator);
  const before = rate(prevNum, prevDen);
  const value = now === null ? "-" : `${(now * 100).toFixed(1)}%`;
  const delta: MetricDelta | undefined =
    now !== null && before !== null ? computeDelta(now, before) : undefined;
  return { value, delta };
}

export function MarketingPanel({ report, range }: MarketingPanelProps) {
  const { t, i18n } = useTranslation();
  const lang = chartLangFrom(i18n.language);
  const { current, previous, totals } = report;

  const netGrowth = current.subscribed - current.unsubscribed;
  const prevNetGrowth = previous.subscribed - previous.unsubscribed;

  // WALUTA WIODĄCA to ta o największej kwocie w oknie bieżącym - SQL oddaje
  // listę już posortowaną malejąco, więc jest nią pozycja zerowa. Reszta walut
  // nie znika po cichu: kafelek mówi, ile ich jeszcze jest.
  const lead: MoneyByCurrency | undefined = current.revenue[0];
  const priorInLeadCurrency = lead
    ? (previous.revenue.find((r) => r.currency === lead.currency)?.cents ?? 0)
    : 0;
  const otherCurrencies = Math.max(0, current.revenue.length - 1);
  // Pusty okres nie ma waluty wiodącej, a zero trzeba w czymś wypisać. Bierzemy
  // walutę z okresu odniesienia, a dopiero w ostateczności domyślną tenanta.
  const fallbackCurrency = previous.revenue[0]?.currency ?? DEFAULT_CURRENCY;

  // Darowizny mają własną walutę wiodącą: bywają zbierane w innej walucie niż
  // sprzedaż, więc dziedziczenie waluty przychodu wypisałoby tu złą jednostkę.
  const leadDonation: MoneyByCurrency | undefined = current.donations[0];
  const priorDonation = leadDonation
    ? (previous.donations.find((d) => d.currency === leadDonation.currency)?.cents ?? 0)
    : 0;

  const openRate = ratioTile(current.opens, current.sent, previous.opens, previous.sent);
  const clickRate = ratioTile(current.clicks, current.sent, previous.clicks, previous.sent);
  const popupRate = ratioTile(
    current.popupConversions,
    current.popupViews,
    previous.popupConversions,
    previous.popupViews,
  );
  const adCtr = ratioTile(
    current.adClicks,
    current.adImpressions,
    previous.adClicks,
    previous.adImpressions,
  );

  const seriesConfig = useMemo(
    () =>
      biChart({
        kind: "area",
        categories: report.series.map((p) => bucketLabel(p.bucket, range.bucket)),
        series: [
          {
            name: t("adminDashboard.marketing.subscribed"),
            values: report.series.map((p) => p.subscribed),
          },
        ],
        sampleSize: current.subscribed,
        smoothing: 0,
        showLegend: false,
      }),
    [report.series, range.bucket, current.subscribed, t],
  );

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-2.5">
        <StatTile
          label={t("adminDashboard.marketing.subscribed")}
          value={formatCount(current.subscribed, lang)}
          delta={computeDelta(current.subscribed, previous.subscribed)}
          icon={<MailCheck className="w-4 h-4" aria-hidden="true" />}
          to="/admin/newsletter/subscribers"
        />
        <StatTile
          label={t("adminDashboard.marketing.unsubscribed")}
          value={formatCount(current.unsubscribed, lang)}
          // Wypisania to metryka ODWRÓCONA - wzrost jest złą wiadomością,
          // mimo że strzałka wskazuje w górę.
          delta={computeDelta(current.unsubscribed, previous.unsubscribed, "lower-better")}
          icon={<MailX className="w-4 h-4" aria-hidden="true" />}
        />
        <StatTile
          label={t("adminDashboard.marketing.netGrowth")}
          value={formatCount(netGrowth, lang)}
          delta={computeDelta(netGrowth, prevNetGrowth)}
          hint={`${formatCount(totals.subscribers, lang)} ${t("adminDashboard.marketing.subscribers").toLowerCase()}`}
        />
        <StatTile
          label={t("adminDashboard.marketing.revenue")}
          value={
            lead
              ? formatMoneyCents(lead.cents, lead.currency, lang)
              : formatMoneyCents(0, fallbackCurrency, lang)
          }
          // Porównujemy W TEJ SAMEJ WALUCIE. Gdyby okres poprzedni miał wiodące
          // euro, a bieżący złotówkę, delta liczona z samych liczb porównałaby
          // dwie różne jednostki i wyszedłby z tego dowolny procent.
          delta={lead ? computeDelta(lead.cents, priorInLeadCurrency) : undefined}
          hint={
            <>
              {`${formatCount(current.orders, lang)} ${t("adminDashboard.marketing.orders").toLowerCase()}`}
              {otherCurrencies > 0 ? (
                <> · {t("adminDashboard.marketing.otherCurrencies", { count: otherCurrencies })}</>
              ) : null}
            </>
          }
          icon={<Banknote className="w-4 h-4" aria-hidden="true" />}
          to="/admin/monetization"
        />
        <StatTile
          label={t("adminDashboard.marketing.donations")}
          value={
            leadDonation
              ? formatMoneyCents(leadDonation.cents, leadDonation.currency, lang)
              : formatMoneyCents(0, fallbackCurrency, lang)
          }
          delta={leadDonation ? computeDelta(leadDonation.cents, priorDonation) : undefined}
          icon={<HeartHandshake className="w-4 h-4" aria-hidden="true" />}
          to="/admin/donations"
        />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        <StatTile
          label={t("adminDashboard.marketing.openRate")}
          value={openRate.value}
          delta={openRate.delta}
          hint={t("adminDashboard.marketing.fromSends", { count: current.sent })}
          icon={<BadgePercent className="w-4 h-4" aria-hidden="true" />}
        />
        <StatTile
          label={t("adminDashboard.marketing.clickRate")}
          value={clickRate.value}
          delta={clickRate.delta}
          hint={t("adminDashboard.marketing.fromSends", { count: current.sent })}
          icon={<MousePointerClick className="w-4 h-4" aria-hidden="true" />}
        />
        <StatTile
          label={t("adminDashboard.marketing.popupRate")}
          value={popupRate.value}
          delta={popupRate.delta}
          hint={t("adminDashboard.marketing.fromViews", { count: current.popupViews })}
        />
        <StatTile
          label={t("adminDashboard.marketing.adCtr")}
          value={adCtr.value}
          delta={adCtr.delta}
          hint={t("adminDashboard.marketing.fromImpressions", { count: current.adImpressions })}
        />
      </div>

      <ChartCard
        title={t("adminDashboard.marketing.seriesTitle")}
        config={seriesConfig}
        height={200}
        csv={{
          filename: "zapisy-newsletter",
          headers: [
            t("adminDashboard.marketing.colFinished"),
            t("adminDashboard.marketing.subscribed"),
          ],
          rows: report.series.map((p) => [p.bucket, p.subscribed]),
        }}
      />

      {report.campaigns.length > 0 ? (
        <Card className="p-3 overflow-x-auto">
          <h3 className="text-xs font-semibold mb-1.5">
            {t("adminDashboard.marketing.campaignsTitle")}
          </h3>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] uppercase tracking-wide text-muted-foreground">
                <th scope="col" className="text-left font-medium pb-1">
                  {t("adminDashboard.marketing.colCampaign")}
                </th>
                <th scope="col" className="text-right font-medium pb-1">
                  {t("adminDashboard.marketing.colSent")}
                </th>
                <th scope="col" className="text-right font-medium pb-1">
                  {t("adminDashboard.marketing.colOpens")}
                </th>
                <th scope="col" className="text-right font-medium pb-1">
                  {t("adminDashboard.marketing.colClicks")}
                </th>
                <th scope="col" className="text-right font-medium pb-1">
                  {t("adminDashboard.marketing.colFinished")}
                </th>
              </tr>
            </thead>
            <tbody>
              {report.campaigns.map((c) => {
                const open = rate(c.opens, c.sentCount);
                return (
                  <tr key={`${c.name}-${c.finishedAt}`} className="border-t border-border/50">
                    <th scope="row" className="text-left font-normal py-1 pr-2 max-w-0">
                      <span className="block truncate" title={c.name}>
                        {c.name}
                      </span>
                    </th>
                    <td className="text-right tabular-nums py-1">
                      {formatCount(c.sentCount, lang)}
                    </td>
                    <td className="text-right tabular-nums py-1">
                      {formatCount(c.opens, lang)}
                      {open !== null ? (
                        <span className="text-muted-foreground"> ({(open * 100).toFixed(0)}%)</span>
                      ) : null}
                    </td>
                    <td className="text-right tabular-nums py-1">{formatCount(c.clicks, lang)}</td>
                    <td className="text-right tabular-nums py-1 text-muted-foreground whitespace-nowrap">
                      {c.finishedAt}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      ) : null}
    </div>
  );
}
