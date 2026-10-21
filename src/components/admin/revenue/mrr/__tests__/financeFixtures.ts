// Fikstury testów zakładek Przychód i Retencja (S7-C): odczyty finansów S2
// (szereg MRR, przychód zrealizowany, churn, kohorty, windykacja, przepływ
// anulowania), migawka S6 i ustawienia retencji - w kształcie ich DTO.
//
// `as const` + `clone()` z fikstur S7-B: test dostaje GŁĘBOKĄ kopię (JSON),
// a `clone` zwraca `unknown`, więc rzutowanie na DTO jest jawne w miejscu
// użycia. Bez JSX i bez importów runtime komponentów - moduł bywa czytany
// z fabryk `vi.mock`.
import { authoritativeBinding, type MetricId } from "@/lib/analytics/semantic/metrics";
import type { ReconciliationEntry } from "@/lib/analytics/semantic/reconcile";
import type { RevenueSnapshotResult } from "@/lib/analytics/semantic/revenueSnapshot.functions";

/** Początek księgi: 1 marca 2026 - przy „teraz" testów (15.10.2026) historia < 12 mies. */
export const DATA_SINCE = "2026-03-01";

function entry(metricId: MetricId, value: number | null): ReconciliationEntry {
  return {
    metricId,
    canonicalValue: value,
    authoritativeStream: authoritativeBinding(metricId).streamId,
    observations: [],
    spread: null,
    verdict: "single_source",
    reasons: [],
  };
}

const SNAPSHOT_VALUES: Partial<Record<MetricId, number | null>> = {
  mrr: 1_200_000,
  arr: 14_400_000,
  revenue_realized: 1_180_000,
  net_revenue_retention: 1.0,
  gross_revenue_retention: null,
  logo_churn_monthly: 0.03,
  winback_rate_12m: 0.12,
};

/** Migawka administratora: waluta wiodąca PLN (pierwsza pozycja `money.mrr`). */
export function adminSnapshot(): RevenueSnapshotResult {
  return {
    window: {
      period: "prev-month",
      sinceIso: "2026-09-01T00:00:00.000Z",
      untilIso: "2026-10-01T00:00:00.000Z",
      offsetMinutes: 0,
      complete: true,
    },
    previous: null,
    entries: (Object.keys(SNAPSHOT_VALUES) as MetricId[]).map((id) =>
      entry(id, SNAPSHOT_VALUES[id] ?? null),
    ),
    deltas: [],
    ratios: [],
    streams: [{ streamId: "billing", available: true }],
    money: {
      mrr: [
        { currency: "PLN", amountMinor: 1_200_000 },
        { currency: "EUR", amountMinor: 110_000 },
      ],
      revenue_realized: [
        { currency: "PLN", amountMinor: 1_180_000 },
        { currency: "EUR", amountMinor: 50_000 },
      ],
    },
    dataSince: DATA_SINCE,
    computedAt: "2026-10-15T11:00:00.000Z",
    basisMix: { provider: 10, catalog: 0 },
    role: "admin",
  };
}

export const MRR_SERIES = {
  since: "2026-09-01T00:00:00.000Z",
  until: "2026-10-01T00:00:00.000Z",
  grain: "day",
  timeZone: "UTC",
  points: [
    {
      bucketStart: "2026-09-02",
      at: "2026-09-03T00:00:00.000Z",
      currency: "PLN",
      mrrMinor: 1_010_000,
      activeSubscriptions: 118,
      snapshotMrrMinor: 1_010_000,
      driftMinor: 0,
    },
    {
      bucketStart: "2026-09-01",
      at: "2026-09-02T00:00:00.000Z",
      currency: "PLN",
      mrrMinor: 1_000_000,
      activeSubscriptions: 117,
      snapshotMrrMinor: 1_004_900,
      driftMinor: 4_900,
    },
    {
      bucketStart: "2026-09-01",
      at: "2026-09-02T00:00:00.000Z",
      currency: "EUR",
      mrrMinor: 100_000,
      activeSubscriptions: 10,
      snapshotMrrMinor: null,
      driftMinor: null,
    },
  ],
} as const;

export const REALIZED = {
  since: "2026-09-01T00:00:00.000Z",
  until: "2026-10-01T00:00:00.000Z",
  categories: [
    {
      category: "event",
      currency: "PLN",
      grossMinor: 200_000,
      refundsMinor: 0,
      netMinor: 200_000,
      documents: 20,
    },
    {
      category: "subscription",
      currency: "PLN",
      grossMinor: 1_000_000,
      refundsMinor: 20_000,
      netMinor: 980_000,
      documents: 80,
    },
    {
      category: "subscription",
      currency: "EUR",
      grossMinor: 50_000,
      refundsMinor: 0,
      netMinor: 50_000,
      documents: 5,
    },
  ],
  totals: [
    { currency: "PLN", grossMinor: 1_200_000, refundsMinor: 20_000, netMinor: 1_180_000 },
    { currency: "EUR", grossMinor: 50_000, refundsMinor: 0, netMinor: 50_000 },
  ],
  // PLN: zamówienia poniżej księgi (odnowienia bez zamówień) - porządek
  // zgodny z definicją; EUR: zamówienia PONAD księgą - zgubione dokumenty.
  orders: [
    { currency: "PLN", amountMinor: 900_000, orders: 60 },
    { currency: "EUR", amountMinor: 70_000, orders: 7 },
  ],
  unknownEnvironmentDocuments: 3,
} as const;

export const CHURN = {
  since: "2026-09-01T00:00:00.000Z",
  until: "2026-10-01T00:00:00.000Z",
  customersStart: 100,
  customersChurned: 3,
  logoChurnRate: 0.03,
  involuntaryShare: 0.25,
  currencies: [
    {
      currency: "PLN",
      mrrStartMinor: 1_000_000,
      churnMinor: -40_000,
      contractionMinor: -20_000,
      expansionMinor: 50_000,
      reactivationMinor: 10_000,
      grossRevenueChurn: 0.06,
      grossRevenueRetention: 0.94,
      netRevenueRetention: 0.99,
    },
    {
      // Waluta bez MRR na początku okresu: ilorazy nie istnieją (null, nie 0).
      currency: "EUR",
      mrrStartMinor: 0,
      churnMinor: 0,
      contractionMinor: 0,
      expansionMinor: 0,
      reactivationMinor: 0,
      grossRevenueChurn: null,
      grossRevenueRetention: null,
      netRevenueRetention: null,
    },
  ],
  reasons: [
    { reason: "canceled", movements: 3, amounts: [{ currency: "PLN", amountMinor: -30_000 }] },
    { reason: "unpaid", movements: 1, amounts: [{ currency: "PLN", amountMinor: -10_000 }] },
  ],
} as const;

export const CHURN_PREVIOUS = {
  ...CHURN,
  since: "2026-08-01T00:00:00.000Z",
  until: "2026-09-01T00:00:00.000Z",
  logoChurnRate: 0.05,
  involuntaryShare: 0.4,
  currencies: [
    {
      currency: "PLN",
      mrrStartMinor: 950_000,
      churnMinor: -50_000,
      contractionMinor: 0,
      expansionMinor: 20_000,
      reactivationMinor: 0,
      grossRevenueChurn: 0.0526,
      grossRevenueRetention: 0.9474,
      netRevenueRetention: 0.9684,
    },
  ],
} as const;

export const COHORTS = {
  fromMonth: "2025-12-01",
  toMonth: "2026-09-01",
  maxOffset: 12,
  cohorts: [
    {
      cohortMonth: "2026-09-01",
      size: 4,
      retained: [{ monthOffset: 0, active: 4, share: 1 }],
    },
    {
      cohortMonth: "2026-08-01",
      size: 10,
      retained: [
        { monthOffset: 0, active: 10, share: 1 },
        { monthOffset: 1, active: 8, share: 0.8 },
      ],
    },
  ],
} as const;

export const DUNNING = {
  since: "2026-09-01T00:00:00.000Z",
  until: "2026-10-01T00:00:00.000Z",
  started: 5,
  recovered: 3,
  lost: 1,
  open: 1,
  recoveryRate: 0.75,
  medianDaysToRecover: null,
  atRisk: [{ currency: "PLN", amountMinor: 9_900 }],
  recoveredMrr: [{ currency: "PLN", amountMinor: 14_700 }],
  lostMrr: [
    { currency: "PLN", amountMinor: 4_900 },
    { currency: "EUR", amountMinor: 1_000 },
  ],
} as const;

export const RETENTION_OFFERS = {
  since: "2026-09-01T00:00:00.000Z",
  until: "2026-10-01T00:00:00.000Z",
  flowsStarted: 12,
  saved: 3,
  canceled: 5,
  abandoned: 2,
  open: 2,
  offersShown: 6,
  offersAccepted: 3,
  saveRateGross: 0.375,
  saveRateNet: null,
  reasonNotGiven: 4,
  legacyResponses: 1,
  reasons: [
    { reasonId: null, reasonLabel: "stripe:too_expensive", responses: 2 },
    { reasonId: "4f1c2a8e-0000-4000-8000-000000000001", reasonLabel: "Za drogo", responses: 3 },
    { reasonId: "4f1c2a8e-0000-4000-8000-000000000002", reasonLabel: "Brak czasu", responses: 1 },
  ],
} as const;

export const RETENTION_SETTINGS = {
  tenant_id: "11111111-1111-4111-8111-111111111111",
  enabled: true,
  discount_pct: 20,
  discount_periods: 3,
  coupon_valid_days: 7,
  updated_at: "2026-09-01T00:00:00.000Z",
  updated_by: null,
} as const;
