// Server fn inwentarza dostępu (S3): obudowa, literał RPC bez parametrów
// (najemca z sesji) i stany zamiast wyjątków.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetServerFnContext, serverFnMeta, setServerFnContext } from "@/test/serverFn";

const h = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@tanstack/react-start", async () =>
  (await import("@/test/serverFn")).serverFnModuleMock(),
);
vi.mock("@/integrations/supabase/require-staff", () => ({
  requireCrmStaff: { __mw: "requireCrmStaff" },
}));

import { getRevenueAccessInventory } from "@/lib/revenue/access/access.functions";

const RAW = {
  computed_at: "2026-10-19T12:00:00+00:00",
  total: 0,
  rows: [],
  by_mode: { public: 0, members: 0, paid: 0, password: 0 },
  tiers: [],
  dead_ends: {
    tier_without_offer: 0,
    paid_without_offer: 0,
    dangling_plans: 0,
    metered_tier_gated: 0,
  },
  hits_30d: [],
};

beforeEach(() => {
  h.rpc.mockReset();
  h.rpc.mockResolvedValue({ data: RAW, error: null });
  setServerFnContext({ supabase: { rpc: h.rpc }, userId: "user-1" });
});

afterEach(() => resetServerFnContext());

describe("getRevenueAccessInventory", () => {
  it("POST za bramką sztabu CRM, bez walidatora (brak wejścia)", () => {
    expect(serverFnMeta(getRevenueAccessInventory)?.method).toBe("POST");
    expect(serverFnMeta(getRevenueAccessInventory)?.middleware).toEqual([
      { __mw: "requireCrmStaff" },
    ]);
  });

  it("literał RPC i żadnych parametrów (najemca z sesji)", async () => {
    const source = readFileSync(
      join(process.cwd(), "src/lib/revenue/access/access.functions.ts"),
      "utf8",
    );
    expect(source).toMatch(/\.rpc\(\s*"admin_revenue_access_inventory",?\s*\)/);
    await getRevenueAccessInventory();
    expect(h.rpc).toHaveBeenCalledWith("admin_revenue_access_inventory");
  });

  it("ready z DTO; 42501 = forbidden; brak funkcji = unavailable; inny błąd rzuca", async () => {
    await expect(getRevenueAccessInventory()).resolves.toMatchObject({ state: "ready" });
    h.rpc.mockResolvedValue({ data: null, error: { message: "no", code: "42501" } });
    await expect(getRevenueAccessInventory()).resolves.toEqual({ state: "forbidden" });
    h.rpc.mockResolvedValue({ data: null, error: { message: "missing", code: "PGRST202" } });
    await expect(getRevenueAccessInventory()).resolves.toEqual({ state: "unavailable" });
    h.rpc.mockResolvedValue({ data: null, error: { message: "boom", code: "XX000" } });
    await expect(getRevenueAccessInventory()).rejects.toThrow("boom");
  });
});
