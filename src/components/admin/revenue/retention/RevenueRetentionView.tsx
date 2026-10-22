// Organizm: treść zakładki „Retencja" (SPEC §2.2 `retention`, karta S7) -
// wiersz KPI, odejścia i kohorty, przepływ anulowania z ofertami, powody
// odejść i windykacja.
//
// KAŻDA LICZBA Z JEDNEGO PRODUCENTA I JEDNEGO KLUCZA (Z-S2-12):
//   * KPI (churn klientów, GRC, NRR, GRR, odejścia przez nieopłacenie,
//     odzysk windykacji, skuteczność zatrzymania, powroty 12 m) -
//     `OverviewKpiTiles` z `RETENTION_KPI_TILES` (S7-B), migawka S6 spod
//     klucza BI; metadane migawki (początek księgi, waluta wiodąca, win-back)
//     czyta `useSnapshotMeta` z TEGO SAMEGO wpisu cache;
//   * karty - `queryOptions` finansów S2; karta ofert i ranking powodów
//     dzielą jeden odczyt przepływu anulowania;
//   * kroki przepływu - fabryka modułu retencji (Cennik).
// Hierarchia nagłówków: `h2` sekcji (`RevenueSection`), `h3` kart.
import { RevenueSection } from "@/components/admin/revenue/molecules/RevenueSection";
import { TabScopeNotes } from "@/components/admin/revenue/mrr/TabScopeNotes";
import { useSnapshotMeta } from "@/components/admin/revenue/mrr/useSnapshotMeta";
import { OverviewKpiTiles } from "@/components/admin/revenue/overview/OverviewKpiTiles";
import { RETENTION_KPI_TILES } from "@/lib/admin/revenue/overviewTiles";
import { ensureI18n } from "@/lib/i18n-admin-revenue-tabs";
import type { RevenueSegment } from "@/lib/revenue/search";
import type { RevenueRange } from "@/lib/revenue/window";
import { CancellationFlowView } from "./CancellationFlowView";
import { ChurnReasonsCard } from "./ChurnReasonsCard";
import { ChurnTrendCard } from "./ChurnTrendCard";
import { CohortHeatmapCard } from "./CohortHeatmapCard";
import { DunningCard } from "./DunningCard";
import { RetentionOffersCard } from "./RetentionOffersCard";

export interface RevenueRetentionViewProps {
  tenantId: string | null;
  /** Dokładne role sesji (`useAuth().roles`). */
  roles: readonly string[];
  range: RevenueRange;
  currency: string | null;
  segment: RevenueSegment | null;
}

export function RevenueRetentionView({
  tenantId,
  roles,
  range,
  currency,
  segment,
}: RevenueRetentionViewProps) {
  ensureI18n();
  const meta = useSnapshotMeta(tenantId, range, currency, segment);
  return (
    <div className="space-y-6" data-testid="revenue-retention-view">
      <div className="space-y-2">
        <OverviewKpiTiles
          tenantId={tenantId}
          roles={roles}
          range={range}
          currency={currency}
          segment={segment}
          tiles={RETENTION_KPI_TILES}
          titleKey="adminRevenue.retention.kpiHeading"
          descriptionKey="adminRevenue.retention.kpiDescription"
        />
        <TabScopeNotes
          leadingCurrency={meta?.leadingCurrency}
          segment={segment}
          segmentNoteKey="adminRevenue.retention.allSegmentsNote"
        />
      </div>
      <RevenueSection titleKey="adminRevenue.retention.churnSection">
        <ChurnTrendCard tenantId={tenantId} roles={roles} range={range} meta={meta} />
        <CohortHeatmapCard tenantId={tenantId} roles={roles} range={range} meta={meta} />
      </RevenueSection>
      <RevenueSection titleKey="adminRevenue.retention.saveSection">
        <div className="grid gap-4 lg:grid-cols-2">
          <CancellationFlowView tenantId={tenantId} />
          <RetentionOffersCard tenantId={tenantId} roles={roles} range={range} />
          <ChurnReasonsCard tenantId={tenantId} roles={roles} range={range} />
          <DunningCard tenantId={tenantId} roles={roles} range={range} />
        </div>
      </RevenueSection>
    </div>
  );
}
