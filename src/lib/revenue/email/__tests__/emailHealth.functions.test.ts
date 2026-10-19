// Server fn zdrowia e-mail (S1, §4.5): obudowa, literał RPC, mapowanie
// parametrów i stany zamiast wyjątków.
//
// Czego pilnuje: najemca NIGDY nie idzie w parametrach (RPC bierze go z sesji),
// nazwa funkcji jest literałem w miejscu wywołania (bramka
// `generate:ts-sql-contract` czyta ją ze źródła), odmowa roli (42501) wraca
// jako stan karty, a nie toast z ponowieniem.
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
  EMAIL_HEALTH_MAX_WINDOW_DAYS,
  getRevenueEmailHealth,
} from "@/lib/revenue/email/emailHealth.functions";

const WINDOW = {
  sinceIso: "2026-09-01T00:00:00.000Z",
  untilIso: "2026-10-01T00:00:00.000Z",
};

const RAW = {
  since: "2026-09-01T00:00:00+00:00",
  until: "2026-10-01T00:00:00+00:00",
  campaigns: {
    sent: 6,
    delivered: null,
    unique_opens: 3,
    unique_clicks: 2,
    hard_bounces: null,
    soft_bounces: null,
    complaints: null,
    unsubscribes: 1,
  },
  list: { start: 2, end: 4, new: 3, unsubscribed: 1, net_growth: 2 },
  doi: { started: 0, confirmed_7d: null },
};

beforeEach(() => {
  h.rpc.mockReset();
  h.rpc.mockResolvedValue({ data: RAW, error: null });
  setServerFnContext({ supabase: { rpc: h.rpc }, userId: "user-1" });
});

afterEach(() => resetServerFnContext());

describe("obudowa", () => {
  it("POST za bramką sztabu CRM (admin/editor) - ta sama co bramka SQL", () => {
    expect(serverFnMeta(getRevenueEmailHealth)?.method).toBe("POST");
    expect(serverFnMeta(getRevenueEmailHealth)?.middleware).toEqual([{ __mw: "requireCrmStaff" }]);
    expect(serverFnMeta(getRevenueEmailHealth)?.hasValidator).toBe(true);
  });

  it("nazwa RPC jest literałem w miejscu wywołania (bramka kontraktu TS <-> SQL)", () => {
    const source = readFileSync(
      join(process.cwd(), "src/lib/revenue/email/emailHealth.functions.ts"),
      "utf8",
    );
    expect(source).toMatch(/\.rpc\(\s*"admin_revenue_email_health",/);
    expect(source).toContain("(context.supabase as unknown as RpcCallable)");
  });

  it("limit okna = REVENUE_CUSTOM_COMPARE_MAX_DAYS (ta sama granica co SQL)", () => {
    expect(EMAIL_HEALTH_MAX_WINDOW_DAYS).toBe(REVENUE_CUSTOM_COMPARE_MAX_DAYS);
  });
});

describe("wywołanie RPC", () => {
  it("mapuje okno na p_since/p_until i NIE przekazuje najemcy", async () => {
    await getRevenueEmailHealth({ data: WINDOW });

    expect(h.rpc).toHaveBeenCalledTimes(1);
    expect(h.rpc).toHaveBeenCalledWith("admin_revenue_email_health", {
      p_since: WINDOW.sinceIso,
      p_until: WINDOW.untilIso,
    });
    const args = h.rpc.mock.calls[0]![1] as Record<string, unknown>;
    expect(Object.keys(args).some((k) => k.includes("tenant"))).toBe(false);
  });

  it("zwraca stan ready z DTO z parsera (null zostaje null)", async () => {
    const res = await getRevenueEmailHealth({ data: WINDOW });

    expect(res.state).toBe("ready");
    if (res.state !== "ready") return;
    expect(res.health.campaigns.sent).toBe(6);
    expect(res.health.campaigns.delivered).toBeNull();
    expect(res.health.list.netGrowth).toBe(2);
    expect(res.health.doi.confirmed7d).toBeNull();
  });

  it("odmowa roli (42501) to stan forbidden, nie wyjątek", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "forbidden", code: "42501" } });

    await expect(getRevenueEmailHealth({ data: WINDOW })).resolves.toEqual({ state: "forbidden" });
  });

  it("brak funkcji w bazie (okno wdrożenia) to stan unavailable", async () => {
    h.rpc.mockResolvedValue({
      data: null,
      error: { message: "Could not find the function", code: "PGRST202" },
    });

    await expect(getRevenueEmailHealth({ data: WINDOW })).resolves.toEqual({
      state: "unavailable",
    });
  });

  it("każdy inny błąd bazy leci w górę z komunikatem", async () => {
    h.rpc.mockResolvedValue({
      data: null,
      error: { message: "window_invalid", code: "22023" },
    });

    await expect(getRevenueEmailHealth({ data: WINDOW })).rejects.toThrow("window_invalid");
  });

  it("zły kształt wyniku to błąd kontraktu, nie zera", async () => {
    h.rpc.mockResolvedValue({ data: { since: WINDOW.sinceIso }, error: null });

    await expect(getRevenueEmailHealth({ data: WINDOW })).rejects.toThrow(
      /admin_revenue_email_health/,
    );
  });
});

describe("walidacja okna (przed zapytaniem)", () => {
  it.each([
    ["koniec przed początkiem", { sinceIso: WINDOW.untilIso, untilIso: WINDOW.sinceIso }],
    ["okno zerowe", { sinceIso: WINDOW.sinceIso, untilIso: WINDOW.sinceIso }],
    [
      "okno dłuższe niż 400 dni",
      { sinceIso: "2025-01-01T00:00:00.000Z", untilIso: "2026-10-01T00:00:00.000Z" },
    ],
    ["nie-ISO", { sinceIso: "wczoraj", untilIso: WINDOW.untilIso }],
    ["brak granicy", { sinceIso: WINDOW.sinceIso }],
  ])("%s -> odrzucone bez wywołania RPC", async (_name, data) => {
    await expect(getRevenueEmailHealth({ data })).rejects.toThrow();
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("okno dokładnie 400 dni jest dozwolone, przesunięcie strefy też", async () => {
    await getRevenueEmailHealth({
      data: { sinceIso: "2025-08-27T00:00:00+02:00", untilIso: "2026-10-01T00:00:00+02:00" },
    });
    expect(h.rpc).toHaveBeenCalledTimes(1);
  });
});
