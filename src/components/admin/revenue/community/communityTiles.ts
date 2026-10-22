// Wiersz KPI zakładki „Społeczność" (SPEC §2.2 `community`, §6.2).
//
// TEN SAM KSZTAŁT CO ZESTAWY KOKPITU (`RevenueTileSpec`, `overviewTiles.ts`),
// więc wiersz montuje ten sam organizm (`OverviewKpiTiles`) z tą samą
// migawką S6: frekwencja i aktywność klubów z oceną benchmarku z rejestru,
// a przychód z biletów - kwoty per waluta wyłącznie dla administratora
// (redaktor dostaje `LockedMetricTile`, bez wywołania RPC finansowego).
//
// KLUBY OSOBNO. Przy wyłączonym module klubów (`clubs_enabled = false`)
// zakładka pokazuje wyłącznie Wydarzenia (SPEC §6.2) - kafle klubów
// znikają razem z sekcją, zamiast świecić kreskami „brak danych".
//
// MODUŁ CZYSTY (wyłącznie `import type`) - czyta go zakładka i kontrakt
// odnośników huba (`hubLinksContract.test.ts`).
import type { HubRole } from "@/lib/admin/revenue/hubTabs";
import type { RevenueTileSpec } from "@/lib/admin/revenue/overviewTiles";
import type { MetricId } from "@/lib/analytics/semantic/metrics";

const ADMIN: readonly HubRole[] = ["admin"];
const ADMIN_AND_EDITOR: readonly HubRole[] = ["admin", "editor"];

function tile(metricId: MetricId, roles: readonly HubRole[], money = false): RevenueTileSpec {
  return { metricId, drillHref: "/admin/revenue/community", roles, source: "snapshot", money };
}

/** Kafle wydarzeń - zawsze, niezależnie od modułu klubów. */
export const COMMUNITY_EVENT_TILES: readonly RevenueTileSpec[] = [
  tile("event_attendance_rate", ADMIN_AND_EDITOR),
  tile("no_show_rate", ADMIN_AND_EDITOR),
  tile("event_ticket_revenue", ADMIN, true),
];

/** Kafle klubów - tylko przy włączonym module klubów. */
export const COMMUNITY_CLUB_TILES: readonly RevenueTileSpec[] = [
  tile("club_active_member_rate", ADMIN_AND_EDITOR),
  tile("club_contributor_rate", ADMIN_AND_EDITOR),
  tile("club_application_acceptance", ADMIN_AND_EDITOR),
  tile("club_decision_time", ADMIN_AND_EDITOR),
];

/**
 * Zestaw wiersza dla stanu modułu klubów. `null` (odczyt klubów jeszcze
 * trwa albo się nie udał) = kafle klubów zostają: lepiej pokazać kreskę
 * z powodem niż schować sekcję, której moduł może być włączony.
 */
export function communityTilesFor(clubsEnabled: boolean | null): readonly RevenueTileSpec[] {
  return clubsEnabled === false
    ? COMMUNITY_EVENT_TILES
    : [...COMMUNITY_EVENT_TILES, ...COMMUNITY_CLUB_TILES];
}
