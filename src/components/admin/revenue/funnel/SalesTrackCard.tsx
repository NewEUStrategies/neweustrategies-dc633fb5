// Organizm: tor Sprzedaż lejka - etapy cyklu życia leadów z historii CRM
// i zadania zespołu (SPEC §2.2 `funnel`: „tor Sprzedaż z historii etapów").
//
// TEN SAM ODCZYT CO MAPA (`revenueFunnelQueryOptions`, ten sam tor i okno).
// Odczyt idzie przez `requireCrmStaff`: konto z MFA bez `aal2` dostaje
// `MfaRequiredNotice` jako stan karty (SPEC §2.5).
//
// Tor samoobsługi (`?track=self_serve`) nie ma części sprzedaży
// (`sales = null`) - karta wtedy nic nie rysuje, zamiast udawać pusty CRM.
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useId } from "react";
import { useTranslation } from "react-i18next";

import { FunnelBars } from "@/components/admin/analytics/FunnelBars";
import { HubCardState } from "@/components/admin/revenue/overview/HubCardState";
import { cardStatusOf } from "@/components/admin/revenue/overview/hubWindow";
import { Button } from "@/components/ui/button";
import { formatMetricValue } from "@/lib/analytics/semantic/format";
import { chartLangFrom, type ChartLang } from "@/lib/charts/format";
import { ensureI18n as ensureFunnelI18n } from "@/lib/i18n-admin-revenue-funnel";
import { ensureI18n } from "@/lib/i18n-admin-revenue-tabs";
import type { SalesFunnelStage } from "@/lib/revenue/funnel/funnelStages";
import { revenueFunnelQueryOptions } from "@/lib/revenue/funnel/queries";
import type { RevenueSegment, RevenueTrack } from "@/lib/revenue/search";
import type { RevenueRange } from "@/lib/revenue/window";
import { funnelFiltersOf } from "./funnelStageKeys";

const LOCALE: Readonly<Record<ChartLang, string>> = { pl: "pl-PL", en: "en-GB" };

const SALES_STAGE_KEY: Readonly<Record<SalesFunnelStage, string>> = {
  lead: "adminRevenue.funnel.sales.stage.lead",
  mql: "adminRevenue.funnel.sales.stage.mql",
  sql: "adminRevenue.funnel.sales.stage.sql",
  opportunity: "adminRevenue.funnel.sales.stage.opportunity",
  customer: "adminRevenue.funnel.sales.stage.customer",
};

export interface SalesTrackCardProps {
  tenantId: string | null;
  range: RevenueRange;
  segment: RevenueSegment | null;
  track?: RevenueTrack;
}

export function SalesTrackCard({ tenantId, range, segment, track = "all" }: SalesTrackCardProps) {
  ensureFunnelI18n();
  ensureI18n();
  const { t, i18n } = useTranslation();
  const lang = chartLangFrom(i18n.language);
  const headingId = useId();
  const query = useQuery(
    revenueFunnelQueryOptions(tenantId, range, funnelFiltersOf(segment, track)),
  );
  const status = cardStatusOf(query, tenantId);
  const number = new Intl.NumberFormat(LOCALE[lang]);

  if (track === "self_serve") return null;

  let body;
  if (status !== "ready") {
    body = (
      <HubCardState
        status={status}
        forbiddenKey="adminRevenue.funnel.state.forbidden"
        unavailableKey="adminRevenue.funnel.state.unavailable"
        onRetry={() => void query.refetch()}
      />
    );
  } else if (query.data?.state === "ready") {
    const sales = query.data.funnel.sales;
    if (sales === null) return null;
    body = (
      <div className="space-y-3">
        <FunnelBars
          steps={sales.stages.map((row) => ({
            key: row.stage,
            label: t(SALES_STAGE_KEY[row.stage]),
            value: row.leads,
          }))}
          labels={{
            list: t("adminRevenue.funnelTab.sales.listLabel"),
            empty: t("adminRevenue.funnelTab.sales.empty"),
            ofPrevious: (percent) => t("adminRevenue.funnelTab.map.ofPrevious", { percent }),
          }}
          formatValue={(value) => number.format(value)}
          formatRate={(rate) => formatMetricValue(rate, "ratio", lang)}
        />
        <div className="space-y-1 border-t border-border pt-2">
          <h4 className="text-xs font-semibold">{t("adminRevenue.funnelTab.sales.tasks")}</h4>
          <dl className="m-0 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            <dt className="text-muted-foreground">{t("adminRevenue.funnel.sales.openTasks")}</dt>
            <dd className="m-0 text-right tabular-nums">{number.format(sales.openTasks)}</dd>
            <dt className="text-muted-foreground">{t("adminRevenue.funnel.sales.overdueTasks")}</dt>
            <dd className="m-0 text-right tabular-nums">{number.format(sales.overdueTasks)}</dd>
            <dt className="text-muted-foreground">{t("adminRevenue.funnel.sales.doneTasks")}</dt>
            <dd className="m-0 text-right tabular-nums">{number.format(sales.doneTasks)}</dd>
          </dl>
        </div>
      </div>
    );
  }

  return (
    <section
      aria-labelledby={headingId}
      data-testid="sales-track"
      className="min-w-0 space-y-2 rounded-[6px] border border-border p-3"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-0.5">
          <h3 id={headingId} className="text-sm font-semibold">
            {t("adminRevenue.funnel.sales.title")}
          </h3>
          <p className="m-0 text-xs text-muted-foreground">
            {t("adminRevenue.funnel.sales.subtitle")}
          </p>
        </div>
        <Button asChild size="sm" variant="outline" className="h-7">
          <Link to="/admin/crm/funnel">{t("adminRevenue.funnelTab.sales.open")}</Link>
        </Button>
      </div>
      {body}
    </section>
  );
}
