// Fikstury zakładki „Wskaźniki": migawka S6 (administrator albo redaktor)
// i ekonomika S2 w kształcie DTO producentów. Bez JSX - moduł bywa czytany
// z fabryk `vi.mock`.
//
// Migawka ma wpisy, które dają każdy rodzaj powodu braku: kwoty w dwóch
// walutach (MRR) i w jednej (przychód zrealizowany), NRR bez wartości
// (historia), churn roczny poza oknem 12 miesięcy, newsletter
// niepodłączony i kasa bez mianownika.
import { authoritativeBinding, type MetricId } from "@/lib/analytics/semantic/metrics";
import type { ReconciliationEntry } from "@/lib/analytics/semantic/reconcile";
import type { RevenueSnapshotResult } from "@/lib/analytics/semantic/revenueSnapshot.functions";

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

const VALUES: Partial<Record<MetricId, number | null>> = {
  mrr: 1_200_000,
  revenue_realized: 1_180_000,
  logo_churn_monthly: 0.03,
  logo_churn_annual: null,
  net_revenue_retention: null,
  email_open_rate: null,
  checkout_conversion_rate: null,
  event_attendance_rate: 0.75,
};

/** Metryki na strumieniu rozliczeń - redaktor ich nie dostaje (`admin_only`). */
const BILLING: readonly MetricId[] = [
  "mrr",
  "revenue_realized",
  "logo_churn_monthly",
  "logo_churn_annual",
  "net_revenue_retention",
];

export function metricsSnapshot(
  role: "admin" | "editor",
  overrides: Partial<Pick<RevenueSnapshotResult, "dataSince">> = {},
): RevenueSnapshotResult {
  const admin = role === "admin";
  const ids = (Object.keys(VALUES) as MetricId[]).filter((id) => admin || !BILLING.includes(id));
  return {
    window: {
      period: "prev-month",
      sinceIso: "2026-09-01T00:00:00.000Z",
      untilIso: "2026-10-01T00:00:00.000Z",
      offsetMinutes: 0,
      complete: true,
    },
    previous: null,
    entries: ids.map((id) => entry(id, VALUES[id] ?? null)),
    deltas: [],
    ratios: [],
    streams: [
      admin
        ? { streamId: "billing", available: true }
        : { streamId: "billing", available: false, reason: "admin_only" },
      { streamId: "lifecycle", available: true },
      { streamId: "community", available: true },
      { streamId: "newsletter", available: false, reason: "not_configured" },
    ],
    money: admin
      ? {
          mrr: [
            { currency: "PLN", amountMinor: 1_200_000 },
            { currency: "EUR", amountMinor: 110_000 },
          ],
          revenue_realized: [{ currency: "PLN", amountMinor: 1_180_000 }],
        }
      : {},
    dataSince: overrides.dataSince ?? "2025-01-01",
    computedAt: "2026-10-15T11:00:00.000Z",
    basisMix: admin ? { provider: 10, catalog: 0 } : null,
    role,
  };
}

/** Ekonomika: wrzesień w PLN z kosztem i marżą, bez marży EBITDA. */
export const ECONOMICS = {
  fromMonth: "2026-09-01",
  toMonth: "2026-09-01",
  timeZone: "UTC",
  months: [
    {
      month: "2026-09-01",
      currency: "PLN",
      mrrEndMinor: 1_200_000,
      customersEnd: 120,
      arpaMinor: 10_000,
      newCustomers: 8,
      logoChurnRate: 0.03,
      realizedNetMinor: 1_180_000,
      salesMarketingCostMinor: 200_000,
      cogsMinor: null,
      grossMargin: 0.7,
      ebitdaMargin: null,
      cacMinor: 25_000,
      ltvMinor: 800_000,
      ltvCacRatio: 32,
      cacPaybackMonths: 3.57,
      mrrPlanMinor: null,
      planAttainment: null,
      newCustomersPlan: null,
      missing: ["mrr_plan", "new_customers_plan", "ebitda_margin_pct"],
    },
  ],
  missing: ["mrr_plan", "new_customers_plan", "ebitda_margin_pct"],
  ruleOf40: null,
} as const;
