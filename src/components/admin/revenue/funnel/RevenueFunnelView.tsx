// Organizm: treść zakładki Lejek (SPEC §2.2 `funnel`, karta S7) - tor,
// mapa lejka, para wskaźników paywalla, źródła rejestracji, czas między
// krokami, tor Sprzedaż i arkusz kroku `?stage=`.
//
// ADRES JEST STANEM. Tor (`?track=`), segment (`?seg=`, filtr układu)
// i otwarty krok (`?stage=`) żyją w adresie: odnośnik da się udostępnić,
// a „Wstecz" cofa wybór. Przełącznik toru pisze do adresu, nie do stanu
// komponentu.
//
// JEDEN ODCZYT, WIELE KART. Każda karta woła `revenueFunnelQueryOptions`
// z tymi samymi argumentami (`funnelFiltersOf`) - React Query łączy je
// w jedno żądanie, a zmiana okna trzyma poprzednie liczby do czasu nowych
// (`keepPreviousData` fabryki S3).
//
// Kwoty widzi administrator (`amountsVisible` z SQL), tor Sprzedaż wymaga
// `aal2` przy MFA (`MfaRequiredNotice` jako stan karty).
import { useQuery } from "@tanstack/react-query";
import { useId } from "react";
import { useTranslation } from "react-i18next";

import { RevenueSection } from "@/components/admin/revenue/molecules/RevenueSection";
import { Button } from "@/components/ui/button";
import { ensureI18n as ensureFunnelI18n } from "@/lib/i18n-admin-revenue-funnel";
import { ensureI18n } from "@/lib/i18n-admin-revenue-tabs";
import { revenueFunnelQueryOptions } from "@/lib/revenue/funnel/queries";
import {
  REVENUE_TRACKS,
  type RevenueHubSearch,
  type RevenueSegment,
  type RevenueTrack,
} from "@/lib/revenue/search";
import type { RevenueRange } from "@/lib/revenue/window";
import { FunnelStageMap } from "./FunnelStageMap";
import { PaywallPairCard } from "./PaywallPairCard";
import { SalesTrackCard } from "./SalesTrackCard";
import { SignupSourcesCard } from "./SignupSourcesCard";
import { StageDetailSheet } from "./StageDetailSheet";
import { StageTimeCard } from "./StageTimeCard";
import { funnelFiltersOf, isFunnelMapStage } from "./funnelStageKeys";

const TRACK_LABEL_KEY: Readonly<Record<RevenueTrack, string>> = {
  self_serve: "adminRevenue.funnel.track.self_serve",
  sales: "adminRevenue.funnel.track.sales",
  all: "adminRevenue.funnel.track.all",
};

export interface RevenueFunnelViewProps {
  tenantId: string | null;
  range: RevenueRange;
  segment: RevenueSegment | null;
  track: RevenueTrack;
  /** Surowy `?stage=` z adresu - wartość spoza listy kroków nie otwiera arkusza. */
  stage: string | undefined;
  onSearchChange: (patch: Partial<RevenueHubSearch>) => void;
}

export function RevenueFunnelView({
  tenantId,
  range,
  segment,
  track,
  stage,
  onSearchChange,
}: RevenueFunnelViewProps) {
  ensureFunnelI18n();
  ensureI18n();
  const { t } = useTranslation();
  const trackLabelId = useId();
  const query = useQuery(
    revenueFunnelQueryOptions(tenantId, range, funnelFiltersOf(segment, track)),
  );
  const funnel = query.data?.state === "ready" ? query.data.funnel : null;
  const openStage = isFunnelMapStage(stage) ? stage : null;

  const trackSwitch = (
    <div className="flex flex-wrap items-center gap-2">
      <span id={trackLabelId} className="text-xs font-medium text-muted-foreground">
        {t("adminRevenue.funnelTab.trackLabel")}
      </span>
      <div role="group" aria-labelledby={trackLabelId} className="flex flex-wrap gap-1">
        {REVENUE_TRACKS.map((id) => (
          <Button
            key={id}
            type="button"
            size="sm"
            variant={id === track ? "default" : "outline"}
            className="h-7"
            aria-pressed={id === track}
            onClick={() => onSearchChange({ track: id })}
          >
            {t(TRACK_LABEL_KEY[id])}
          </Button>
        ))}
      </div>
    </div>
  );

  return (
    <div data-testid="revenue-funnel-view">
      <RevenueSection
        titleKey="adminRevenue.funnel.title"
        descriptionKey="adminRevenue.funnel.subtitle"
        actions={trackSwitch}
      >
        {track === "sales" ? null : (
          <div className="rounded-[6px] border border-border p-3">
            <FunnelStageMap
              tenantId={tenantId}
              range={range}
              segment={segment}
              track={track}
              variant="full"
              onOpenStage={(next) => onSearchChange({ stage: next })}
            />
          </div>
        )}

        {track === "sales" ? null : (
          <div className="grid gap-4 lg:grid-cols-2">
            <PaywallPairCard tenantId={tenantId} range={range} segment={segment} track={track} />
            <SignupSourcesCard tenantId={tenantId} range={range} segment={segment} track={track} />
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          <SalesTrackCard tenantId={tenantId} range={range} segment={segment} track={track} />
          <StageTimeCard />
        </div>

        <StageDetailSheet
          stage={openStage}
          funnel={funnel}
          onClose={() => onSearchChange({ stage: undefined })}
        />
      </RevenueSection>
    </div>
  );
}
