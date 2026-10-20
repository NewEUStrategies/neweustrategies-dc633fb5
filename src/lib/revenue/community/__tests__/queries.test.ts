// `queryOptions` przekrojów społeczności (S4): klucze z fabryki I0, świeżość,
// wyłączenie bez najemcy - i zejście do wydarzenia z ARGUMENTAMI STUDIA
// (wspólny wpis cache huba i studia wydarzenia).
import { keepPreviousData } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { revenueKeys } from "@/lib/revenue/keys";

const h = vi.hoisted(() => ({
  getRevenueEventsSummary: vi.fn(),
  getRevenueClubsSummary: vi.fn(),
  fetchRegistrationCounts: vi.fn(),
  fetchAdsFunnel: vi.fn(),
}));

vi.mock("@/lib/revenue/community/community.functions", () => ({
  getRevenueEventsSummary: h.getRevenueEventsSummary,
  getRevenueClubsSummary: h.getRevenueClubsSummary,
}));
vi.mock("@/lib/events/registrationsApi", async (orig) => ({
  ...(await orig<typeof import("@/lib/events/registrationsApi")>()),
  fetchRegistrationCounts: h.fetchRegistrationCounts,
}));
vi.mock("@/lib/events/adsFunnelApi", async (orig) => ({
  ...(await orig<typeof import("@/lib/events/adsFunnelApi")>()),
  fetchAdsFunnel: h.fetchAdsFunnel,
}));

import {
  COMMUNITY_GC_MS,
  COMMUNITY_STALE_COMPLETE_MS,
  COMMUNITY_STALE_OPEN_MS,
  STUDIO_REGISTRATION_COUNTS_STALE_MS,
  eventAdsFunnelAllTimeQueryOptions,
  eventRegistrationCountsQueryOptions,
  revenueClubsSummaryQueryOptions,
  revenueEventsSummaryQueryOptions,
} from "@/lib/revenue/community/queries";
import { registrationKeys } from "@/lib/events/useEventRegistrations";
import { adsFunnelKeys } from "@/lib/events/useEventAdsFunnel";

const TENANT = "tenant-1";

function range(complete: boolean) {
  return {
    period: "month" as const,
    current: { sinceIso: "2026-09-01T00:00:00.000Z", untilIso: "2026-10-01T00:00:00.000Z" },
    complete,
  };
}

beforeEach(() => {
  for (const fn of Object.values(h)) fn.mockReset();
  h.getRevenueEventsSummary.mockResolvedValue({ state: "forbidden" });
  h.getRevenueClubsSummary.mockResolvedValue({ state: "unavailable" });
});

describe("przekroje huba", () => {
  it("klucze = revenueKeys.query('events'|'clubs', najemca, okno) - prefiks reguł szyny", () => {
    const events = revenueEventsSummaryQueryOptions(TENANT, range(false));
    const clubs = revenueClubsSummaryQueryOptions(TENANT, range(false));
    expect(events.queryKey).toEqual(revenueKeys.query("events", TENANT, range(false)));
    expect(clubs.queryKey).toEqual(revenueKeys.query("clubs", TENANT, range(false)));
    expect(events.queryKey.slice(0, 3)).toEqual(revenueKeys.domainTenant("events", TENANT));
    expect(clubs.queryKey.slice(0, 3)).toEqual(revenueKeys.domainTenant("clubs", TENANT));
  });

  it("świeżość: okno otwarte 60 s, domknięte 30 min; gc 10 min; retry 1; poprzednie dane", () => {
    const open = revenueEventsSummaryQueryOptions(TENANT, range(false));
    const done = revenueClubsSummaryQueryOptions(TENANT, range(true));
    expect(open.staleTime).toBe(COMMUNITY_STALE_OPEN_MS);
    expect(COMMUNITY_STALE_OPEN_MS).toBe(60_000);
    expect(done.staleTime).toBe(COMMUNITY_STALE_COMPLETE_MS);
    expect(COMMUNITY_STALE_COMPLETE_MS).toBe(30 * 60_000);
    expect(open.gcTime).toBe(COMMUNITY_GC_MS);
    expect(open.retry).toBe(1);
    expect(open.placeholderData).toBe(keepPreviousData);
  });

  it("bez najemcy zapytania są wyłączone", () => {
    expect(revenueEventsSummaryQueryOptions(null, range(false)).enabled).toBe(false);
    expect(revenueClubsSummaryQueryOptions(null, range(false)).enabled).toBe(false);
    expect(revenueEventsSummaryQueryOptions(TENANT, range(false)).enabled).toBe(true);
  });

  it("queryFn woła server fn z oknem, bez najemcy w parametrach", async () => {
    const options = revenueEventsSummaryQueryOptions(TENANT, range(false));
    await (options.queryFn as () => Promise<unknown>)();
    expect(h.getRevenueEventsSummary).toHaveBeenCalledWith({
      data: { sinceIso: "2026-09-01T00:00:00.000Z", untilIso: "2026-10-01T00:00:00.000Z" },
    });
    const clubs = revenueClubsSummaryQueryOptions(TENANT, range(true));
    await expect((clubs.queryFn as () => Promise<unknown>)()).resolves.toEqual({
      state: "unavailable",
    });
  });
});

describe("zejście do wydarzenia = argumenty studia", () => {
  it("liczniki zgłoszeń: klucz przeglądu wydarzenia w studiu (EventOverviewPanel)", () => {
    const options = eventRegistrationCountsQueryOptions("ev-1");
    // Dosłownie argumenty `useRegistrationCounts` z przeglądu wydarzenia.
    expect(options.queryKey).toEqual(
      registrationKeys.counts({
        eventId: "ev-1",
        ticketTypeId: null,
        groupId: null,
        q: "",
        from: null,
        to: null,
      }),
    );
    expect(options.staleTime).toBe(STUDIO_REGISTRATION_COUNTS_STALE_MS);
    expect(STUDIO_REGISTRATION_COUNTS_STALE_MS).toBe(15_000);
  });

  it("przegląd studia wciąż składa to samo zapytanie (źródło nie odjechało)", () => {
    const source = readFileSync(
      join(process.cwd(), "src/components/admin/events/organisms/EventOverviewPanel.tsx"),
      "utf8",
    );
    expect(source.replace(/\s+/g, " ")).toContain(
      'useRegistrationCounts({ eventId, ticketTypeId: null, groupId: null, q: "", from: null, to: null, })',
    );
  });

  it("liczniki: ta sama funkcja pobrania i parser co studio", async () => {
    h.fetchRegistrationCounts.mockResolvedValue({ all: 3 });
    const options = eventRegistrationCountsQueryOptions("ev-1");
    await (options.queryFn as () => Promise<unknown>)();
    expect(h.fetchRegistrationCounts).toHaveBeenCalledWith({
      eventId: "ev-1",
      ticketTypeId: null,
      groupId: null,
      q: "",
      from: null,
      to: null,
    });
  });

  it("lejek reklam: klucz presetu `all` studia (bez granic okna)", async () => {
    const options = eventAdsFunnelAllTimeQueryOptions("ev-1");
    expect(options.queryKey).toEqual(
      adsFunnelKeys.report({ eventId: "ev-1", from: null, to: null }),
    );
    h.fetchAdsFunnel.mockResolvedValue({ totals: {} });
    await (options.queryFn as () => Promise<unknown>)();
    expect(h.fetchAdsFunnel).toHaveBeenCalledWith({ eventId: "ev-1", from: null, to: null });
  });

  it("pusty identyfikator wyłącza zejście", () => {
    expect(eventRegistrationCountsQueryOptions("").enabled).toBe(false);
    expect(eventAdsFunnelAllTimeQueryOptions("").enabled).toBe(false);
  });
});
