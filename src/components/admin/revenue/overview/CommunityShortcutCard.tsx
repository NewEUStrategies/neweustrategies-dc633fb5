// Organizm: karta skrótu „Społeczność" na Kokpicie (SPEC §2.2 `overview`,
// producenci S4: `revenueEventsSummaryQueryOptions`,
// `revenueClubsSummaryQueryOptions` - Z-S4-07).
//
// TE SAME FABRYKI I TO SAMO OKNO CO ZAKŁADKA SPOŁECZNOŚĆ, więc liczby
// Kokpitu i zakładki to jeden wpis cache. Kwoty biletów widzi wyłącznie
// administrator (`byCurrency` redaktora = `null`) - per waluta, nigdy suma.
// Moduł klubów wyłączony (`clubsEnabled = false`) to notka, nie zera.
//
// Frekwencja = obecni ÷ zgłoszenia dopuszczone (definicja S4); bez zgłoszeń
// to „brak danych", nie 0 %.
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useId } from "react";
import { useTranslation } from "react-i18next";

import { MoneyByCurrencyText } from "@/components/admin/revenue/molecules/MoneyByCurrencyText";
import { Button } from "@/components/ui/button";
import { formatMetricValue } from "@/lib/analytics/semantic/format";
import { chartLangFrom } from "@/lib/charts/format";
import { ensureI18n as ensureCommunityI18n } from "@/lib/i18n-admin-revenue-community";
import { ensureI18n } from "@/lib/i18n-admin-revenue-tabs";
import {
  revenueClubsSummaryQueryOptions,
  revenueEventsSummaryQueryOptions,
} from "@/lib/revenue/community/queries";
import type { RevenueRange } from "@/lib/revenue/window";
import { HubCardState } from "./HubCardState";
import { cardStatusOf } from "./hubWindow";

export interface CommunityShortcutCardProps {
  tenantId: string | null;
  range: RevenueRange;
}

export function CommunityShortcutCard({ tenantId, range }: CommunityShortcutCardProps) {
  ensureCommunityI18n();
  ensureI18n();
  const { t, i18n } = useTranslation();
  const lang = chartLangFrom(i18n.language);
  const headingId = useId();
  const events = useQuery(revenueEventsSummaryQueryOptions(tenantId, range));
  const clubs = useQuery(revenueClubsSummaryQueryOptions(tenantId, range));
  const status = cardStatusOf(events, tenantId);

  let body;
  if (status !== "ready") {
    body = (
      <HubCardState
        status={status}
        forbiddenKey="adminRevenue.community.state.forbidden"
        unavailableKey="adminRevenue.community.state.unavailable"
        onRetry={() => void events.refetch()}
      />
    );
  } else if (events.data?.state === "ready") {
    const summary = events.data.summary;
    const attendance = summary.registrations > 0 ? summary.attended / summary.registrations : null;
    const clubSummary = clubs.data?.state === "ready" ? clubs.data.summary : null;
    body = (
      <ul className="m-0 list-none space-y-1 p-0 text-sm">
        <li className="font-medium">
          {t("adminRevenue.overview.community.events", { count: summary.eventsCount })}
        </li>
        <li className="text-muted-foreground">
          {attendance === null
            ? t("adminRevenue.overview.community.attendanceNone")
            : t("adminRevenue.overview.community.attendance", {
                value: formatMetricValue(attendance, "ratio", lang),
              })}
        </li>
        {summary.byCurrency !== null ? (
          <li className="text-muted-foreground">
            <span>{t("adminRevenue.community.events.revenue.label")}: </span>
            <MoneyByCurrencyText
              amounts={summary.byCurrency.map((m) => ({
                currency: m.currency,
                amountMinor: m.ticketRevenueNetMinor,
              }))}
              lang={lang}
            />
          </li>
        ) : null}
        {clubSummary === null ? null : clubSummary.clubsEnabled ? (
          <>
            <li className="text-muted-foreground">
              {t("adminRevenue.overview.community.members", { count: clubSummary.members })}
            </li>
            <li className="text-muted-foreground">
              {t("adminRevenue.overview.community.pending", {
                count: clubSummary.applications.pending,
              })}
            </li>
          </>
        ) : (
          <li className="text-muted-foreground" data-testid="overview-clubs-disabled">
            {t("adminRevenue.community.state.clubsDisabled")}
          </li>
        )}
      </ul>
    );
  }

  return (
    <section
      aria-labelledby={headingId}
      data-testid="overview-community"
      className="min-w-0 space-y-2 rounded-[6px] border border-border p-3"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 id={headingId} className="text-sm font-semibold">
          {t("adminRevenue.overview.community.title")}
        </h3>
        <Button asChild size="sm" variant="outline" className="h-7">
          <Link to="/admin/revenue/$tab" params={{ tab: "community" }}>
            {t("adminRevenue.overview.community.open")}
          </Link>
        </Button>
      </div>
      {body}
    </section>
  );
}
