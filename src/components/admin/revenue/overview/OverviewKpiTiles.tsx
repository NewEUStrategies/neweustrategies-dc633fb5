// Organizm: sześć kafli KPI Kokpitu (SPEC §2.2 `overview`, §6.2).
//
// KAŻDY KAFEL Z REJESTRU. `KpiTile` z `metricId` (objaśnienie przy
// etykiecie), oceną benchmarku albo JAWNYM powodem jej braku (`none`,
// `no_data`, `small_sample` - `evaluateMetricValue` S6, bez liczb spoza
// rejestru), kwotami per waluta i `drillHref` do zakładki ze szczegółami.
// Zestaw i odnośniki - `overviewTilesFor` (`overviewTiles.ts`).
//
// MIGAWKA = KLUCZ BI. Liczby pochodzą z `revenueSnapshotQueryOptions` z tymi
// samymi argumentami co sekcja BI (`RevenueInsightSection`): okno, a waluta
// i segment tylko wtedy, gdy admin je wybrał. Przychód zrealizowany na
// Kokpicie, w BI i na pulpicie to więc jeden wpis cache, nie trzy liczby.
//
// REDAKTOR. Migawka redaktora nie dotyka RPC finansowego (strumień rozliczeń
// wraca jako `admin_only`), a zestaw redaktora nie ma kafla z kwotą - kwoty
// zostają administratorowi, mówi o tym notka nad kaflami. Kafel spoza ról
// sesji (zestaw podany z zewnątrz) to `LockedMetricTile`, nie „0 zł".
//
// TEN SAM ORGANIZM DLA WIERSZY KPI ZAKŁADEK. Przychód i Retencja (S7-C)
// montują go z `tiles={MRR_KPI_TILES}` / `RETENTION_KPI_TILES` i własnym
// nagłówkiem (`adminRevenue.mrr.kpiHeading`, `adminRevenue.retention.kpiHeading`).
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { KpiTile } from "@/components/admin/analytics/KpiTile";
import {
  evaluateMetricValue,
  useBenchmark,
} from "@/components/admin/analytics/semantic/hooks/useBenchmark";
import { ProvenanceNote } from "@/components/admin/revenue/atoms/ProvenanceNote";
import { RevenueSection } from "@/components/admin/revenue/molecules/RevenueSection";
import {
  canSeeTile,
  overviewTilesFor,
  type RevenueTileSpec,
} from "@/lib/admin/revenue/overviewTiles";
import { bi } from "@/lib/analytics/semantic/benchmarks/adapter";
import { formatMetricValue } from "@/lib/analytics/semantic/format";
import { metricById } from "@/lib/analytics/semantic/metrics";
import type { ReconciliationEntry } from "@/lib/analytics/semantic/reconcile";
import {
  isRevenueForbidden,
  revenueSnapshotQueryOptions,
  type RevenueSnapshotResult,
} from "@/lib/analytics/semantic/revenueSnapshot.functions";
import { chartLangFrom, type ChartLang } from "@/lib/charts/format";
import { ensureI18n } from "@/lib/i18n-admin-revenue-tabs";
import type { RevenueSegment } from "@/lib/revenue/search";
import type { RevenueRange } from "@/lib/revenue/window";
import { HubCardState } from "./HubCardState";
import { queryDenial, snapshotFiltersOf, type HubCardStatus } from "./hubWindow";

export interface OverviewKpiTilesProps {
  tenantId: string | null;
  roles: readonly string[];
  range: RevenueRange;
  currency: string | null;
  segment: RevenueSegment | null;
  /**
   * Zestaw kafli; domyślnie zestaw Kokpitu dla ról (`overviewTilesFor`).
   * Zakładki Przychód i Retencja (S7-C) podają `MRR_KPI_TILES`
   * / `RETENTION_KPI_TILES` - ten sam organizm, ta sama migawka.
   */
  tiles?: readonly RevenueTileSpec[];
  /** Nagłówek sekcji (`h2`); domyślnie „Najważniejsze wskaźniki". */
  titleKey?: string;
  descriptionKey?: string;
}

function OverviewTile({
  spec,
  entry,
  previous,
  money,
  currency,
  lang,
  locked,
}: {
  spec: RevenueTileSpec;
  entry: ReconciliationEntry | undefined;
  previous: number | null;
  money: RevenueSnapshotResult["money"][RevenueTileSpec["metricId"]];
  currency: string | null;
  lang: ChartLang;
  /** Rola sesji nie widzi tej liczby - kafel zablokowany, bez benchmarku. */
  locked: boolean;
}) {
  const def = metricById(spec.metricId);
  const { bench } = useBenchmark({ metricId: spec.metricId, lang, enabled: !locked });
  const value = entry?.canonicalValue ?? null;
  const leading = currency ?? money?.[0]?.currency;
  const label = bi({ pl: def.labelPl, en: def.labelEn }, lang);
  if (locked) {
    return (
      <div data-tile={spec.metricId} data-locked="admin_only">
        <KpiTile label={label} value="-" metricId={spec.metricId} lockedReason="admin_only" />
      </div>
    );
  }
  return (
    <div data-tile={spec.metricId}>
      <KpiTile
        label={label}
        value={formatMetricValue(value, def.unit, lang, "-", { currency: leading })}
        metricId={spec.metricId}
        lang={lang}
        current={value ?? undefined}
        previous={previous ?? undefined}
        money={spec.money ? (money ?? null) : undefined}
        preferredCurrency={currency ?? undefined}
        benchmark={evaluateMetricValue(spec.metricId, value, bench, { currency: leading })}
        drillHref={spec.drillHref}
      />
    </div>
  );
}

export function OverviewKpiTiles({
  tenantId,
  roles,
  range,
  currency,
  segment,
  tiles,
  titleKey = "adminRevenue.overview.kpi.title",
  descriptionKey = "adminRevenue.overview.kpi.description",
}: OverviewKpiTilesProps) {
  ensureI18n();
  const { t, i18n } = useTranslation();
  const lang = chartLangFrom(i18n.language);
  const specs = tiles ?? overviewTilesFor(roles);
  const query = useQuery(
    revenueSnapshotQueryOptions(tenantId, range, snapshotFiltersOf(currency, segment)),
  );
  const data = query.data;
  const isEditor = !roles.includes("admin");

  let status: HubCardStatus | "ready";
  if (!tenantId) status = "no_tenant";
  else if (data) status = "ready";
  else if (query.isError) {
    status = isRevenueForbidden(query.error) ? "forbidden" : (queryDenial(query.error) ?? "error");
  } else status = "loading";

  let body;
  if (status !== "ready" || !data) {
    body = (
      <HubCardState
        status={status === "ready" ? "loading" : status}
        forbiddenKey="adminRevenue.common.roleGate"
        unavailableKey="adminRevenue.overview.kpi.sourcesPending"
        onRetry={() => void query.refetch()}
      />
    );
  } else {
    const entries = new Map(data.entries.map((e) => [e.metricId, e]));
    const previous = new Map(data.deltas.map((d) => [d.metricId, d.previous]));
    const sourcesPending = data.streams.some((s) => s.reason === "not_configured");
    body = (
      <div className="space-y-2">
        {sourcesPending ? (
          <p data-testid="overview-sources-pending" className="m-0 text-xs text-muted-foreground">
            {t("adminRevenue.overview.kpi.sourcesPending")}
          </p>
        ) : null}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          {specs.map((spec) => (
            <OverviewTile
              key={spec.metricId}
              spec={spec}
              entry={entries.get(spec.metricId)}
              previous={previous.get(spec.metricId) ?? null}
              money={data.money[spec.metricId]}
              currency={currency}
              lang={lang}
              locked={!canSeeTile(spec, roles)}
            />
          ))}
        </div>
        <ProvenanceNote
          dataSince={data.dataSince}
          basisMix={isEditor ? null : data.basisMix}
          computedAt={data.computedAt}
        />
      </div>
    );
  }

  return (
    <div data-testid="overview-kpi" data-tile-set={isEditor ? "editor" : "admin"}>
      <RevenueSection titleKey={titleKey} descriptionKey={descriptionKey}>
        {isEditor ? (
          <p className="m-0 text-xs text-muted-foreground" data-testid="overview-editor-note">
            {t("adminRevenue.overview.kpi.editorNote")}
          </p>
        ) : null}
        {body}
      </RevenueSection>
    </div>
  );
}
