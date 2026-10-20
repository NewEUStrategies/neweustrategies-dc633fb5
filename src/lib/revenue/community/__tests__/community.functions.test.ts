// Server fns przekrojów społeczności (S4): obudowa, literały RPC, okno,
// stany zamiast wyjątków, najemca z sesji (nigdy w parametrach).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetServerFnContext, serverFnMeta, setServerFnContext } from "@/test/serverFn";
import { REVENUE_CUSTOM_COMPARE_MAX_DAYS } from "@/lib/revenue/window";

const h = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@tanstack/react-start", async () =>
  (await import("@/test/serverFn")).serverFnModuleMock(),
);
vi.mock("@/integrations/supabase/require-staff", () => ({
  requireCrmStaff: { __mw: "requireCrmStaff" },
}));

import {
  COMMUNITY_MAX_WINDOW_DAYS,
  getRevenueClubsSummary,
  getRevenueEventsSummary,
} from "@/lib/revenue/community/community.functions";

const WINDOW = { sinceIso: "2026-09-01T00:00:00.000Z", untilIso: "2026-10-01T00:00:00.000Z" };

const EVENTS_RAW = {
  since: WINDOW.sinceIso,
  until: WINDOW.untilIso,
  money_visible: false,
  events_count: 0,
  registrations: 0,
  paid: 0,
  attended: 0,
  no_show: 0,
  plan_pool: 0,
  by_currency: null,
  events: [],
};

const CLUBS_RAW = {
  since: WINDOW.sinceIso,
  until: WINDOW.untilIso,
  clubs_enabled: false,
  clubs_count: 0,
  members: 0,
  active_members: 0,
  contributors: 0,
  applications: { submitted: 0, accepted: 0, rejected: 0, pending: 0 },
  decision_hours_median: null,
  clubs: [],
};

beforeEach(() => {
  h.rpc.mockReset();
  setServerFnContext({ supabase: { rpc: h.rpc }, userId: "user-1" });
});

afterEach(() => resetServerFnContext());

describe("obudowa", () => {
  it("POST za bramką sztabu CRM, z walidatorem", () => {
    for (const fn of [getRevenueEventsSummary, getRevenueClubsSummary]) {
      expect(serverFnMeta(fn)?.method).toBe("POST");
      expect(serverFnMeta(fn)?.middleware).toEqual([{ __mw: "requireCrmStaff" }]);
      expect(serverFnMeta(fn)?.hasValidator).toBe(true);
    }
  });

  it("nazwy RPC są literałami w miejscu wywołania", () => {
    const source = readFileSync(
      join(process.cwd(), "src/lib/revenue/community/community.functions.ts"),
      "utf8",
    );
    expect(source).toMatch(/\.rpc\(\s*"admin_revenue_events_summary",/);
    expect(source).toMatch(/\.rpc\(\s*"admin_revenue_clubs_summary",/);
  });

  it("limit okna = limit SQL (400 dni) = porównanie własne huba", () => {
    expect(COMMUNITY_MAX_WINDOW_DAYS).toBe(400);
    expect(COMMUNITY_MAX_WINDOW_DAYS).toBe(REVENUE_CUSTOM_COMPARE_MAX_DAYS);
  });
});

describe("wywołanie", () => {
  it("mapuje okno na p_since/p_until, bez najemcy; parsuje wynik", async () => {
    h.rpc.mockResolvedValueOnce({ data: EVENTS_RAW, error: null });
    const read = await getRevenueEventsSummary({ data: WINDOW });
    expect(h.rpc).toHaveBeenCalledWith("admin_revenue_events_summary", {
      p_since: WINDOW.sinceIso,
      p_until: WINDOW.untilIso,
    });
    expect(read).toMatchObject({
      state: "ready",
      summary: { moneyVisible: false, byCurrency: null },
    });

    h.rpc.mockResolvedValueOnce({ data: CLUBS_RAW, error: null });
    const clubs = await getRevenueClubsSummary({ data: WINDOW });
    expect(h.rpc).toHaveBeenLastCalledWith("admin_revenue_clubs_summary", {
      p_since: WINDOW.sinceIso,
      p_until: WINDOW.untilIso,
    });
    expect(clubs).toMatchObject({ state: "ready", summary: { decisionHoursMedian: null } });
  });

  it("42501 = forbidden, 42883/PGRST202 = unavailable, inny błąd = wyjątek", async () => {
    h.rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "forbidden" } });
    await expect(getRevenueEventsSummary({ data: WINDOW })).resolves.toEqual({
      state: "forbidden",
    });
    h.rpc.mockResolvedValueOnce({ data: null, error: { code: "PGRST202", message: "missing" } });
    await expect(getRevenueClubsSummary({ data: WINDOW })).resolves.toEqual({
      state: "unavailable",
    });
    h.rpc.mockResolvedValueOnce({ data: null, error: { code: "42883", message: "missing" } });
    await expect(getRevenueEventsSummary({ data: WINDOW })).resolves.toEqual({
      state: "unavailable",
    });
    h.rpc.mockResolvedValueOnce({ data: null, error: { code: "XX000", message: "boom" } });
    await expect(getRevenueEventsSummary({ data: WINDOW })).rejects.toThrow("boom");
  });

  it("okno odwrócone i dłuższe niż 400 dni odrzucone przed RPC", async () => {
    await expect(
      getRevenueEventsSummary({ data: { sinceIso: WINDOW.untilIso, untilIso: WINDOW.sinceIso } }),
    ).rejects.toThrow(/window_invalid/);
    await expect(
      getRevenueClubsSummary({
        data: { sinceIso: "2025-01-01T00:00:00.000Z", untilIso: "2026-10-01T00:00:00.000Z" },
      }),
    ).rejects.toThrow(/window_invalid/);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("zły kształt z bazy jest głośny (rozjazd kontraktu)", async () => {
    h.rpc.mockResolvedValueOnce({ data: { ...EVENTS_RAW, paid: "dużo" }, error: null });
    await expect(getRevenueEventsSummary({ data: WINDOW })).rejects.toThrow(/paid/);
  });
});
