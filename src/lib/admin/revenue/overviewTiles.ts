// Specyfikacje kafli KPI huba „Przychód i lejek" (SPEC §2.2, §6.2; karta S7).
//
// JEDNA LISTA, TRZY EKRANY. Kokpit (zestaw administratora i redaktora),
// wiersz KPI zakładki Przychód (`MRR_KPI_TILES`) i Retencji
// (`RETENTION_KPI_TILES`, montuje S7-C) czytają kafle stąd - ekran nie układa
// własnego zestawu, więc „MRR" w Kokpicie i na zakładce Przychód to ten sam
// wskaźnik z tym samym odnośnikiem.
//
// ŹRÓDŁO = MIGAWKA S6 (`revenueSnapshotQueryOptions`). Także kafel
// `revenue_realized`: BI (`RevenueInsightSection`) czyta go z migawki, więc
// hub czyta spod TEGO SAMEGO klucza - przejście BI → hub nie pobiera liczby
// drugi raz i obie strony nie mogą pokazać dwóch różnych przychodów (pakiet
// S7 §8, wariant bez zmiany pliku S6). Rozbicie per kategoria i waluta to
// osobna karta zakładki Przychód (`revenueRealizedQueryOptions`, S2).
//
// ROLE. Kafel `money` albo z `roles: ["admin"]` to dane finansowe: redaktor
// dostaje zestaw niefinansowy, a w miejscu kwot `LockedMetricTile` - bez
// wywołania RPC finansowego (migawka redaktora zwraca strumień rozliczeń
// jako `admin_only`, a most MRR ma bramkę `roleOk`).
//
// `drillHref` WYŁĄCZNIE DO ISTNIEJĄCYCH TRAS. Test
// `revenueTilesHaveMetric.test.ts` czyta `routeTree.gen.ts`: adres zakładki
// huba musi trafić w `/admin/revenue/$tab` z identyfikatorem z
// `REVENUE_TABS`, a każdy `metricId` - w rejestr S6.
//
// MODUŁ CZYSTY (wyłącznie `import type`) - czytają go zakładki, test bramki
// i pulpit, bez wciągania Reacta ani klienta bazy.
import type { MetricId } from "@/lib/analytics/semantic/metrics";
import type { HubRole } from "@/lib/admin/revenue/hubTabs";
import type { RevenueTabId } from "@/lib/revenue/search";

/** Zakładka huba, do której prowadzi kafel (Kokpit jest indeksem, nie celem). */
export type RevenueDrillTab = Exclude<RevenueTabId, "overview" | "journeys">;

/** Adres szczegółów kafla - konkretna zakładka huba, bez szablonu `$tab`. */
export type RevenueDrillHref = `/admin/revenue/${RevenueDrillTab}`;

export interface RevenueTileSpec {
  metricId: MetricId;
  drillHref: RevenueDrillHref;
  /** Role, którym kafel pokazuje liczbę; reszta dostaje `LockedMetricTile`. */
  roles: readonly HubRole[];
  /** Skąd kafel bierze liczbę - dziś wyłącznie migawka S6 (klucz BI). */
  source: "snapshot";
  /** Kwota per waluta (`money` migawki) - nigdy suma walut. */
  money: boolean;
}

const ADMIN: readonly HubRole[] = ["admin"];
const ADMIN_AND_EDITOR: readonly HubRole[] = ["admin", "editor"];

function tile(
  metricId: MetricId,
  tab: RevenueDrillTab,
  roles: readonly HubRole[],
  money = false,
): RevenueTileSpec {
  return { metricId, drillHref: `/admin/revenue/${tab}`, roles, source: "snapshot", money };
}

/**
 * Kokpit administratora: przychód (stan, przyrost, wpływy), retencja i jedno
 * przejście lejka - sześć liczb, które mówią „czy biznes rośnie".
 */
export const OVERVIEW_ADMIN_TILES: readonly RevenueTileSpec[] = [
  tile("mrr", "mrr", ADMIN, true),
  tile("net_new_mrr", "mrr", ADMIN, true),
  tile("revenue_realized", "mrr", ADMIN, true),
  tile("net_revenue_retention", "retention", ADMIN),
  tile("logo_churn_monthly", "retention", ADMIN),
  tile("registered_to_paid_rate", "funnel", ADMIN_AND_EDITOR),
];

/**
 * Kokpit redaktora: lejek i społeczność - bez jednej kwoty. Redaktor
 * prowadzi treści i wydarzenia, więc dostaje liczby, na które jego praca
 * wpływa (zasięg i konwersja paywalla, frekwencja, aktywność klubów).
 */
export const OVERVIEW_EDITOR_TILES: readonly RevenueTileSpec[] = [
  tile("registered_to_paid_rate", "funnel", ADMIN_AND_EDITOR),
  tile("paywall_hit_rate", "funnel", ADMIN_AND_EDITOR),
  tile("paywall_conversion_rate", "funnel", ADMIN_AND_EDITOR),
  tile("checkout_conversion_rate", "funnel", ADMIN_AND_EDITOR),
  tile("event_attendance_rate", "community", ADMIN_AND_EDITOR),
  tile("club_active_member_rate", "community", ADMIN_AND_EDITOR),
];

/** Wiersz KPI zakładki Przychód (SPEC §2.2 `mrr`) - montuje S7-C. */
export const MRR_KPI_TILES: readonly RevenueTileSpec[] = [
  tile("mrr", "mrr", ADMIN, true),
  tile("arr", "mrr", ADMIN, true),
  tile("arpa", "mrr", ADMIN, true),
  tile("arpu", "mrr", ADMIN, true),
  tile("active_subscriptions", "mrr", ADMIN),
  tile("net_new_mrr", "mrr", ADMIN, true),
  tile("saas_quick_ratio", "mrr", ADMIN),
  tile("annual_plan_share", "mrr", ADMIN),
  tile("revenue_realized", "mrr", ADMIN, true),
];

/** Wiersz KPI zakładki Retencja (SPEC §2.2 `retention`) - montuje S7-C. */
export const RETENTION_KPI_TILES: readonly RevenueTileSpec[] = [
  tile("logo_churn_monthly", "retention", ADMIN),
  tile("gross_revenue_churn", "retention", ADMIN),
  tile("net_revenue_retention", "retention", ADMIN),
  tile("gross_revenue_retention", "retention", ADMIN),
  tile("involuntary_churn_share", "retention", ADMIN),
  tile("dunning_recovery_rate", "retention", ADMIN),
  tile("cancellation_save_rate", "retention", ADMIN),
  tile("winback_rate_12m", "retention", ADMIN),
];

/** Wszystkie zestawy - test bramki i kontrakt odnośników huba (S7-C). */
export const REVENUE_TILE_SETS = {
  overviewAdmin: OVERVIEW_ADMIN_TILES,
  overviewEditor: OVERVIEW_EDITOR_TILES,
  mrr: MRR_KPI_TILES,
  retention: RETENTION_KPI_TILES,
} as const;

/** Rola sesji, która widzi liczbę kafla (dokładne role, bez `super_admin`). */
export function canSeeTile(spec: RevenueTileSpec, roles: readonly string[]): boolean {
  return spec.roles.some((role) => roles.includes(role));
}

/**
 * Zestaw Kokpitu dla ról sesji: administrator - finansowy, redaktor -
 * niefinansowy. Rola spoza huba dostaje pustą listę (układ i tak pokazuje
 * jej `RoleGateNotice`).
 */
export function overviewTilesFor(roles: readonly string[]): readonly RevenueTileSpec[] {
  if (roles.includes("admin")) return OVERVIEW_ADMIN_TILES;
  if (roles.includes("editor")) return OVERVIEW_EDITOR_TILES;
  return [];
}
