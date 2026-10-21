// Organizm: treść zakładki „Przychód" (SPEC §2.2 `mrr`, karta S7) - wiersz
// KPI, księga MRR (szereg, most, ruchy) oraz przychód zrealizowany ze
// zgodnością źródeł.
//
// KAŻDA LICZBA Z JEDNEGO PRODUCENTA I JEDNEGO KLUCZA (Z-S2-12):
//   * KPI (MRR, ARR, ARPA, ARPU, aktywne subskrypcje, NNMRR, quick ratio,
//     udział planów rocznych, przychód zrealizowany) - `OverviewKpiTiles`
//     z `MRR_KPI_TILES` (S7-B), czyli migawka S6 spod klucza BI i pulpitu;
//   * szereg, most, ruchy, rozbicie przychodu i zgodność - `queryOptions`
//     finansów S2 (`src/lib/revenue/finance/queries.ts`); most to TEN SAM
//     organizm i klucz co mini most Kokpitu (`MrrBridgeCard`).
// Hierarchia nagłówków: `h2` sekcji (`RevenueSection`), `h3` kart.
import { MrrBridgeCard } from "@/components/admin/revenue/mrr/MrrBridgeCard";
import { RevenueSection } from "@/components/admin/revenue/molecules/RevenueSection";
import { OverviewKpiTiles } from "@/components/admin/revenue/overview/OverviewKpiTiles";
import { MRR_KPI_TILES } from "@/lib/admin/revenue/overviewTiles";
import { ensureI18n } from "@/lib/i18n-admin-revenue-tabs";
import type { RevenueSegment } from "@/lib/revenue/search";
import type { RevenueRange } from "@/lib/revenue/window";
import { MrrMovementsTable } from "./MrrMovementsTable";
import { MrrSeriesCard } from "./MrrSeriesCard";
import { RealizedRevenueCard } from "./RealizedRevenueCard";
import { RevenueReconciliationCard } from "./RevenueReconciliationCard";
import { TabScopeNotes } from "./TabScopeNotes";
import { useSnapshotMeta } from "./useSnapshotMeta";

export interface RevenueMrrViewProps {
  tenantId: string | null;
  /** Dokładne role sesji (`useAuth().roles`). */
  roles: readonly string[];
  range: RevenueRange;
  currency: string | null;
  segment: RevenueSegment | null;
}

export function RevenueMrrView({ tenantId, roles, range, currency, segment }: RevenueMrrViewProps) {
  ensureI18n();
  const meta = useSnapshotMeta(tenantId, range, currency, segment);
  return (
    <div className="space-y-6" data-testid="revenue-mrr-view">
      <div className="space-y-2">
        <OverviewKpiTiles
          tenantId={tenantId}
          roles={roles}
          range={range}
          currency={currency}
          segment={segment}
          tiles={MRR_KPI_TILES}
          titleKey="adminRevenue.mrr.kpiHeading"
          descriptionKey="adminRevenue.mrr.kpiDescription"
        />
        <TabScopeNotes
          leadingCurrency={meta?.leadingCurrency}
          segment={segment}
          segmentNoteKey="adminRevenue.mrr.allSegmentsNote"
        />
      </div>
      <RevenueSection
        titleKey="adminRevenue.mrr.ledgerTitle"
        descriptionKey="adminRevenue.mrr.ledgerDescription"
      >
        <MrrSeriesCard tenantId={tenantId} roles={roles} range={range} />
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="min-w-0 rounded-[6px] border border-border p-3">
            <MrrBridgeCard tenantId={tenantId} roles={roles} range={range} segment={segment} />
          </div>
          <MrrMovementsTable tenantId={tenantId} roles={roles} range={range} segment={segment} />
        </div>
      </RevenueSection>
      <RevenueSection titleKey="adminRevenue.mrr.realizedSection">
        <div className="grid gap-4 lg:grid-cols-2">
          <RealizedRevenueCard tenantId={tenantId} roles={roles} range={range} />
          <RevenueReconciliationCard tenantId={tenantId} roles={roles} range={range} />
        </div>
      </RevenueSection>
    </div>
  );
}
