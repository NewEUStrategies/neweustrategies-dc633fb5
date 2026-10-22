// Organizm: treść zakładki „Społeczność" (SPEC §2.2 `community`, karta S7) -
// wiersz KPI z oceną benchmarku, przełącznik sekcji `?sec=events|clubs`,
// karty wydarzeń, puli biletów z planu i lejka zgłoszeń do klubów.
//
// ADRES JEST STANEM. Sekcja żyje w `?sec=` (walidator układu): odnośnik da
// się udostępnić, a „Wstecz" wraca do poprzedniej sekcji. Wartość spoza
// zakładki (`discounts` Oferty) i brak parametru = Wydarzenia.
//
// KLUBY WYŁĄCZONE (`clubs_enabled = false`, SPEC §6.2): tylko Wydarzenia
// i notka modułu - bez przełącznika, bez kafli klubów, nawet gdy adres
// niesie `?sec=clubs`. Dopóki odczyt klubów trwa, przełącznik stoi (moduł
// może być włączony), a karta klubów ma własny stan „wczytywanie".
//
// JEDEN ODCZYT NA DZIEDZINĘ. Karty wydarzeń i puli dzielą klucz
// `revenueEventsSummaryQueryOptions`, przełącznik i karta klubów -
// `revenueClubsSummaryQueryOptions` (Z-S4-07); kafle - migawkę S6 spod
// klucza BI. Hierarchia nagłówków: `h2` sekcji, `h3` kart.
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useId } from "react";
import { useTranslation } from "react-i18next";

import { RevenueSection } from "@/components/admin/revenue/molecules/RevenueSection";
import { TabScopeNotes } from "@/components/admin/revenue/mrr/TabScopeNotes";
import { OverviewKpiTiles } from "@/components/admin/revenue/overview/OverviewKpiTiles";
import { Button } from "@/components/ui/button";
import { ensureI18n as ensureCommunityI18n } from "@/lib/i18n-admin-revenue-community";
import { ensureI18n } from "@/lib/i18n-admin-revenue-tabs";
import { revenueClubsSummaryQueryOptions } from "@/lib/revenue/community/queries";
import type { RevenueSection as HubSection, RevenueSegment } from "@/lib/revenue/search";
import type { RevenueRange } from "@/lib/revenue/window";
import { ClubApplicationsFunnelCard } from "./ClubApplicationsFunnelCard";
import { EventsRevenueCard } from "./EventsRevenueCard";
import { PlanTicketPoolCard } from "./PlanTicketPoolCard";
import { communityTilesFor } from "./communityTiles";

/** Sekcje zakładki - podzbiór `REVENUE_SECTIONS` (`discounts` należy do Oferty). */
export const COMMUNITY_SECTIONS = ["events", "clubs"] as const;
export type CommunitySection = (typeof COMMUNITY_SECTIONS)[number];

const SECTION_LABEL_KEY: Readonly<Record<CommunitySection, string>> = {
  events: "adminRevenue.community.events.heading",
  clubs: "adminRevenue.community.clubs.heading",
};

/** Sekcja z adresu: `clubs` tylko przy module klubów, który nie jest wyłączony. */
export function communitySectionOf(
  raw: HubSection | undefined,
  clubsEnabled: boolean | null,
): CommunitySection {
  return raw === "clubs" && clubsEnabled !== false ? "clubs" : "events";
}

export interface RevenueCommunityViewProps {
  tenantId: string | null;
  /** Dokładne role sesji (`useAuth().roles`). */
  roles: readonly string[];
  range: RevenueRange;
  currency: string | null;
  segment: RevenueSegment | null;
  /** Surowy `?sec=` z walidatora układu. */
  section: HubSection | undefined;
  onSectionChange: (next: CommunitySection) => void;
}

export function RevenueCommunityView({
  tenantId,
  roles,
  range,
  currency,
  segment,
  section,
  onSectionChange,
}: RevenueCommunityViewProps) {
  ensureCommunityI18n();
  ensureI18n();
  const { t } = useTranslation();
  const switchLabelId = useId();
  const clubs = useQuery(revenueClubsSummaryQueryOptions(tenantId, range));
  const clubsEnabled = clubs.data?.state === "ready" ? clubs.data.summary.clubsEnabled : null;
  const active = communitySectionOf(section, clubsEnabled);

  const sectionSwitch =
    clubsEnabled === false ? null : (
      <div className="flex flex-wrap items-center gap-2">
        <span id={switchLabelId} className="text-xs font-medium text-muted-foreground">
          {t("adminRevenue.communityTab.sectionLabel")}
        </span>
        <div role="group" aria-labelledby={switchLabelId} className="flex flex-wrap gap-1">
          {COMMUNITY_SECTIONS.map((id) => (
            <Button
              key={id}
              type="button"
              size="sm"
              variant={id === active ? "default" : "outline"}
              className="h-7"
              aria-pressed={id === active}
              onClick={() => onSectionChange(id)}
            >
              {t(SECTION_LABEL_KEY[id])}
            </Button>
          ))}
        </div>
      </div>
    );

  return (
    <div className="space-y-6" data-testid="revenue-community-view" data-section={active}>
      <div className="space-y-2">
        <OverviewKpiTiles
          tenantId={tenantId}
          roles={roles}
          range={range}
          currency={currency}
          segment={segment}
          tiles={communityTilesFor(clubsEnabled)}
          titleKey="adminRevenue.communityTab.kpiHeading"
          descriptionKey="adminRevenue.communityTab.kpiDescription"
        />
        <TabScopeNotes
          leadingCurrency={null}
          segment={segment}
          segmentNoteKey="adminRevenue.communityTab.allSegmentsNote"
        />
      </div>
      <RevenueSection
        titleKey="adminRevenue.community.title"
        descriptionKey="adminRevenue.community.subtitle"
        actions={sectionSwitch}
      >
        {clubsEnabled === false ? (
          <p className="m-0 text-sm text-muted-foreground" data-testid="community-clubs-disabled">
            {t("adminRevenue.community.state.clubsDisabled")}
          </p>
        ) : null}
        {active === "events" ? (
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="min-w-0 lg:col-span-2">
              <EventsRevenueCard tenantId={tenantId} range={range} currency={currency} />
            </div>
            <PlanTicketPoolCard tenantId={tenantId} range={range} />
          </div>
        ) : (
          <ClubApplicationsFunnelCard tenantId={tenantId} range={range} />
        )}
        <p className="m-0 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>{t("adminRevenue.communityTab.journeysNote")}</span>
          <Link
            to="/admin/revenue/$tab"
            params={{ tab: "journeys" }}
            className="font-medium text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t("adminRevenue.communityTab.journeysLink")}
          </Link>
        </p>
      </RevenueSection>
    </div>
  );
}
