// STAN „W PRZYGOTOWANIU" ZAKŁADEK HUBA „PRZYCHÓD I LEJEK" (I9a, 2026-10-20).
//
// DLACZEGO TO ISTNIEJE. Właściciel przesunął widoczność huba w nawigacji
// panelu z I9 na teraz („wszystko, co robimy, ma być w panelu admina"). Treść
// zakładek dowożą dopiero S7 (kokpit, przychód, lejek, retencja, społeczność,
// diagnostyka, oferta, dostęp, dane wejściowe) i S5+S8 (ścieżki), a zaślepki
// I0 mówiły jedno zdanie „w przygotowaniu". Admin, który z menu trafi na taką
// zakładkę, ma się dowiedzieć: CO tu będzie, KIEDY (etap) i GDZIE te dane są
// w panelu JUŻ DZIŚ - a nie zobaczyć pusty ekran.
//
// DANE, NIE GAŁĘZIE. Etap, opis i odnośniki każdej zakładki stoją w jednej
// mapie `Record` po typie zakładek - nowa zakładka bez wpisu nie skompiluje
// się. Odnośniki to `RelatedModule` (ten sam kształt co pasek „Powiązane
// moduły"); cele i parametry wzięte z `AREA_OWNER_LINK`, gdzie obszar ma
// właściciela, więc kontrakt deep linków SPEC §2.6 jest jeden. Test
// `tabPreparing.test.ts` sprawdza, że każdy cel istnieje w `routeTree.gen.ts`
// i ma parametry z kontraktu, a każdy klucz - napis PL i EN.
//
// PRZEJŚCIOWE. Wycinek, który podmienia zaślepkę zakładki na treść, usuwa jej
// wpis tutaj (albo zostawia odnośniki jako „Powiązane moduły" zakładki).
// Integrator S8 (2026-10-22): Ścieżki mają treść (lista, galeria, edytor), więc
// ich wpis, etap `s5s8` i odnośnik do skrzynki nadawczej zniknęły. Mapa jest
// `Partial`: zakładka bez wpisu nie rysuje tego stanu (`RevenueTabPreparing`).
// Plik leży w `src/lib/admin/**` - poza skanem arkusza CSS czytelnika.
import { AREA_OWNER_LINK, type RelatedModule } from "@/lib/admin/revenue/hubTabs";
import type { RevenueTabId } from "@/lib/revenue/search";

/**
 * Etap, który dowiezie treść zakładki: `s7` - zakładki i diagnostyka,
 * `s6s7` - słownik działa (S6), wartości z oceną dokłada S7. Etap `s5s8`
 * (Ścieżki) zniknął razem z ich zaślepką (Integrator S8).
 */
export type RevenueTabStage = "s7" | "s6s7";

export interface TabPreparingSpec {
  stage: RevenueTabStage;
  /** Klucz `adminRevenue.preparing.what.*` - co pokaże zakładka. */
  whatKey: string;
  /** Moduły panelu, w których te dane są już dziś (kolejność = ważność). */
  links: readonly RelatedModule[];
}

export const TAB_STAGE_KEY: Readonly<Record<RevenueTabStage, string>> = {
  s7: "adminRevenue.preparing.stage.s7",
  s6s7: "adminRevenue.preparing.stage.s6s7",
};

/** Nazwy zakładek huba - te same klucze, co pasek zakładek (`RevenueHubLayout`). */
export const TAB_TITLE_KEY: Readonly<Record<RevenueTabId, string>> = {
  overview: "adminRevenue.tab.overview",
  mrr: "adminRevenue.tab.mrr",
  funnel: "adminRevenue.tab.funnel",
  retention: "adminRevenue.tab.retention",
  community: "adminRevenue.tab.community",
  diagnostics: "adminRevenue.tab.diagnostics",
  offer: "adminRevenue.tab.offer",
  access: "adminRevenue.tab.access",
  journeys: "adminRevenue.tab.journeys",
  metrics: "adminRevenue.tab.metrics",
  inputs: "adminRevenue.tab.inputs",
};

// ---------------------------------------------------------------------------
// Odnośniki do modułów (cele i parametry z kontraktu SPEC §2.6)
// ---------------------------------------------------------------------------

const BI: RelatedModule = {
  to: "/admin/analytics/bi",
  labelKey: "adminRevenue.related.analytics",
};
const MONETIZATION: RelatedModule = {
  to: "/admin/monetization",
  labelKey: "adminRevenue.preparing.link.monetization",
};
const LEDGER: RelatedModule = {
  ...AREA_OWNER_LINK.data_quality,
  labelKey: "adminRevenue.preparing.link.ledger",
};
const SUBSCRIPTIONS: RelatedModule = {
  ...AREA_OWNER_LINK.dunning,
  labelKey: "adminRevenue.preparing.link.subscriptions",
};
const BILLING: RelatedModule = { to: "/admin/billing", labelKey: "adminRevenue.related.billing" };
const CRM_FUNNEL: RelatedModule = {
  to: "/admin/crm/funnel",
  labelKey: "adminRevenue.preparing.link.crmFunnel",
};
const PAYWALL: RelatedModule = {
  ...AREA_OWNER_LINK.paywall,
  labelKey: "adminRevenue.related.paywall",
};
const PLANS: RelatedModule = {
  ...AREA_OWNER_LINK.catalog,
  labelKey: "adminRevenue.preparing.link.plans",
};
const METERING: RelatedModule = {
  ...AREA_OWNER_LINK.metering,
  labelKey: "adminRevenue.preparing.link.metering",
};
const OVERRIDES: RelatedModule = {
  to: "/admin/paywall",
  search: { tab: "overrides" },
  labelKey: "adminRevenue.preparing.link.overrides",
};
// Kasa: tu admin ustawia także okno porzucenia (`abandon_after_minutes`, I9a).
const CHECKOUT: RelatedModule = {
  ...AREA_OWNER_LINK.checkout,
  labelKey: "adminRevenue.preparing.link.checkout",
};
const PRICING: RelatedModule = { to: "/admin/pricing", labelKey: "adminRevenue.related.pricing" };
const RETENTION_FLOW: RelatedModule = {
  ...AREA_OWNER_LINK.retention,
  labelKey: "adminRevenue.preparing.link.retentionFlow",
};
const MEMBERSHIP: RelatedModule = {
  to: "/admin/membership",
  labelKey: "adminRevenue.related.membership",
};
const COUPONS: RelatedModule = {
  ...AREA_OWNER_LINK.coupons,
  labelKey: "adminRevenue.related.coupons",
};
const SIGNUP_POPUP: RelatedModule = {
  ...AREA_OWNER_LINK.funnel,
  labelKey: "adminRevenue.preparing.link.signupPopup",
};
const EVENTS: RelatedModule = {
  ...AREA_OWNER_LINK.events,
  labelKey: "adminRevenue.preparing.link.events",
};
const CLUBS: RelatedModule = {
  to: "/admin/community/clubs",
  labelKey: "adminRevenue.preparing.link.clubs",
};
const CLUB_APPLICATIONS: RelatedModule = {
  ...AREA_OWNER_LINK.clubs,
  labelKey: "adminRevenue.preparing.link.clubApplications",
};

/**
 * Stan każdej zakładki huba. Odnośniki niczego nie odsłaniają: te same moduły
 * pasek boczny pokazuje dziś każdemu członkowi personelu, a dane w nich
 * filtruje baza (RLS, `has_role`). Zakładki z kwotami (Przychód, Retencja,
 * Dane wejściowe) widzi i tak wyłącznie admin - hub daje redaktorowi
 * `RoleGateNotice` przed tym stanem.
 */
export const TAB_PREPARING: Readonly<Partial<Record<RevenueTabId, TabPreparingSpec>>> = {
  overview: {
    stage: "s7",
    whatKey: "adminRevenue.preparing.what.overview",
    links: [BI, MONETIZATION, PAYWALL, CRM_FUNNEL],
  },
  mrr: {
    stage: "s7",
    whatKey: "adminRevenue.preparing.what.mrr",
    links: [BI, SUBSCRIPTIONS, LEDGER, MONETIZATION],
  },
  funnel: {
    stage: "s7",
    whatKey: "adminRevenue.preparing.what.funnel",
    links: [PAYWALL, SIGNUP_POPUP, CRM_FUNNEL, BI],
  },
  retention: {
    stage: "s7",
    whatKey: "adminRevenue.preparing.what.retention",
    links: [RETENTION_FLOW, SUBSCRIPTIONS, BI],
  },
  community: {
    stage: "s7",
    whatKey: "adminRevenue.preparing.what.community",
    links: [EVENTS, CLUBS, CLUB_APPLICATIONS],
  },
  diagnostics: {
    stage: "s7",
    whatKey: "adminRevenue.preparing.what.diagnostics",
    links: [PLANS, CHECKOUT, COUPONS, BILLING],
  },
  offer: {
    stage: "s7",
    whatKey: "adminRevenue.preparing.what.offer",
    links: [PLANS, MEMBERSHIP, PRICING, COUPONS],
  },
  access: {
    stage: "s7",
    whatKey: "adminRevenue.preparing.what.access",
    links: [METERING, OVERRIDES, CHECKOUT, MEMBERSHIP],
  },
  metrics: {
    stage: "s6s7",
    whatKey: "adminRevenue.preparing.what.metrics",
    links: [BI],
  },
  inputs: {
    stage: "s7",
    whatKey: "adminRevenue.preparing.what.inputs",
    links: [BI, LEDGER, MONETIZATION],
  },
};
