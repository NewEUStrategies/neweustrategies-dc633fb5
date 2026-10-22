// `queryOptions` ścieżek (S5): każdy klucz leży pod prefiksem, który
// unieważnia szyna (`journey.changed.v1`, `journey.stats_changed.v1`), a
// `queryFn` woła właściwą server fn z danymi bez najemcy.
import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  listJourneys: vi.fn(),
  getJourneyEnrollments: vi.fn(),
  getLeadJourneys: vi.fn(),
  getJourneySettings: vi.fn(),
  getJourneyEngineHealth: vi.fn(),
  estimateJourneyTrigger: vi.fn(),
  simulateJourney: vi.fn(),
  getJourneyStats: vi.fn(),
  getJourneySeries: vi.fn(),
}));

vi.mock("../journeys.functions", () => ({
  listJourneys: h.listJourneys,
  getJourneyEnrollments: h.getJourneyEnrollments,
  getLeadJourneys: h.getLeadJourneys,
  getJourneySettings: h.getJourneySettings,
  getJourneyEngineHealth: h.getJourneyEngineHealth,
  estimateJourneyTrigger: h.estimateJourneyTrigger,
  simulateJourney: h.simulateJourney,
}));
vi.mock("../stats.functions", () => ({
  getJourneyStats: h.getJourneyStats,
  getJourneySeries: h.getJourneySeries,
}));

import { journeyKeys } from "../keys";
import {
  JOURNEY_HEALTH_REFETCH_MS,
  journeyEngineHealthQueryOptions,
  journeyEnrollmentsQueryOptions,
  journeyListQueryOptions,
  journeySeriesQueryOptions,
  journeySettingsQueryOptions,
  journeySimulationQueryOptions,
  journeyStatsQueryOptions,
  journeyTriggerEstimateQueryOptions,
  leadJourneysQueryOptions,
} from "../queries";

const startsWith = (key: readonly unknown[], prefix: readonly unknown[]) =>
  prefix.every((part, i) => key[i] === part);

async function run(options: { queryFn?: unknown }) {
  const fn = options.queryFn as (ctx: unknown) => Promise<unknown>;
  return fn({});
}

describe("klucze pod prefiksami inwalidacji szyny", () => {
  it("lista, kontakty, lead, statystyki, seria", () => {
    expect(startsWith(journeyListQueryOptions("t1").queryKey, journeyKeys.listAll())).toBe(true);
    expect(
      startsWith(journeyEnrollmentsQueryOptions("j1").queryKey, journeyKeys.enrollmentsFor("j1")),
    ).toBe(true);
    expect(startsWith(leadJourneysQueryOptions("l1").queryKey, journeyKeys.forLeadAll())).toBe(
      true,
    );
    expect(
      startsWith(
        journeyStatsQueryOptions("j1", null, null, null).queryKey,
        journeyKeys.statsFor("j1"),
      ),
    ).toBe(true);
    expect(
      startsWith(journeySeriesQueryOptions("j1", "a", "b").queryKey, journeyKeys.statsFor("j1")),
    ).toBe(true);
  });

  it("odczyty najemcy wyłączone bez najemcy; zdrowie odpytywane co minutę", () => {
    expect(journeyListQueryOptions(null).enabled).toBe(false);
    expect(journeySettingsQueryOptions(null).enabled).toBe(false);
    expect(journeyEngineHealthQueryOptions("t1")).toMatchObject({
      enabled: true,
      refetchInterval: JOURNEY_HEALTH_REFETCH_MS,
    });
    expect(journeyTriggerEstimateQueryOptions(null, "a.b.v1", {}, "h").enabled).toBe(false);
  });
});

describe("queryFn woła server fn bez najemcy", () => {
  it("wszystkie odczyty", async () => {
    await run(journeyListQueryOptions("t1", "active"));
    expect(h.listJourneys).toHaveBeenCalledWith({ data: { status: "active" } });
    await run(journeyEnrollmentsQueryOptions("j1", "m", "waiting", 2));
    expect(h.getJourneyEnrollments).toHaveBeenCalledWith({
      data: { journeyId: "j1", nodeId: "m", status: "waiting", page: 2, pageSize: 50 },
    });
    await run(leadJourneysQueryOptions("l1"));
    expect(h.getLeadJourneys).toHaveBeenCalledWith({ data: { leadId: "l1" } });
    await run(journeySettingsQueryOptions("t1"));
    expect(h.getJourneySettings).toHaveBeenCalledWith();
    await run(journeyEngineHealthQueryOptions("t1"));
    expect(h.getJourneyEngineHealth).toHaveBeenCalledWith();
    await run(journeyStatsQueryOptions("j1", "v1", "s", "u"));
    expect(h.getJourneyStats).toHaveBeenCalledWith({
      data: { journeyId: "j1", versionId: "v1", sinceIso: "s", untilIso: "u" },
    });
    await run(journeySeriesQueryOptions("j1", "s", "u"));
    expect(h.getJourneySeries).toHaveBeenCalledWith({
      data: { journeyId: "j1", sinceIso: "s", untilIso: "u" },
    });
    await run(journeyTriggerEstimateQueryOptions("t1", "a.b.v1", { kind: "x" }, "h"));
    expect(h.estimateJourneyTrigger).toHaveBeenCalledWith({
      data: { eventType: "a.b.v1", condition: { kind: "x" }, days: 30 },
    });
    const sim = journeySimulationQueryOptions("j1", "l1", null, "c");
    expect(sim.queryKey).toEqual(journeyKeys.simulate("j1", "l1", "c"));
    await run(sim);
    expect(h.simulateJourney).toHaveBeenCalledWith({
      data: { journeyId: "j1", leadId: "l1", draft: null },
    });
  });
});
