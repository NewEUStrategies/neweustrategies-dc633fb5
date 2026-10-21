// Fikstury testów zakładek S7-B: odczyty producentów (lejek S3, inwentarz S3,
// most i oferta S2, migawka S6, fakty S7-A) w kształcie ich DTO.
//
// `as const` + `clone()`: fikstura jest niezmienna, a test dostaje GŁĘBOKĄ
// kopię (JSON) - mutacja w jednym teście nie przecieka do następnego.
// `clone` zwraca `unknown`, więc rzutowanie na DTO jest jawne w miejscu
// użycia (kształt sprawdza kompilator na fiksturze, nie na kopii).
//
// Bez JSX i bez importów runtime komponentów - moduł bywa czytany z fabryk
// `vi.mock`.
import { resolveRevenueRange, type RevenueRange } from "@/lib/revenue/window";

export const TENANT = "11111111-1111-4111-8111-111111111111";

/** Stała chwila testów: 15 października 2026, 12:00 (strefa procesu, TZ=UTC). */
export const NOW_MS = Date.UTC(2026, 9, 15, 12, 0, 0);

export function testRange(period: "month" | "prev-month" | "quarter" = "month"): RevenueRange {
  return resolveRevenueRange(period, NOW_MS);
}

/** Głęboka kopia fikstury - `unknown`, rzutowanie w teście. */
export function clone(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}

export const FUNNEL_DTO = {
  since: "2026-10-01T00:00:00.000Z",
  until: "2026-11-01T00:00:00.000Z",
  segment: "all",
  track: "all",
  amountsVisible: true,
  selfServe: {
    accounts: 200,
    activeAccounts: 800,
    paywallHitAccounts: 120,
    paywallHitVisitors: 340,
    paywallHits: 900,
    paywallConvertedAccounts: 18,
    checkoutStarted: 40,
    checkoutPaid: 30,
    checkoutAbandoned: 10,
    checkoutExpired: 6,
    firstPayments: 25,
    registeredPaid: 12,
    signupFormViews: 500,
    signupFormSubmits: 50,
    visitorsFirstParty: 5000,
    rates: {
      registeredToPaid: 0.06,
      paywallConversion: 0.15,
      paywallHit: 0.15,
      checkoutConversion: 0.75,
      checkoutAbandonment: 0.25,
      couponRedemption: null,
    },
    paidAmount: [{ currency: "PLN", amountMinor: 150_000 }],
    signupSources: [
      { source: "paywall", accounts: 120 },
      { source: "unknown", accounts: 80 },
    ],
    paywallReasons: [{ reason: "paid", accounts: 100, visitors: 300, hits: 800 }],
    paywallDataSince: "2026-09-01T00:00:00.000Z",
  },
  sales: {
    stages: [
      { stage: "lead", leads: 40 },
      { stage: "mql", leads: 20 },
      { stage: "sql", leads: 10 },
      { stage: "opportunity", leads: 5 },
      { stage: "customer", leads: 2 },
    ],
    openTasks: 7,
    overdueTasks: 2,
    doneTasks: 11,
  },
} as const;

export const ACCESS_INVENTORY = {
  computedAt: "2026-10-15T10:00:00.000Z",
  total: 12,
  rows: [
    { entityType: "post", mode: "paid", minTierRank: 0, meteringPolicy: "inherit", count: 5 },
    { entityType: "post", mode: "members", minTierRank: 2, meteringPolicy: "exempt", count: 3 },
    { entityType: "page", mode: "public", minTierRank: 0, meteringPolicy: "inherit", count: 3 },
    { entityType: "media", mode: "password", minTierRank: 0, meteringPolicy: "exempt", count: 1 },
  ],
  byMode: { public: 3, members: 3, paid: 5, password: 1 },
  tiers: [
    {
      key: "free",
      rank: 0,
      active: true,
      pricingVisible: true,
      ctaMode: "none",
      offerable: false,
    },
    { key: "plus", rank: 1, active: true, pricingVisible: true, ctaMode: "auto", offerable: true },
    { key: "pro", rank: 2, active: true, pricingVisible: true, ctaMode: "auto", offerable: true },
  ],
  deadEnds: { tierWithoutOffer: 1, paidWithoutOffer: 0, danglingPlans: 0, meteredTierGated: 0 },
  hits30d: [{ reason: "paid", accounts: 12, visitors: 40, hits: 70 }],
} as const;

export const MRR_BRIDGE = {
  since: "2026-10-01T00:00:00.000Z",
  until: "2026-11-01T00:00:00.000Z",
  segment: "all",
  dataSince: "2026-01-01",
  basisMix: { provider: 9, catalog: 1 },
  currencies: [
    {
      currency: "PLN",
      startMinor: 1_000_000,
      openingMinor: 0,
      newMinor: 200_000,
      expansionMinor: 50_000,
      reactivationMinor: 10_000,
      contractionMinor: -20_000,
      churnMinor: -40_000,
      endMinor: 1_200_000,
      netNewMinor: 200_000,
      activeSubscriptions: 120,
      activeCustomers: 110,
      residualMinor: 0,
      reconciled: true,
    },
    {
      currency: "EUR",
      startMinor: 100_000,
      openingMinor: 0,
      newMinor: 10_000,
      expansionMinor: 0,
      reactivationMinor: 0,
      contractionMinor: 0,
      churnMinor: 0,
      // Koniec 120 000 zamiast 110 000: rozjazd 10 000 (≈ 8 %) - ponad 0,5 %.
      endMinor: 120_000,
      netNewMinor: 10_000,
      activeSubscriptions: 10,
      activeCustomers: 10,
      residualMinor: 10_000,
      reconciled: false,
    },
  ],
  activeSubscriptions: 130,
  activeCustomers: 120,
} as const;

export const OFFER_MATRIX = {
  plans: [
    {
      planId: "plan-plus-month",
      tierKey: "plus",
      interval: "month",
      priceCents: 4900,
      currency: "PLN",
      active: true,
      forSale: true,
      catalogPriceId: "price_plus_m",
      tierActive: true,
      pricingVisible: true,
      activeSubscriptions: 40,
      issues: [],
    },
    {
      planId: "plan-plus-year",
      tierKey: "plus",
      interval: "year",
      priceCents: 49000,
      currency: "PLN",
      active: true,
      forSale: true,
      catalogPriceId: "price_plus_y",
      tierActive: true,
      pricingVisible: true,
      activeSubscriptions: 10,
      issues: [],
    },
    {
      planId: "plan-pro-eur",
      tierKey: "pro",
      interval: "month",
      priceCents: 2900,
      currency: "EUR",
      active: true,
      forSale: false,
      catalogPriceId: null,
      tierActive: true,
      pricingVisible: true,
      activeSubscriptions: 3,
      issues: ["no_catalog_pair"],
    },
  ],
  tiers: [
    {
      key: "plus",
      rank: 1,
      active: true,
      pricingVisible: true,
      isDefault: false,
      plansForSale: 2,
      issues: [],
    },
    {
      key: "pro",
      rank: 2,
      active: true,
      pricingVisible: true,
      isDefault: false,
      plansForSale: 0,
      issues: ["visible_without_plan"],
    },
  ],
} as const;
