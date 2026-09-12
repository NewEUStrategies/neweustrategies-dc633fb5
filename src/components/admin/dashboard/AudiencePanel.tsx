// SEKCJA "UŻYTKOWNICY PLATFORMY": konta, członkostwa, społeczność.
//
// STAN KONTRA PRZEPŁYW. Kafelki dzielą się tu na dwie klasy i rozróżnienie jest
// widoczne: "nowe konta" to PRZEPŁYW z okresu i dostaje odznakę zmiany,
// "użytkownicy łącznie" to STAN na teraz i odznaki nie dostaje - bo licznik
// narastający rośnie zawsze, więc jego "+3%" nie niosłoby żadnej decyzji.
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { CalendarCheck, MessageSquare, ShieldCheck, UserPlus, Users } from "lucide-react";

import { Card } from "@/components/ui/card";
import { ChartCard } from "@/components/admin/analytics/ChartCard";
import { biChart } from "@/components/admin/analytics/biChart";
import { chartLangFrom } from "@/lib/charts/format";
import { computeDelta, formatCount } from "@/lib/admin/dashboard/compare";
import { bucketLabel, labelOrKey } from "@/lib/admin/dashboard/labels";
import type { DashboardRange } from "@/lib/admin/dashboard/period";
import type { AudienceReport } from "@/lib/admin/dashboard/types";
import { StatTile } from "./StatTile";
import { RankedList } from "./RankedList";

export interface AudiencePanelProps {
  report: AudienceReport;
  range: DashboardRange;
}

export function AudiencePanel({ report, range }: AudiencePanelProps) {
  const { t, i18n } = useTranslation();
  const lang = chartLangFrom(i18n.language);
  const { current, previous, totals } = report;

  const seriesConfig = useMemo(
    () =>
      biChart({
        kind: "bar",
        categories: report.series.map((p) => bucketLabel(p.bucket, range.bucket)),
        series: [
          {
            name: t("adminDashboard.audience.signups"),
            values: report.series.map((p) => p.signups),
          },
        ],
        sampleSize: current.signups,
        showLegend: false,
      }),
    [report.series, range.bucket, current.signups, t],
  );

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-2.5">
        <StatTile
          label={t("adminDashboard.audience.users")}
          value={formatCount(totals.users, lang)}
          icon={<Users className="w-4 h-4" aria-hidden="true" />}
          to="/admin/users"
        />
        <StatTile
          label={t("adminDashboard.audience.signups")}
          value={formatCount(current.signups, lang)}
          delta={computeDelta(current.signups, previous.signups)}
          icon={<UserPlus className="w-4 h-4" aria-hidden="true" />}
        />
        <StatTile
          label={t("adminDashboard.audience.members")}
          value={formatCount(totals.members, lang)}
          icon={<ShieldCheck className="w-4 h-4" aria-hidden="true" />}
          to="/admin/members"
        />
        <StatTile
          label={t("adminDashboard.audience.subscriptions")}
          value={formatCount(totals.subscriptions, lang)}
          to="/admin/membership"
        />
        <StatTile
          label={t("adminDashboard.audience.registrations")}
          value={formatCount(current.registrations, lang)}
          delta={computeDelta(current.registrations, previous.registrations)}
          icon={<CalendarCheck className="w-4 h-4" aria-hidden="true" />}
          to="/admin/events"
        />
        <StatTile
          label={t("adminDashboard.audience.comments")}
          value={formatCount(current.comments, lang)}
          delta={computeDelta(current.comments, previous.comments)}
          hint={
            totals.pendingComments > 0
              ? `${formatCount(totals.pendingComments, lang)} ${t("adminDashboard.audience.pendingComments").toLowerCase()}`
              : undefined
          }
          icon={<MessageSquare className="w-4 h-4" aria-hidden="true" />}
          to="/admin/comments"
        />
      </div>

      <div className="grid lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-2.5">
        <ChartCard
          title={t("adminDashboard.audience.seriesTitle")}
          config={seriesConfig}
          height={200}
          csv={{
            filename: "nowe-konta",
            headers: [t("adminDashboard.audience.colTier"), t("adminDashboard.audience.signups")],
            rows: report.series.map((p) => [p.bucket, p.signups]),
          }}
        />
        <div className="grid gap-2.5">
          <Card className="p-3">
            <h3 className="text-xs font-semibold mb-1.5">
              {t("adminDashboard.audience.tiersTitle")}
            </h3>
            <RankedList
              rows={report.tiers.map((tier) => ({
                id: tier.tier,
                label: tier.tier,
                value: tier.members,
              }))}
              labelHeader={t("adminDashboard.audience.colTier")}
              valueHeader={t("adminDashboard.audience.colMembers")}
              total={totals.members}
              maxRows={5}
            />
          </Card>
          <Card className="p-3">
            <h3 className="text-xs font-semibold mb-1.5">
              {t("adminDashboard.audience.rolesTitle")}
            </h3>
            <RankedList
              rows={report.roles.map((r) => ({
                id: r.role,
                label: labelOrKey(
                  t(`adminDashboard.audience.role.${r.role}`),
                  `adminDashboard.audience.role.${r.role}`,
                  r.role,
                ),
                value: r.people,
              }))}
              labelHeader={t("adminDashboard.audience.colRole")}
              valueHeader={t("adminDashboard.audience.colMembers")}
              maxRows={5}
            />
          </Card>
        </div>
      </div>
    </div>
  );
}
