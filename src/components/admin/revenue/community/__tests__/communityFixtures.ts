// Fikstury zakładki „Społeczność": odczyty S4 (wydarzenia, kluby) i migawka
// S6 z metrykami społeczności - w kształcie DTO producentów.
//
// `as const` + `clone()` (hubFixtures): fikstura jest niezmienna, test
// dostaje głęboką kopię. Bez JSX - moduł bywa czytany z fabryk `vi.mock`.
import { authoritativeBinding, type MetricId } from "@/lib/analytics/semantic/metrics";
import type { ReconciliationEntry } from "@/lib/analytics/semantic/reconcile";
import type { RevenueSnapshotResult } from "@/lib/analytics/semantic/revenueSnapshot.functions";

export const EVENT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const EVENT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const CLUB_A = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

/** Okno kwartału (domyślne `w` zakładki) - dwa wydarzenia, dwie waluty. */
export const EVENTS_SUMMARY = {
  since: "2026-10-01T00:00:00.000Z",
  until: "2027-01-01T00:00:00.000Z",
  moneyVisible: true,
  eventsCount: 2,
  registrations: 40,
  paid: 12,
  attended: 30,
  noShow: 10,
  planPool: 6,
  byCurrency: [
    { currency: "PLN", ticketRevenueNetMinor: 450_000 },
    { currency: "EUR", ticketRevenueNetMinor: 20_000 },
  ],
  events: [
    {
      eventId: EVENT_A,
      slug: "forum-bezpieczenstwa",
      titlePl: "Forum Bezpieczeństwa",
      titleEn: "Security Forum",
      startsAt: "2026-10-20T16:00:00.000Z",
      status: "published",
      registrations: 30,
      paid: 10,
      attended: 24,
      noShow: 6,
      planPool: 6,
      byCurrency: [
        { currency: "PLN", ticketRevenueNetMinor: 450_000 },
        { currency: "EUR", ticketRevenueNetMinor: 20_000 },
      ],
    },
    {
      eventId: EVENT_B,
      slug: "seminarium",
      titlePl: "Seminarium energetyczne",
      titleEn: "",
      startsAt: "2026-11-05T09:00:00.000Z",
      status: "published",
      registrations: 10,
      paid: 2,
      attended: 6,
      noShow: 4,
      planPool: 0,
      byCurrency: [],
    },
  ],
} as const;

/** Te same liczby oczami redaktora: SQL nie oddaje kwot (`null`, nie zero). */
export const EVENTS_SUMMARY_EDITOR = {
  ...EVENTS_SUMMARY,
  moneyVisible: false,
  byCurrency: null,
  events: EVENTS_SUMMARY.events.map((row) => ({ ...row, byCurrency: null })),
} as const;

export const CLUBS_SUMMARY = {
  since: "2026-10-01T00:00:00.000Z",
  until: "2027-01-01T00:00:00.000Z",
  clubsEnabled: true,
  clubsCount: 1,
  members: 25,
  activeMembers: 10,
  contributors: 4,
  applications: { submitted: 8, accepted: 3, rejected: 1, pending: 2 },
  decisionHoursMedian: 20,
  clubs: [
    {
      clubId: CLUB_A,
      slug: "klub-energii",
      namePl: "Klub Energii",
      nameEn: "Energy Club",
      members: 25,
      activeMembers: 10,
      contributors: 4,
      applicationsSubmitted: 8,
      applicationsAccepted: 3,
      applicationsRejected: 1,
    },
  ],
} as const;

export const CLUBS_DISABLED = {
  ...CLUBS_SUMMARY,
  clubsEnabled: false,
  clubsCount: 0,
  members: 0,
  activeMembers: 0,
  contributors: 0,
  applications: { submitted: 0, accepted: 0, rejected: 0, pending: 0 },
  decisionHoursMedian: null,
  clubs: [],
} as const;

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

const COMMUNITY_VALUES: Partial<Record<MetricId, number | null>> = {
  event_attendance_rate: 0.75,
  no_show_rate: 0.25,
  event_ticket_revenue: 450_000,
  club_active_member_rate: 0.4,
  club_contributor_rate: 0.16,
  club_application_acceptance: 0.75,
  club_decision_time: 20,
};

/** Migawka z metrykami społeczności; redaktor bez kwoty biletów. */
export function communitySnapshot(role: "admin" | "editor"): RevenueSnapshotResult {
  const ids = (Object.keys(COMMUNITY_VALUES) as MetricId[]).filter(
    (id) => role === "admin" || id !== "event_ticket_revenue",
  );
  return {
    window: {
      period: "quarter",
      sinceIso: "2026-10-01T00:00:00.000Z",
      untilIso: "2027-01-01T00:00:00.000Z",
      offsetMinutes: 0,
      complete: false,
    },
    previous: null,
    entries: ids.map((id) => entry(id, COMMUNITY_VALUES[id] ?? null)),
    deltas: [],
    ratios: [],
    streams: [
      { streamId: "community", available: true },
      role === "admin"
        ? { streamId: "billing", available: true }
        : { streamId: "billing", available: false, reason: "admin_only" },
    ],
    money:
      role === "admin"
        ? {
            event_ticket_revenue: [
              { currency: "PLN", amountMinor: 450_000 },
              { currency: "EUR", amountMinor: 20_000 },
            ],
          }
        : {},
    dataSince: "2026-01-01",
    computedAt: "2026-10-15T11:00:00.000Z",
    basisMix: null,
    role,
  };
}
