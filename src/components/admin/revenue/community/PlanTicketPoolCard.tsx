// Organizm: pula biletów z planu członkowskiego (SPEC §2.2 `community`) -
// ile zgłoszeń dopuszczonych rozliczono biletem wliczonym w plan, jaki to
// udział i w których wydarzeniach.
//
// TEN SAM ODCZYT CO KARTA WYDARZEŃ (`revenueEventsSummaryQueryOptions`,
// Z-S4-07) - zero drugiego żądania, a suma puli zgadza się z kolumną tabeli
// wydarzeń z konstrukcji (agregat SQL sumuje te same wiersze).
//
// Bilet z puli nie ma ceny, więc karta jest bez kwot i taka sama dla
// administratora i redaktora. Udział bez zgłoszeń = „brak danych", nie 0 %.
// Pule ustawia się w planach członkowskich - stąd odnośnik do Członkostwa.
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { cardStatusOf } from "@/components/admin/revenue/overview/hubWindow";
import { Button } from "@/components/ui/button";
import { formatMetricValue } from "@/lib/analytics/semantic/format";
import { chartLangFrom } from "@/lib/charts/format";
import { ensureI18n as ensureCommunityI18n } from "@/lib/i18n-admin-revenue-community";
import { ensureI18n } from "@/lib/i18n-admin-revenue-tabs";
import { revenueEventsSummaryQueryOptions } from "@/lib/revenue/community/queries";
import type { RevenueRange } from "@/lib/revenue/window";
import { CommunityCardFrame } from "./CommunityCardFrame";
import { localizedName, poolEvents, shareOf } from "./communityModel";

export interface PlanTicketPoolCardProps {
  tenantId: string | null;
  range: RevenueRange;
}

export function PlanTicketPoolCard({ tenantId, range }: PlanTicketPoolCardProps) {
  ensureCommunityI18n();
  ensureI18n();
  const { t, i18n } = useTranslation();
  const lang = chartLangFrom(i18n.language);
  const query = useQuery(revenueEventsSummaryQueryOptions(tenantId, range));
  const status = cardStatusOf(query, tenantId);
  const summary = query.data?.state === "ready" ? query.data.summary : null;

  let body = null;
  if (summary) {
    const share = shareOf(summary.planPool, summary.registrations);
    const rows = poolEvents(summary.events);
    body = (
      <div className="space-y-2">
        <p className="m-0 text-2xl font-semibold tabular-nums" data-testid="community-pool-total">
          {formatMetricValue(summary.planPool, "count", lang)}
        </p>
        <p className="m-0 text-xs text-muted-foreground" data-testid="community-pool-share">
          {share === null
            ? t("adminRevenue.communityTab.pool.shareNone")
            : t("adminRevenue.communityTab.pool.share", {
                value: formatMetricValue(share, "ratio", lang),
              })}
        </p>
        {rows.length === 0 ? (
          <p role="status" className="m-0 text-sm text-muted-foreground">
            {t("adminRevenue.communityTab.pool.empty")}
          </p>
        ) : (
          <table className="w-full text-sm" data-testid="community-pool-table">
            <caption className="sr-only">{t("adminRevenue.communityTab.pool.caption")}</caption>
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th scope="col" className="py-1 pr-3 font-medium">
                  {t("adminRevenue.community.events.table.event")}
                </th>
                <th scope="col" className="py-1 text-right font-medium">
                  {t("adminRevenue.community.events.planPool.label")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row) => (
                <tr key={row.eventId}>
                  <th scope="row" className="py-1 pr-3 text-left font-normal">
                    {localizedName({ pl: row.titlePl, en: row.titleEn }, lang)}
                  </th>
                  <td className="py-1 text-right tabular-nums">
                    {formatMetricValue(row.planPool, "count", lang)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    );
  }

  return (
    <CommunityCardFrame
      testId="community-plan-pool"
      title={t("adminRevenue.community.events.planPool.label")}
      subtitle={t("adminRevenue.community.events.planPool.hint")}
      status={status}
      onRetry={() => void query.refetch()}
      actions={
        <Button asChild size="sm" variant="outline" className="h-7">
          <Link to="/admin/membership">{t("adminRevenue.communityTab.pool.configure")}</Link>
        </Button>
      }
    >
      {body}
    </CommunityCardFrame>
  );
}
