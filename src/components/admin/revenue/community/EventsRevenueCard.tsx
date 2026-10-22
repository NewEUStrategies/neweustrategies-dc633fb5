// Organizm: wydarzenia w oknie huba (SPEC §2.2 `community`, `?sec=events`) -
// zgłoszenia, obecność i no-show, opłacone konwersje i przychód netto
// z biletów PER WALUTA, z tabelą wydarzeń i zejściem do studia.
//
// PRODUCENT S4 (Z-S4-07): `revenueEventsSummaryQueryOptions` - ten sam klucz
// co karta skrótu Kokpitu i karta puli biletów, więc trzy miejsca to jeden
// odczyt. Kohorta = wydarzenia STARTUJĄCE w oknie (definicja agregatu SQL,
// zdanie `cohortHint` pod nagłówkiem).
//
// KWOTY WIDZI ADMINISTRATOR. Dla redaktora SQL oddaje `by_currency = null`
// (nie „0 zł"), więc w miejscu przychodu stoi `LockedMetricTile`, a tabela
// nie ma kolumny kwot. Waluty nigdy się nie sumują (`MoneyByCurrencyText`).
//
// DATA STARTU w strefie admina (jak okno huba): zakładka rysuje się dopiero
// po hydratacji, więc serwer i klient nie formatują jej w dwóch strefach.
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { LockedMetricTile } from "@/components/admin/revenue/atoms/LockedMetricTile";
import { MoneyByCurrencyText } from "@/components/admin/revenue/molecules/MoneyByCurrencyText";
import { cardStatusOf } from "@/components/admin/revenue/overview/hubWindow";
import { Button } from "@/components/ui/button";
import { formatMetricValue } from "@/lib/analytics/semantic/format";
import { chartLangFrom, type ChartLang } from "@/lib/charts/format";
import { ensureI18n as ensureCommunityI18n } from "@/lib/i18n-admin-revenue-community";
import { ensureI18n } from "@/lib/i18n-admin-revenue-tabs";
import { revenueEventsSummaryQueryOptions } from "@/lib/revenue/community/queries";
import type { RevenueEventSummaryRow } from "@/lib/revenue/community/dto";
import type { RevenueRange } from "@/lib/revenue/window";
import { CommunityCardFrame, CommunityStat } from "./CommunityCardFrame";
import { localizedName, shareOf, ticketMoney } from "./communityModel";

const DATE_LOCALE: Readonly<Record<ChartLang, string>> = { pl: "pl-PL", en: "en-GB" };

export interface EventsRevenueCardProps {
  tenantId: string | null;
  range: RevenueRange;
  /** Waluta z filtra `?cur=` - na wierzchu listy kwot, bez przeliczania reszty. */
  currency: string | null;
}

export function EventsRevenueCard({ tenantId, range, currency }: EventsRevenueCardProps) {
  ensureCommunityI18n();
  ensureI18n();
  const { t, i18n } = useTranslation();
  const lang = chartLangFrom(i18n.language);
  const query = useQuery(revenueEventsSummaryQueryOptions(tenantId, range));
  const status = cardStatusOf(query, tenantId);
  const summary = query.data?.state === "ready" ? query.data.summary : null;
  const count = (value: number) => formatMetricValue(value, "count", lang);
  const rate = (value: number | null) =>
    formatMetricValue(value, "ratio", lang, t("adminRevenue.community.noData"));

  let body = null;
  if (summary) {
    const money = ticketMoney(summary.byCurrency);
    body = (
      <div className="space-y-3">
        <dl className="m-0 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <CommunityStat
            stat="events"
            label={t("adminRevenue.community.events.eventsCount.label")}
            hint={t("adminRevenue.community.events.eventsCount.hint")}
            value={count(summary.eventsCount)}
          />
          <CommunityStat
            stat="registrations"
            label={t("adminRevenue.community.events.registrations.label")}
            hint={t("adminRevenue.community.events.registrations.hint")}
            value={count(summary.registrations)}
          />
          <CommunityStat
            stat="attendance"
            label={t("adminRevenue.community.events.attendanceRate.label")}
            hint={t("adminRevenue.community.events.attendanceRate.hint")}
            value={rate(shareOf(summary.attended, summary.registrations))}
          />
          <CommunityStat
            stat="no-show"
            label={t("adminRevenue.community.events.noShowRate.label")}
            hint={t("adminRevenue.community.events.noShowRate.hint")}
            value={rate(shareOf(summary.noShow, summary.registrations))}
          />
          <CommunityStat
            stat="attended"
            label={t("adminRevenue.community.events.attended.label")}
            hint={t("adminRevenue.community.events.attended.hint")}
            value={count(summary.attended)}
          />
          <CommunityStat
            stat="no-show-count"
            label={t("adminRevenue.community.events.noShow.label")}
            hint={t("adminRevenue.community.events.noShow.hint")}
            value={count(summary.noShow)}
          />
          <CommunityStat
            stat="paid"
            label={t("adminRevenue.community.events.paid.label")}
            hint={t("adminRevenue.community.events.paid.hint")}
            value={count(summary.paid)}
          />
          {money === null ? null : (
            <CommunityStat
              stat="revenue"
              label={t("adminRevenue.community.events.revenue.label")}
              hint={t("adminRevenue.community.events.revenue.hint")}
              value={<MoneyByCurrencyText amounts={money} preferred={currency ?? undefined} lang={lang} />}
            />
          )}
        </dl>
        {money === null ? (
          <div data-testid="community-revenue-locked" className="max-w-xs">
            <LockedMetricTile
              label={t("adminRevenue.community.events.revenue.label")}
              reason="admin_only"
            />
          </div>
        ) : null}
        <EventsTable
          rows={summary.events}
          moneyVisible={money !== null}
          currency={currency}
          lang={lang}
        />
      </div>
    );
  }

  return (
    <CommunityCardFrame
      testId="community-events"
      title={t("adminRevenue.community.events.heading")}
      subtitle={t("adminRevenue.community.events.cohortHint")}
      status={status}
      onRetry={() => void query.refetch()}
      actions={
        <Button asChild size="sm" variant="outline" className="h-7">
          <Link to="/admin/events">{t("adminRevenue.communityTab.openEvents")}</Link>
        </Button>
      }
    >
      {body}
    </CommunityCardFrame>
  );
}

function EventsTable({
  rows,
  moneyVisible,
  currency,
  lang,
}: {
  rows: readonly RevenueEventSummaryRow[];
  moneyVisible: boolean;
  currency: string | null;
  lang: ChartLang;
}) {
  const { t } = useTranslation();
  if (rows.length === 0) {
    return (
      <p role="status" className="m-0 text-sm text-muted-foreground">
        {t("adminRevenue.community.events.table.empty")}
      </p>
    );
  }
  const date = new Intl.DateTimeFormat(DATE_LOCALE[lang], { dateStyle: "medium" });
  const noData = t("adminRevenue.community.noData");
  const count = (value: number) => formatMetricValue(value, "count", lang);
  const caption = t("adminRevenue.communityTab.eventsCaption");
  return (
    <div
      role="region"
      tabIndex={0}
      aria-label={caption}
      className="overflow-x-auto rounded-[6px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <table className="w-full min-w-[40rem] text-sm" data-testid="community-events-table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            <th scope="col" className="py-1 pr-3 font-medium">
              {t("adminRevenue.community.events.table.event")}
            </th>
            <th scope="col" className="py-1 pr-3 font-medium">
              {t("adminRevenue.community.events.table.startsAt")}
            </th>
            <th scope="col" className="py-1 pr-3 text-right font-medium">
              {t("adminRevenue.community.events.registrations.label")}
            </th>
            <th scope="col" className="py-1 pr-3 text-right font-medium">
              {t("adminRevenue.community.events.attended.label")}
            </th>
            <th scope="col" className="py-1 pr-3 text-right font-medium">
              {t("adminRevenue.community.events.attendanceRate.label")}
            </th>
            <th scope="col" className="py-1 pr-3 text-right font-medium">
              {t("adminRevenue.community.events.planPool.label")}
            </th>
            {moneyVisible ? (
              <th scope="col" className="py-1 text-right font-medium">
                {t("adminRevenue.communityTab.revenueColumn")}
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => {
            const name = localizedName({ pl: row.titlePl, en: row.titleEn }, lang);
            const attendance = shareOf(row.attended, row.registrations);
            return (
              <tr key={row.eventId} data-event={row.eventId}>
                <th scope="row" className="py-1 pr-3 text-left font-normal">
                  <Link
                    to="/admin/events/$eventId/overview"
                    params={{ eventId: row.eventId }}
                    aria-label={t("adminRevenue.communityTab.openStudio", { name })}
                    className="underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {name}
                  </Link>
                </th>
                <td className="py-1 pr-3 whitespace-nowrap text-muted-foreground">
                  {date.format(new Date(row.startsAt))}
                </td>
                <td className="py-1 pr-3 text-right tabular-nums">{count(row.registrations)}</td>
                <td className="py-1 pr-3 text-right tabular-nums">{count(row.attended)}</td>
                <td className="py-1 pr-3 text-right tabular-nums">
                  {formatMetricValue(attendance, "ratio", lang, noData)}
                </td>
                <td className="py-1 pr-3 text-right tabular-nums">{count(row.planPool)}</td>
                {moneyVisible ? (
                  <td className="py-1 text-right">
                    <MoneyByCurrencyText
                      amounts={ticketMoney(row.byCurrency)}
                      preferred={currency ?? undefined}
                      lang={lang}
                    />
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
