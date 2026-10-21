// Klucze słownika kroków mapy lejka i ekran-właściciel każdego kroku.
//
// JAWNA MAPA, NIE SKLEJANIE KLUCZY. Etykiety i definicje kroków żyją
// w słowniku S3 (`adminRevenue.funnel.stage.<krok>`), etap aktywacji -
// w słowniku zakładek (D-02: „brak definicji", bez `MetricId`). Mapa po typie
// kroku sprawia, że nowy krok w `REVENUE_FUNNEL_STAGES` bez napisu nie
// skompiluje się, zamiast pokazać surowy klucz.
//
// Właściciel kroku = ekran, w którym admin zmienia to, co krok liczy
// (kontrakt deep linków SPEC §2.6); aktywacja nie ma właściciela, bo nie ma
// definicji.
import type { RevenueFunnelStage } from "@/lib/revenue/funnel/funnelStages";
import type { RevenueSegment, RevenueTrack } from "@/lib/revenue/search";

/** Krok mapy: kroki lejka S3 i etap aktywacji bez definicji (D-02). */
export type FunnelMapStage = RevenueFunnelStage | "activation";

export const FUNNEL_MAP_STAGES: readonly FunnelMapStage[] = [
  "visitors",
  "accounts",
  "activation",
  "paywall",
  "checkout",
  "paid",
];

export function isFunnelMapStage(raw: unknown): raw is FunnelMapStage {
  return typeof raw === "string" && (FUNNEL_MAP_STAGES as readonly string[]).includes(raw);
}

export const STAGE_LABEL_KEY: Readonly<Record<FunnelMapStage, string>> = {
  visitors: "adminRevenue.funnel.stage.visitors.label",
  accounts: "adminRevenue.funnel.stage.accounts.label",
  activation: "adminRevenue.funnelTab.stage.activation",
  paywall: "adminRevenue.funnel.stage.paywall.label",
  checkout: "adminRevenue.funnel.stage.checkout.label",
  paid: "adminRevenue.funnel.stage.paid.label",
};

export const STAGE_HINT_KEY: Readonly<Record<FunnelMapStage, string>> = {
  visitors: "adminRevenue.funnel.stage.visitors.hint",
  accounts: "adminRevenue.funnel.stage.accounts.hint",
  activation: "adminRevenue.funnelTab.stage.activationNote",
  paywall: "adminRevenue.funnel.stage.paywall.hint",
  checkout: "adminRevenue.funnel.stage.checkout.hint",
  paid: "adminRevenue.funnel.stage.paid.hint",
};

export interface FunnelStageOwner {
  to: string;
  search?: Readonly<Record<string, string>>;
}

export const STAGE_OWNER: Readonly<Record<FunnelMapStage, FunnelStageOwner | null>> = {
  visitors: { to: "/admin/analytics/bi" },
  accounts: { to: "/admin/crm" },
  activation: null,
  paywall: { to: "/admin/paywall" },
  checkout: { to: "/admin/paywall", search: { tab: "checkout" } },
  paid: { to: "/admin/billing", search: { tab: "orders" } },
};

/**
 * Argumenty fabryki lejka - jedno miejsce, żeby Kokpit, mapa i karty zakładki
 * wołały `revenueFunnelQueryOptions` z tym samym kluczem (brak segmentu =
 * `all`, brak toru = `all`, tak jak domyślne wartości fabryki).
 */
export function funnelFiltersOf(segment: RevenueSegment | null, track: RevenueTrack = "all") {
  return { segment: segment ?? "all", track } as const;
}
