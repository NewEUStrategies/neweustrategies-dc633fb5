// SEKCJA "RUCH NA STRONIE".
//
// Rysuje przez `ChartCard` -> `biChart` -> `<Chart>`, czyli przez ten sam
// silnik, co wykres we wpisie i reszta panelu BI. Panel nie składa własnej
// konfiguracji rysunku: podaje rodzaj, kategorie i serie, a paleta, geometria,
// dymek, tabela danych i obsługa klawiatury są decyzją silnika.
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import "@/lib/i18n-admin-dashboard";
import { Eye, Globe2, UserCheck, Users } from "lucide-react";

import { Card } from "@/components/ui/card";
import { ChartCard } from "@/components/admin/analytics/ChartCard";
import { biChart } from "@/components/admin/analytics/biChart";
import { chartLangFrom } from "@/lib/charts/format";
import { computeDelta, formatCount, rate } from "@/lib/admin/dashboard/compare";
import { bucketLabel } from "@/lib/admin/dashboard/labels";
import type { DashboardRange } from "@/lib/admin/dashboard/period";
import type { TrafficReport } from "@/lib/admin/dashboard/types";
import { StatTile } from "./StatTile";
import { RankedList } from "./RankedList";

export interface TrafficPanelProps {
  report: TrafficReport;
  range: DashboardRange;
}

export function TrafficPanel({ report, range }: TrafficPanelProps) {
  const { t, i18n } = useTranslation();
  const lang = chartLangFrom(i18n.language);
  const { current, previous } = report;

  const categories = useMemo(
    () => report.series.map((p) => bucketLabel(p.bucket, range.bucket)),
    [report.series, range.bucket],
  );

  // DWIE SERIE NA JEDNYM RYSUNKU, bo to są dwie strony jednego pytania o ruch:
  // ile wizyt (sesje) i jak głębokich (odsłony). Obie są w tej samej jednostce
  // - zliczeniu - więc wspólna oś niczego nie zniekształca.
  //
  // ŁAMANA, NIE KRZYWA (`smoothing: 0`). Szereg jest dzienny (albo godzinny),
  // a wygładzenie dorysowywałoby między pomiarami przebieg, którego nikt nie
  // zmierzył - przy ruchu akurat ten przebieg jest treścią: widać z niego
  // weekend, awarię i dzień publikacji.
  const config = useMemo(
    () =>
      biChart({
        kind: "line",
        categories,
        series: [
          {
            name: t("adminDashboard.traffic.sessions"),
            values: report.series.map((p) => p.sessions),
          },
          {
            name: t("adminDashboard.traffic.pageViews"),
            values: report.series.map((p) => p.pageViews),
          },
        ],
        sampleSize: current.events,
        smoothing: 0,
        showLegend: true,
      }),
    [categories, report.series, current.events, t],
  );

  const perSession = rate(current.pageViews, current.sessions);
  const prevPerSession = rate(previous.pageViews, previous.sessions);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-2.5">
        <StatTile
          label={t("adminDashboard.traffic.sessions")}
          value={formatCount(current.sessions, lang)}
          delta={computeDelta(current.sessions, previous.sessions)}
          icon={<Users className="w-4 h-4" aria-hidden="true" />}
        />
        <StatTile
          label={t("adminDashboard.traffic.pageViews")}
          value={formatCount(current.pageViews, lang)}
          delta={computeDelta(current.pageViews, previous.pageViews)}
          icon={<Eye className="w-4 h-4" aria-hidden="true" />}
        />
        <StatTile
          label={t("adminDashboard.traffic.visitors")}
          value={formatCount(current.visitors, lang)}
          delta={computeDelta(current.visitors, previous.visitors)}
        />
        <StatTile
          label={t("adminDashboard.traffic.members")}
          value={formatCount(current.members, lang)}
          delta={computeDelta(current.members, previous.members)}
          icon={<UserCheck className="w-4 h-4" aria-hidden="true" />}
        />
        <StatTile
          label={t("adminDashboard.traffic.perSession")}
          // Wskaźnik pochodny: bez sesji nie ma z czego liczyć, więc kafelek
          // pokazuje kreskę, a nie zero - zero twierdziłoby, że były wizyty
          // i nikt nic nie otworzył.
          value={perSession === null ? "-" : perSession.toFixed(1)}
          delta={
            perSession !== null && prevPerSession !== null
              ? computeDelta(perSession, prevPerSession)
              : undefined
          }
          icon={<Globe2 className="w-4 h-4" aria-hidden="true" />}
        />
      </div>

      <ChartCard
        title={t("adminDashboard.traffic.chartTitle")}
        subtitle={t("adminDashboard.traffic.chartSubtitle")}
        config={config}
        height={240}
        csv={{
          filename: "ruch",
          headers: [
            t("adminDashboard.traffic.colPath"),
            t("adminDashboard.traffic.colSessions"),
            t("adminDashboard.traffic.colViews"),
          ],
          rows: report.series.map((p) => [p.bucket, p.sessions, p.pageViews]),
        }}
      />

      <div className="grid md:grid-cols-3 gap-2.5">
        <Card className="p-3">
          <h3 className="text-xs font-semibold mb-1.5">{t("adminDashboard.traffic.topPaths")}</h3>
          <RankedList
            rows={report.topPaths.map((p) => ({
              id: p.path,
              label: p.path,
              value: p.views,
              secondary: p.sessions,
            }))}
            labelHeader={t("adminDashboard.traffic.colPath")}
            secondaryHeader={t("adminDashboard.traffic.colSessions")}
            valueHeader={t("adminDashboard.traffic.colViews")}
            total={current.pageViews}
          />
        </Card>
        <Card className="p-3">
          <h3 className="text-xs font-semibold mb-1.5">
            {t("adminDashboard.traffic.topReferrers")}
          </h3>
          <RankedList
            rows={report.topReferrers.map((r) => ({
              id: r.host,
              label: r.host,
              value: r.sessions,
            }))}
            labelHeader={t("adminDashboard.traffic.colHost")}
            valueHeader={t("adminDashboard.traffic.colSessions")}
            emptyLabel={t("adminDashboard.traffic.directTraffic")}
          />
        </Card>
        <Card className="p-3">
          <h3 className="text-xs font-semibold mb-1.5">{t("adminDashboard.traffic.languages")}</h3>
          <RankedList
            rows={report.languages.map((l) => ({ id: l.lang, label: l.lang, value: l.sessions }))}
            labelHeader={t("adminDashboard.traffic.colLang")}
            valueHeader={t("adminDashboard.traffic.colSessions")}
            total={current.sessions}
          />
        </Card>
      </div>
    </div>
  );
}
