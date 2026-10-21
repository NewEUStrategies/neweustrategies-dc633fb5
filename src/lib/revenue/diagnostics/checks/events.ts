// Reguły obszaru „Wydarzenia" (SPEC §5.7).
import { areaFacts, ev, finding, OK, UNKNOWN } from "../facts";
import type { RevenueCheck } from "../registry";

/** Więcej niż połowa odebranych biletów z planu niewykorzystana = benefit nie działa. */
export const TICKET_UNUSED_MAJORITY = 0.5;

const OWNER = { to: "/admin/events" } as const;

export const EVENTS_CHECKS = [
  {
    id: "events.ticket_benefit_unused",
    area: "events",
    severity: "info",
    evaluate(facts) {
      const claims = areaFacts(facts, "events")?.ticketClaims;
      if (claims?.claimedPast === undefined || claims.unredeemed === undefined) return UNKNOWN;
      if (claims.claimedPast === 0 || claims.unredeemed === 0) return OK;
      const share = claims.unredeemed / claims.claimedPast;
      return finding(share > TICKET_UNUSED_MAJORITY ? "error" : "warn", {
        count: claims.unredeemed,
        evidence: ev("ticketClaimsUnused", { count: claims.unredeemed, total: claims.claimedPast }),
      });
    },
    fix: { kind: "link", to: "/admin/events" },
    owner: OWNER,
    snoozable: true,
  },
  {
    id: "events.upcoming_without_comms_journey",
    area: "events",
    severity: "info",
    evaluate(facts) {
      const events = areaFacts(facts, "events");
      if (
        events?.upcoming30d === undefined ||
        events.upcoming7dWithRegistrations === undefined ||
        events.nurtureActive === undefined
      ) {
        return UNKNOWN;
      }
      if (events.upcoming30d === 0 || events.nurtureActive) return OK;
      // Wydarzenie w ciągu tygodnia z zapisanymi, a nikt nie przypomni im o terminie.
      return finding(events.upcoming7dWithRegistrations > 0 ? "error" : "warn", {
        count: events.upcoming30d,
        evidence: ev("eventsWithoutNurture", {
          count: events.upcoming30d,
          soon: events.upcoming7dWithRegistrations,
        }),
      });
    },
    fix: {
      kind: "link",
      to: "/admin/revenue/journeys",
      search: { new: "1", template: "event_registration_nurture" },
    },
    owner: OWNER,
    snoozable: true,
  },
] as const satisfies readonly RevenueCheck[];
