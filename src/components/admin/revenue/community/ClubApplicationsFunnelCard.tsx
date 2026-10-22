// Organizm: kluby w oknie huba (SPEC §2.2 `community`, `?sec=clubs`) - lejek
// zgłoszeń, mediana czasu decyzji, członkowie i współtwórcy, tabela klubów
// z zejściem do analityki klubu i skrzynka zgłoszeń czekających.
//
// PRODUCENT S4 (Z-S4-07): `revenueClubsSummaryQueryOptions` - ten sam klucz
// co karta skrótu Kokpitu. Moduł klubów wyłączony (`clubsEnabled = false`)
// to NOTKA, nie zera - zakładka i tak chowa wtedy sekcję, a karta mówi to
// samo, gdyby trafiła tu z adresu.
//
// LEJEK BEZ FAŁSZYWEGO ILORAZU. Złożone w oknie i decyzje w oknie to dwie
// różne kohorty (decyzja może dotyczyć zgłoszenia sprzed okna), więc między
// nimi nie ma udziału - zdanie pod lejkiem mówi dlaczego. Przyjęte są
// podzbiorem decyzji, więc ich udział liczymy wśród decyzji (ta sama
// definicja co wskaźnik `club_application_acceptance` w wierszu KPI).
//
// Treść zależna od sesji (rola, moduł klubów najemcy) - zakładka rysuje ją
// dopiero po hydratacji (`useHydrated` w `RevenueCommunityTab`), więc
// markup gościa z SSR nie zostanie podmieniony przed hydratacją.
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { FunnelBars } from "@/components/admin/analytics/FunnelBars";
import { cardStatusOf } from "@/components/admin/revenue/overview/hubWindow";
import { Button } from "@/components/ui/button";
import { formatMetricValue } from "@/lib/analytics/semantic/format";
import { chartLangFrom } from "@/lib/charts/format";
import { ensureI18n as ensureCommunityI18n } from "@/lib/i18n-admin-revenue-community";
import { ensureI18n } from "@/lib/i18n-admin-revenue-tabs";
import type { RevenueClubsSummaryDto } from "@/lib/revenue/community/dto";
import { revenueClubsSummaryQueryOptions } from "@/lib/revenue/community/queries";
import type { RevenueRange } from "@/lib/revenue/window";
import { CommunityCardFrame, CommunityStat } from "./CommunityCardFrame";
import { clubFunnelOf, localizedName } from "./communityModel";

export interface ClubApplicationsFunnelCardProps {
  tenantId: string | null;
  range: RevenueRange;
}

export function ClubApplicationsFunnelCard({ tenantId, range }: ClubApplicationsFunnelCardProps) {
  ensureCommunityI18n();
  ensureI18n();
  const { t, i18n } = useTranslation();
  const lang = chartLangFrom(i18n.language);
  const query = useQuery(revenueClubsSummaryQueryOptions(tenantId, range));
  const status = cardStatusOf(query, tenantId);
  const summary = query.data?.state === "ready" ? query.data.summary : null;
  const count = (value: number) => formatMetricValue(value, "count", lang);
  const noData = t("adminRevenue.community.noData");

  let body = null;
  if (summary && !summary.clubsEnabled) {
    body = (
      <p role="status" className="m-0 text-sm text-muted-foreground" data-testid="clubs-disabled">
        {t("adminRevenue.community.state.clubsDisabled")}
      </p>
    );
  } else if (summary) {
    const funnel = clubFunnelOf(summary);
    body = (
      <div className="space-y-3">
        <div className="space-y-1">
          <FunnelBars
            steps={[
              {
                key: "submitted",
                label: t("adminRevenue.community.clubs.applications.submitted.label"),
                value: funnel.submitted,
              },
              {
                key: "decided",
                label: t("adminRevenue.communityTab.clubs.decided"),
                value: funnel.decided,
                rate: null,
              },
              {
                key: "accepted",
                label: t("adminRevenue.community.clubs.applications.accepted.label"),
                value: funnel.accepted,
                rate: funnel.acceptance,
              },
            ]}
            labels={{
              list: t("adminRevenue.community.clubs.applications.heading"),
              empty: t("adminRevenue.community.noData"),
              ofPrevious: (percent) => t("adminRevenue.funnelTab.map.ofPrevious", { percent }),
            }}
            formatValue={count}
            formatRate={(value) => formatMetricValue(value, "ratio", lang, noData)}
          />
          <p className="m-0 text-xs text-muted-foreground">
            {t("adminRevenue.communityTab.clubs.decisionsNote")}
          </p>
        </div>
        <dl className="m-0 grid grid-cols-2 gap-3 lg:grid-cols-3">
          <CommunityStat
            stat="rejected"
            label={t("adminRevenue.community.clubs.applications.rejected.label")}
            hint={t("adminRevenue.community.clubs.applications.rejected.hint")}
            value={count(summary.applications.rejected)}
          />
          <CommunityStat
            stat="pending"
            label={t("adminRevenue.community.clubs.applications.pending.label")}
            hint={t("adminRevenue.community.clubs.applications.pending.hint")}
            value={count(summary.applications.pending)}
          />
          <CommunityStat
            stat="decision-hours"
            label={t("adminRevenue.community.clubs.decisionHours.label")}
            hint={t("adminRevenue.community.clubs.decisionHours.hint")}
            value={
              summary.decisionHoursMedian === null
                ? t("adminRevenue.communityTab.clubs.decisionNone")
                : formatMetricValue(summary.decisionHoursMedian, "hours", lang)
            }
          />
          <CommunityStat
            stat="members"
            label={t("adminRevenue.community.clubs.members.label")}
            hint={t("adminRevenue.community.clubs.members.hint")}
            value={count(summary.members)}
          />
          <CommunityStat
            stat="active-members"
            label={t("adminRevenue.community.clubs.activeMembers.label")}
            hint={t("adminRevenue.community.clubs.activeMembers.hint")}
            value={count(summary.activeMembers)}
          />
          <CommunityStat
            stat="contributors"
            label={t("adminRevenue.community.clubs.contributors.label")}
            hint={t("adminRevenue.community.clubs.contributors.hint")}
            value={count(summary.contributors)}
          />
        </dl>
        <ClubsTable summary={summary} />
      </div>
    );
  }

  return (
    <CommunityCardFrame
      testId="community-clubs"
      title={t("adminRevenue.community.clubs.heading")}
      subtitle={t("adminRevenue.community.clubs.scopeHint")}
      status={status}
      onRetry={() => void query.refetch()}
      actions={
        <Button asChild size="sm" variant="outline" className="h-7">
          <Link to="/admin/community/clubs/applications" search={{ status: "pending" }}>
            {t("adminRevenue.communityTab.clubs.openInbox")}
          </Link>
        </Button>
      }
    >
      {body}
    </CommunityCardFrame>
  );
}

function ClubsTable({ summary }: { summary: RevenueClubsSummaryDto }) {
  const { t, i18n } = useTranslation();
  const lang = chartLangFrom(i18n.language);
  const count = (value: number) => formatMetricValue(value, "count", lang);
  if (summary.clubs.length === 0) {
    return (
      <p role="status" className="m-0 text-sm text-muted-foreground">
        {t("adminRevenue.community.clubs.table.empty")}
      </p>
    );
  }
  const caption = t("adminRevenue.communityTab.clubs.caption");
  return (
    <div
      role="region"
      tabIndex={0}
      aria-label={caption}
      className="overflow-x-auto rounded-[6px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <table className="w-full min-w-[36rem] text-sm" data-testid="community-clubs-table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            <th scope="col" className="py-1 pr-3 font-medium">
              {t("adminRevenue.community.clubs.table.club")}
            </th>
            <th scope="col" className="py-1 pr-3 text-right font-medium">
              {t("adminRevenue.community.clubs.members.label")}
            </th>
            <th scope="col" className="py-1 pr-3 text-right font-medium">
              {t("adminRevenue.community.clubs.activeMembers.label")}
            </th>
            <th scope="col" className="py-1 pr-3 text-right font-medium">
              {t("adminRevenue.community.clubs.contributors.label")}
            </th>
            <th scope="col" className="py-1 pr-3 text-right font-medium">
              {t("adminRevenue.community.clubs.applications.submitted.label")}
            </th>
            <th scope="col" className="py-1 pr-3 text-right font-medium">
              {t("adminRevenue.community.clubs.applications.accepted.label")}
            </th>
            <th scope="col" className="py-1 text-right font-medium">
              {t("adminRevenue.community.clubs.applications.rejected.label")}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {summary.clubs.map((club) => {
            const name = localizedName({ pl: club.namePl, en: club.nameEn }, lang);
            return (
              <tr key={club.clubId} data-club={club.clubId}>
                <th scope="row" className="py-1 pr-3 text-left font-normal">
                  <Link
                    to="/admin/community/clubs/$clubId"
                    params={{ clubId: club.clubId }}
                    search={{ tab: "analytics" }}
                    aria-label={t("adminRevenue.communityTab.clubs.openAnalytics", { name })}
                    className="underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {name}
                  </Link>
                </th>
                <td className="py-1 pr-3 text-right tabular-nums">{count(club.members)}</td>
                <td className="py-1 pr-3 text-right tabular-nums">{count(club.activeMembers)}</td>
                <td className="py-1 pr-3 text-right tabular-nums">{count(club.contributors)}</td>
                <td className="py-1 pr-3 text-right tabular-nums">
                  {count(club.applicationsSubmitted)}
                </td>
                <td className="py-1 pr-3 text-right tabular-nums">
                  {count(club.applicationsAccepted)}
                </td>
                <td className="py-1 text-right tabular-nums">{count(club.applicationsRejected)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
