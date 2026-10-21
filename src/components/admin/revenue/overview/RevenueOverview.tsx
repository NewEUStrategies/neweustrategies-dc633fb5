// Organizm: Kokpit huba „Przychód i lejek" (SPEC §2.2 `overview`, §6.1).
//
// CO JEST NA KOKPICIE I SKĄD. „Zacznij tutaj" (fakty S7-A, tylko gdy coś
// jest do zrobienia), „Wymaga uwagi" (top 3 diagnoz, S7-A), sześć kafli KPI
// z migawki S6 (zestaw administratora albo redaktora), mini lejek i mini
// most MRR, kondycja obszarów 0-100 i karty skrótu Ścieżek i Społeczności.
//
// TE SAME ORGANIZMY CO ZAKŁADKI. Mini lejek to `FunnelStageMap` (`compact`),
// a mini most - `MrrBridgeCard` (`compact`) z TYMI SAMYMI argumentami fabryk
// co Lejek i Przychód: przejście z Kokpitu na zakładkę nie pobiera danych
// drugi raz, a liczby nie mogą się rozjechać. Karty skrótu czytają te same
// fabryki co Ścieżki i Społeczność.
//
// REDAKTOR. Zestaw kafli bez kwot, a w miejscu mostu MRR `LockedMetricTile`
// - zapytanie mostu ma bramkę `roleOk: false`, więc RPC finansowe nie jest
// wołane wcale (test w `RevenueOverview.test.tsx`).
//
// Hierarchia nagłówków: `h1` układu, `h2` sekcji (`RevenueSection`), `h3`
// kart w sekcji - jak w każdej zakładce huba.
import { AttentionCard } from "@/components/admin/revenue/overview/AttentionCard";
import { FunnelStageMap } from "@/components/admin/revenue/funnel/FunnelStageMap";
import { MrrBridgeCard } from "@/components/admin/revenue/mrr/MrrBridgeCard";
import { RevenueSection } from "@/components/admin/revenue/molecules/RevenueSection";
import { ensureI18n } from "@/lib/i18n-admin-revenue-tabs";
import type { RevenueSegment } from "@/lib/revenue/search";
import type { RevenueRange } from "@/lib/revenue/window";
import { CommunityShortcutCard } from "./CommunityShortcutCard";
import { GettingStartedCard } from "./GettingStartedCard";
import { JourneysShortcutCard } from "./JourneysShortcutCard";
import { OverviewKpiTiles } from "./OverviewKpiTiles";
import { SystemHealthCard } from "./SystemHealthCard";

export interface RevenueOverviewProps {
  tenantId: string | null;
  /** Dokładne role sesji (`useAuth().roles`). */
  roles: readonly string[];
  range: RevenueRange;
  currency: string | null;
  segment: RevenueSegment | null;
}

export function RevenueOverview({
  tenantId,
  roles,
  range,
  currency,
  segment,
}: RevenueOverviewProps) {
  ensureI18n();
  return (
    <div className="space-y-6" data-testid="revenue-overview">
      <GettingStartedCard tenantId={tenantId} roles={roles} />
      <AttentionCard tenantId={tenantId} roles={roles} />
      <OverviewKpiTiles
        tenantId={tenantId}
        roles={roles}
        range={range}
        currency={currency}
        segment={segment}
      />
      <RevenueSection
        titleKey="adminRevenue.overview.flow.title"
        descriptionKey="adminRevenue.overview.flow.description"
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="min-w-0 rounded-[6px] border border-border p-3">
            <FunnelStageMap tenantId={tenantId} range={range} segment={segment} variant="compact" />
          </div>
          <div className="min-w-0 rounded-[6px] border border-border p-3">
            <MrrBridgeCard
              tenantId={tenantId}
              roles={roles}
              range={range}
              segment={segment}
              variant="compact"
            />
          </div>
        </div>
      </RevenueSection>
      <SystemHealthCard tenantId={tenantId} roles={roles} />
      <RevenueSection titleKey="adminRevenue.overview.shortcuts.title">
        <div className="grid gap-4 lg:grid-cols-2">
          <JourneysShortcutCard tenantId={tenantId} />
          <CommunityShortcutCard tenantId={tenantId} range={range} />
        </div>
      </RevenueSection>
    </div>
  );
}
