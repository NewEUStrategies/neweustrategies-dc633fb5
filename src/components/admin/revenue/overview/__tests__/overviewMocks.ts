// Fikstury Kokpitu: migawka S6, fakty S7-A, ścieżki S5 i społeczność S4
// w kształcie odczytów producentów. Bez JSX - moduł bywa czytany z fabryk
// `vi.mock`.
import { authoritativeBinding, type MetricId } from "@/lib/analytics/semantic/metrics";
import type { ReconciliationEntry } from "@/lib/analytics/semantic/reconcile";
import type { RevenueSnapshotResult } from "@/lib/analytics/semantic/revenueSnapshot.functions";
import type { RevenueFacts } from "@/lib/revenue/diagnostics/facts";

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

const VALUES: Partial<Record<MetricId, number>> = {
  mrr: 1_200_000,
  net_new_mrr: 200_000,
  revenue_realized: 1_300_000,
  net_revenue_retention: 1.02,
  logo_churn_monthly: 0.03,
  registered_to_paid_rate: 0.06,
  paywall_hit_rate: 0.15,
  paywall_conversion_rate: 0.15,
  checkout_conversion_rate: 0.75,
  event_attendance_rate: 0.8,
  club_active_member_rate: 0.4,
};

export function snapshot(role: "admin" | "editor"): RevenueSnapshotResult {
  const ids = Object.keys(VALUES) as MetricId[];
  const money = role === "admin";
  return {
    window: {
      period: "month",
      sinceIso: "2026-10-01T00:00:00.000Z",
      untilIso: "2026-11-01T00:00:00.000Z",
      offsetMinutes: 0,
      complete: false,
    },
    previous: null,
    entries: ids
      .filter((id) => money || !["mrr", "net_new_mrr", "revenue_realized"].includes(id))
      .map((id) => entry(id, VALUES[id] ?? null)),
    deltas: [],
    ratios: [],
    streams: [
      {
        streamId: "billing",
        available: money,
        ...(money ? {} : { reason: "admin_only" as const }),
      },
    ],
    money: money
      ? {
          mrr: [{ currency: "PLN", amountMinor: 1_200_000 }],
          net_new_mrr: [{ currency: "PLN", amountMinor: 200_000 }],
          revenue_realized: [{ currency: "PLN", amountMinor: 1_300_000 }],
        }
      : {},
    dataSince: "2026-01-01",
    computedAt: "2026-10-15T11:00:00.000Z",
    basisMix: money ? { provider: 10, catalog: 0 } : null,
    role,
  };
}

/** Fakty: plan w sprzedaży jest, licznik bez wiersza, retencja wyłączona, silnik ścieżek działa. */
export const FACTS: RevenueFacts = {
  v: 1,
  computedAt: "2026-10-15T10:00:00.000Z",
  areas: {
    catalog: {
      plans: [
        {
          id: "plan-plus-month",
          tierKey: "plus",
          tierFound: true,
          tierRank: 1,
          active: true,
          forSale: true,
          interval: "month",
          currency: "PLN",
          priceCents: 4900,
          catalogPair: true,
        },
      ],
    },
    metering: { settingsRow: false },
    retention: { settingsRow: true, enabled: false },
    journeys: { engineEnabled: true, activeCount: 2 },
  },
};

export const JOURNEYS = [
  { enrolled30d: 30, goalReached30d: 5 },
  { enrolled30d: 12, goalReached30d: 1 },
].map((counts, index) => ({
  id: `journey-${index}`,
  key: `j${index}`,
  name: `Ścieżka ${index}`,
  description: null,
  status: "active",
  category: "onboarding",
  templateKey: null,
  publishedVersionId: null,
  version: 1,
  triggerEventType: null,
  createdAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-01T00:00:00Z",
  active: 3,
  ...counts,
}));

export const EVENTS_SUMMARY = {
  since: "2026-10-01T00:00:00.000Z",
  until: "2026-11-01T00:00:00.000Z",
  moneyVisible: true,
  eventsCount: 3,
  registrations: 50,
  paid: 10,
  attended: 40,
  noShow: 10,
  planPool: 2,
  byCurrency: [{ currency: "PLN", ticketRevenueNetMinor: 90_000 }],
  events: [],
};

export const CLUBS_SUMMARY = {
  since: "2026-10-01T00:00:00.000Z",
  until: "2026-11-01T00:00:00.000Z",
  clubsEnabled: true,
  clubsCount: 2,
  members: 25,
  activeMembers: 10,
  contributors: 4,
  applications: { submitted: 6, accepted: 3, rejected: 1, pending: 2 },
  decisionHoursMedian: 20,
  clubs: [],
};
