// SEKCJA "CRM": pozyskanie, lejek i obsługa.
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import "@/lib/i18n-admin-dashboard";
import { Building2, CheckCircle2, Flame, Timer, UserPlus } from "lucide-react";

import { Card } from "@/components/ui/card";
import { ChartCard } from "@/components/admin/analytics/ChartCard";
import { biChart } from "@/components/admin/analytics/biChart";
import { chartLangFrom } from "@/lib/charts/format";
import { computeDelta, formatCount } from "@/lib/admin/dashboard/compare";
import { bucketLabel, labelOrKey } from "@/lib/admin/dashboard/labels";
import { LEAD_STAGE_ORDER } from "@/lib/crm/leadListSpec";
import type { DashboardRange } from "@/lib/admin/dashboard/period";
import type { CrmReport } from "@/lib/admin/dashboard/types";
import { StatTile } from "./StatTile";
import { RankedList } from "./RankedList";

export interface CrmPanelProps {
  report: CrmReport;
  range: DashboardRange;
}

export function CrmPanel({ report, range }: CrmPanelProps) {
  const { t, i18n } = useTranslation();
  const lang = chartLangFrom(i18n.language);
  const { current, previous, totals } = report;

  // LEJEK IDZIE W KOLEJNOŚCI ETAPÓW, NIE PO WIELKOŚCI. `LEAD_STAGE_ORDER` jest
  // tą samą stałą, którą sortuje lista leadów, i odpowiada kolejności deklaracji
  // enuma `crm_stage` w bazie. Posortowanie malejąco po liczbie zrobiłoby
  // z lejka ranking i odebrałoby mu jedyną treść: gdzie kontakty się zatrzymują.
  const funnel = useMemo(() => {
    const byStage = new Map(report.stages.map((s) => [s.stage, s.leads]));
    const known = LEAD_STAGE_ORDER.map((stage) => ({ stage, leads: byStage.get(stage) ?? 0 }));
    // Etap dołożony migracją, którego front jeszcze nie zna, ląduje na końcu -
    // zamiast zniknąć z lejka razem ze swoimi kontaktami.
    const extra = report.stages.filter(
      (s) => !(LEAD_STAGE_ORDER as readonly string[]).includes(s.stage),
    );
    return [...known, ...extra];
  }, [report.stages]);

  // SŁUPKI POZIOME. Etykiety etapów są wyrazami ("Kontakt nawiązany",
  // "Zakwalifikowany"), a na osi pionowej wchodzą w całości - na poziomej
  // musiałyby się obracać albo urywać.
  const stageLabels = useMemo(
    () =>
      funnel.map((s) =>
        labelOrKey(
          t(`adminDashboard.crm.stage.${s.stage}`),
          `adminDashboard.crm.stage.${s.stage}`,
          s.stage,
        ),
      ),
    [funnel, t],
  );

  const funnelConfig = useMemo(
    () =>
      biChart({
        kind: "bar-horizontal",
        categories: stageLabels,
        series: [{ name: t("adminDashboard.crm.colLeads"), values: funnel.map((s) => s.leads) }],
        sampleSize: totals.leads,
        showLegend: false,
        showValues: true,
      }),
    [funnel, stageLabels, totals.leads, t],
  );

  const seriesConfig = useMemo(
    () =>
      biChart({
        kind: "bar",
        categories: report.series.map((p) => bucketLabel(p.bucket, range.bucket)),
        series: [
          { name: t("adminDashboard.crm.newLeads"), values: report.series.map((p) => p.leads) },
        ],
        sampleSize: current.newLeads,
        showLegend: false,
      }),
    [report.series, range.bucket, current.newLeads, t],
  );

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-2.5">
        <StatTile
          label={t("adminDashboard.crm.newLeads")}
          value={formatCount(current.newLeads, lang)}
          delta={computeDelta(current.newLeads, previous.newLeads)}
          icon={<UserPlus className="w-4 h-4" aria-hidden="true" />}
          to="/admin/crm"
        />
        <StatTile
          label={t("adminDashboard.crm.won")}
          value={formatCount(current.won, lang)}
          delta={computeDelta(current.won, previous.won)}
          icon={<CheckCircle2 className="w-4 h-4" aria-hidden="true" />}
        />
        <StatTile
          label={t("adminDashboard.crm.hot")}
          value={formatCount(current.hot, lang)}
          delta={computeDelta(current.hot, previous.hot)}
          icon={<Flame className="w-4 h-4" aria-hidden="true" />}
        />
        <StatTile
          label={t("adminDashboard.crm.leadsTotal")}
          value={formatCount(totals.leads, lang)}
          hint={`${formatCount(totals.companies, lang)} ${t("adminDashboard.crm.companies").toLowerCase()}`}
          icon={<Building2 className="w-4 h-4" aria-hidden="true" />}
        />
        <StatTile
          label={t("adminDashboard.crm.tasksOpen")}
          value={formatCount(totals.tasksOpen, lang)}
        />
        {/* Zadania po terminie są STANEM, nie przepływem: nie ma "tylu ich było
            w poprzednim okresie", bo zadanie przeterminowuje się w miejscu.
            Kafelek nie dostaje więc odznaki zmiany - `computeDelta(x, 0)`
            wypisałoby "brak odniesienia", czyli zgłosiłoby awarię pomiaru tam,
            gdzie pomiaru z definicji nie ma. Zamiast tego podajemy mianownik:
            ile to z zadań otwartych. */}
        <StatTile
          label={t("adminDashboard.crm.tasksOverdue")}
          value={formatCount(totals.tasksOverdue, lang)}
          hint={t("adminDashboard.crm.ofOpenTasks", {
            count: totals.tasksOpen,
          })}
          icon={<Timer className="w-4 h-4" aria-hidden="true" />}
        />
      </div>

      <div className="grid lg:grid-cols-2 gap-2.5">
        <ChartCard
          title={t("adminDashboard.crm.funnelTitle")}
          subtitle={t("adminDashboard.crm.funnelSubtitle")}
          config={funnelConfig}
          height={220}
          csv={{
            filename: "lejek-crm",
            headers: [t("adminDashboard.crm.colStage"), t("adminDashboard.crm.colLeads")],
            rows: funnel.map((s, i) => [stageLabels[i], s.leads]),
          }}
        />
        <ChartCard
          title={t("adminDashboard.crm.seriesTitle")}
          config={seriesConfig}
          height={220}
          csv={{
            filename: "nowe-kontakty",
            headers: [t("adminDashboard.crm.colStage"), t("adminDashboard.crm.colLeads")],
            rows: report.series.map((p) => [p.bucket, p.leads]),
          }}
        />
      </div>

      <Card className="p-3">
        <h3 className="text-xs font-semibold mb-1.5">{t("adminDashboard.crm.sourcesTitle")}</h3>
        <RankedList
          rows={report.sources.map((s) => ({
            id: s.source,
            label: labelOrKey(
              t(`adminDashboard.crm.source.${s.source}`),
              `adminDashboard.crm.source.${s.source}`,
              s.source,
            ),
            value: s.leads,
          }))}
          labelHeader={t("adminDashboard.crm.colSource")}
          valueHeader={t("adminDashboard.crm.colLeads")}
          total={current.newLeads}
        />
      </Card>
    </div>
  );
}
