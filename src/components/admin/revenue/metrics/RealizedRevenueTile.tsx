// Organizm: kafel „Przychód zrealizowany" w sekcji Marketing pulpitu admina
// (`MarketingPanel`, karta S7: „pulpit, hub i BI czytają przychód
// zrealizowany spod identycznego klucza").
//
// LICZBA Z MIGAWKI S6, KLUCZ BI. Kafel woła `revenueSnapshotQueryOptions`
// BEZ filtrów z oknem pulpitu przepisanym na okno huba
// (`dashboardRevenueRange`) - ten sam wpis cache co kafel Kokpitu, wiersz KPI
// zakładki Przychód i sekcja BI. Kafel zamówień pulpitu zostaje obok jako
// drugie źródło (zamówienia ≠ dokumenty rozliczeniowe).
//
// KAFEL Z REJESTRU (SPEC §6.2): `KpiTile` z `metricId`, etykietą
// z `metricById("revenue_realized")`, kwotami per waluta (nigdy suma),
// jawnym „bez benchmarku" (rejestr świadomie nie ocenia kwot) i odnośnikiem
// do zakładki Przychód.
//
// ROLA: kwoty widzi administrator - redaktor dostaje `LockedMetricTile` bez
// żadnego żądania. Okres pulpitu, którego hub nie liczy (`realtime`,
// `today`), to „-" z powodem, też bez żądania.
//
// MODUŁ ŁADOWANY LENIWIE przez `MarketingPanel`: rejestr wskaźników,
// objaśnienie i benchmarki nie wchodzą do chunku pulpitu (LCP `/admin`).
import { useHydrated } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { KpiTile } from "@/components/admin/analytics/KpiTile";
import {
  evaluateMetricValue,
  useBenchmark,
} from "@/components/admin/analytics/semantic/hooks/useBenchmark";
import { useAuth } from "@/hooks/useAuth";
import type { DashboardRange } from "@/lib/admin/dashboard/period";
import { bi } from "@/lib/analytics/semantic/benchmarks/adapter";
import { formatMetricValue } from "@/lib/analytics/semantic/format";
import { metricById } from "@/lib/analytics/semantic/metrics";
import {
  isRevenueForbidden,
  revenueSnapshotQueryOptions,
} from "@/lib/analytics/semantic/revenueSnapshot.functions";
import { chartLangFrom, type ChartLang } from "@/lib/charts/format";
import { ensureI18n } from "@/lib/i18n-admin-revenue-tabs";
import type { RevenueRange } from "@/lib/revenue/window";
import { dashboardRevenueRange } from "./dashboardRealized";

const METRIC = "revenue_realized" as const;
const DRILL_HREF = "/admin/revenue/mrr";

/** Szkielet tej samej wysokości co kafel - przełączenie stanów bez skoku siatki. */
export function RealizedRevenueTileSkeleton() {
  return (
    <div
      aria-hidden="true"
      data-testid="realized-tile-pending"
      className="h-[104px] rounded-[6px] border border-border bg-muted/40"
    />
  );
}

function labelOf(lang: ChartLang): string {
  const def = metricById(METRIC);
  return bi({ pl: def.labelPl, en: def.labelEn }, lang);
}

export interface RealizedRevenueTileProps {
  range: DashboardRange;
}

export function RealizedRevenueTile({ range }: RealizedRevenueTileProps) {
  ensureI18n();
  const { t, i18n } = useTranslation();
  const lang = chartLangFrom(i18n.language);
  const hydrated = useHydrated();
  const { roles, tenantId } = useAuth();
  const label = labelOf(lang);
  const revenueRange = dashboardRevenueRange(range);

  if (!hydrated) return <RealizedRevenueTileSkeleton />;
  if (!roles.includes("admin")) {
    return (
      <div data-tile={METRIC} data-locked="admin_only">
        <KpiTile label={label} value="-" metricId={METRIC} lockedReason="admin_only" />
      </div>
    );
  }
  if (revenueRange === null || !tenantId) {
    return (
      <div data-tile={METRIC} data-state="no_window">
        <KpiTile
          label={label}
          value="-"
          metricId={METRIC}
          lang={lang}
          drillHref={DRILL_HREF}
          annotation={
            <p className="m-0 text-[11px] text-muted-foreground">
              {t("adminRevenue.metrics.realizedPeriodNote")}
            </p>
          }
        />
      </div>
    );
  }
  return <RealizedRevenueSnapshotTile tenantId={tenantId} range={revenueRange} label={label} />;
}

function RealizedRevenueSnapshotTile({
  tenantId,
  range,
  label,
}: {
  tenantId: string;
  range: RevenueRange;
  label: string;
}) {
  const { t, i18n } = useTranslation();
  const lang = chartLangFrom(i18n.language);
  // BEZ filtrów waluty i segmentu - dokładnie klucz BI i Kokpitu.
  const query = useQuery(revenueSnapshotQueryOptions(tenantId, range));
  const { bench } = useBenchmark({ metricId: METRIC, lang });
  const data = query.data;

  if (!data) {
    if (query.isError && isRevenueForbidden(query.error)) {
      return (
        <div data-tile={METRIC} data-locked="admin_only">
          <KpiTile label={label} value="-" metricId={METRIC} lockedReason="admin_only" />
        </div>
      );
    }
    if (query.isError) {
      return (
        <div data-tile={METRIC} data-state="error">
          <KpiTile
            label={label}
            value="-"
            metricId={METRIC}
            lang={lang}
            drillHref={DRILL_HREF}
            annotation={
              <p role="alert" className="m-0 text-[11px] text-muted-foreground">
                {t("adminRevenue.overview.state.error")}
              </p>
            }
          />
        </div>
      );
    }
    return <RealizedRevenueTileSkeleton />;
  }

  const entry = data.entries.find((e) => e.metricId === METRIC);
  const value = entry?.canonicalValue ?? null;
  const money = data.money[METRIC] ?? null;
  const currency = money?.[0]?.currency;
  const previous = data.deltas.find((d) => d.metricId === METRIC)?.previous ?? null;
  return (
    <div data-tile={METRIC} data-state="ready">
      <KpiTile
        label={label}
        value={formatMetricValue(value, "money_minor", lang, "-", { currency })}
        metricId={METRIC}
        lang={lang}
        current={value ?? undefined}
        previous={previous ?? undefined}
        money={money}
        benchmark={evaluateMetricValue(METRIC, value, bench, { currency })}
        drillHref={DRILL_HREF}
      />
    </div>
  );
}
