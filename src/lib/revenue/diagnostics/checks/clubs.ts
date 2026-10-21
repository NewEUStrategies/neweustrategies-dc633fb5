// Reguły obszaru „Kluby" (SPEC §5.7). Fakty czyta SQL z `club_applications`
// i `clubs` (migracja ze znacznikiem `pg-harness: exclude`).
import { areaFacts, ev, finding, OK, UNKNOWN } from "../facts";
import type { RevenueCheck } from "../registry";

/** Lustro okien `_revenue_facts_clubs`: 7 dni (SPEC) i 30 dni (okres rozliczeniowy). */
export const CLUB_APPLICATION_WAIT_DAYS = 7;
export const CLUB_APPLICATION_STALE_DAYS = 30;

export const CLUBS_CHECKS = [
  {
    // Próg rangi klubu, którego nie spełnia żadna aktywna warstwa (nikt
    // nie dołączy) albo spełniają tylko warstwy, których nie da się kupić.
    id: "clubs.rank_without_tier",
    area: "clubs",
    severity: "warning",
    evaluate(facts) {
      const ranks = areaFacts(facts, "clubs")?.rankWithoutTier;
      if (ranks?.impossible === undefined || ranks.notOfferable === undefined) return UNKNOWN;
      if (ranks.impossible + ranks.notOfferable === 0) return OK;
      return finding(ranks.impossible > 0 ? "error" : "warn", {
        count: ranks.impossible + ranks.notOfferable,
        refs: ranks.refs,
        evidence: ev(ranks.impossible > 0 ? "clubRankImpossible" : "clubRankNotOfferable", {
          count: ranks.impossible > 0 ? ranks.impossible : ranks.notOfferable,
        }),
      });
    },
    fix: { kind: "link", to: "/admin/community/clubs" },
    owner: { to: "/admin/community/clubs" },
    snoozable: true,
  },
  {
    id: "clubs.pending_applications_over_7d",
    area: "clubs",
    severity: "info",
    evaluate(facts) {
      const pending = areaFacts(facts, "clubs")?.pendingApplications;
      if (pending?.over7d === undefined || pending.over30d === undefined) return UNKNOWN;
      if (pending.over7d === 0) return OK;
      return finding(pending.over30d > 0 ? "error" : "warn", {
        count: pending.over7d,
        evidence: ev(pending.over30d > 0 ? "clubApplicationsStale" : "clubApplicationsWaiting", {
          count: pending.over30d > 0 ? pending.over30d : pending.over7d,
          days: pending.over30d > 0 ? CLUB_APPLICATION_STALE_DAYS : CLUB_APPLICATION_WAIT_DAYS,
        }),
      });
    },
    fix: {
      kind: "link",
      to: "/admin/community/clubs/applications",
      search: { status: "pending" },
    },
    owner: { to: "/admin/community/clubs/applications" },
    snoozable: true,
  },
] as const satisfies readonly RevenueCheck[];
