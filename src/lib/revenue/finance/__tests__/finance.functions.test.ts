// Server fns finansów huba (S2, §4.5): obudowa, literały RPC, mapowanie
// parametrów, stany zamiast wyjątków i walidacja przed zapytaniem.
//
// Czego pilnuje: najemca NIGDY nie idzie w parametrach (RPC bierze go
// z sesji), nazwy funkcji są literałami w miejscu wywołania (bramka
// `generate:ts-sql-contract`), odmowa roli (42501) i brak funkcji to stany
// karty, konflikt zapisu (40001) to stan formularza, a walidacja SQL (22023)
// wraca z kodem do etykiety.
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

import * as fns from "@/lib/revenue/finance/finance.functions";
import {
  FINANCE_MAX_WINDOW_DAYS,
  getRevenueChurn,
  getRevenueCohorts,
  getRevenueEconomics,
  getRevenueMrrBridge,
  getRevenueMrrSeries,
  getRevenueOfferMatrix,
  getRevenueRealized,
  monthSpan,
  saveRevenueInput,
} from "@/lib/revenue/finance/finance.functions";

const WINDOW = { sinceIso: "2026-09-01T00:00:00.000Z", untilIso: "2026-10-01T00:00:00.000Z" };

const BRIDGE = {
  since: "2026-09-01T00:00:00+00:00",
  until: "2026-10-01T00:00:00+00:00",
  segment: "all",
  data_since: null,
  basis_mix: null,
  currencies: [],
  active_subscriptions: 0,
  active_customers: 0,
};

const SOURCE = readFileSync(
  join(process.cwd(), "src/lib/revenue/finance/finance.functions.ts"),
  "utf8",
);

beforeEach(() => {
  h.rpc.mockReset();
  h.rpc.mockResolvedValue({ data: BRIDGE, error: null });
  setServerFnContext({ supabase: { rpc: h.rpc }, userId: "user-1" });
});

afterEach(() => resetServerFnContext());

describe("obudowa", () => {
  const all = Object.entries(fns).filter(([, v]) => serverFnMeta(v) !== undefined);

  it("11 funkcji, każda POST za bramką sztabu CRM", () => {
    expect(all.map(([name]) => name).sort()).toEqual([
      "getRevenueChurn",
      "getRevenueCohorts",
      "getRevenueDunning",
      "getRevenueEconomics",
      "getRevenueInputs",
      "getRevenueMrrBridge",
      "getRevenueMrrSeries",
      "getRevenueOfferMatrix",
      "getRevenueRealized",
      "getRevenueRetentionOffers",
      "saveRevenueInput",
    ]);
    for (const [name, fn] of all) {
      expect(serverFnMeta(fn)?.method, name).toBe("POST");
      expect(serverFnMeta(fn)?.middleware, name).toEqual([{ __mw: "requireCrmStaff" }]);
    }
  });

  it.each([
    "admin_revenue_mrr_bridge",
    "admin_revenue_mrr_series",
    "admin_revenue_churn",
    "admin_revenue_cohorts",
    "admin_revenue_dunning",
    "admin_revenue_realized",
    "admin_revenue_retention_offers",
    "admin_revenue_offer_matrix",
    "admin_revenue_inputs",
    "admin_revenue_input_upsert",
    "admin_revenue_economics",
  ])("nazwa %s jest literałem w miejscu wywołania", (name) => {
    expect(SOURCE).toMatch(new RegExp(`\\.rpc\\(\\s*"${name}",`));
  });

  it("limit okna = REVENUE_CUSTOM_COMPARE_MAX_DAYS (ta sama granica co SQL)", () => {
    expect(FINANCE_MAX_WINDOW_DAYS).toBe(REVENUE_CUSTOM_COMPARE_MAX_DAYS);
  });
});

describe("odczyty", () => {
  it("most: okno + segment, bez najemcy w parametrach", async () => {
    const res = await getRevenueMrrBridge({ data: { ...WINDOW, segment: "b2c_reduced" } });
    expect(res.state).toBe("ready");
    expect(h.rpc).toHaveBeenCalledWith("admin_revenue_mrr_bridge", {
      p_since: WINDOW.sinceIso,
      p_until: WINDOW.untilIso,
      p_segment: "b2c_reduced",
    });
    const args = h.rpc.mock.calls[0]![1] as Record<string, unknown>;
    expect(Object.keys(args).some((k) => k.includes("tenant") || k.includes("user"))).toBe(false);
  });

  it("most bez segmentu wysyła null (cały najemca)", async () => {
    await getRevenueMrrBridge({ data: WINDOW });
    expect(h.rpc.mock.calls[0]![1]).toMatchObject({ p_segment: null });
  });

  it("szereg dzienny dłuższy niż 120 dni odpada przed zapytaniem", async () => {
    await expect(
      getRevenueMrrSeries({
        data: {
          sinceIso: "2026-01-01T00:00:00.000Z",
          untilIso: "2026-06-01T00:00:00.000Z",
          grain: "day",
          timeZone: "Europe/Warsaw",
        },
      }),
    ).rejects.toThrow();
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("42501 -> forbidden, PGRST202/42883 -> unavailable, inne -> wyjątek", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "forbidden", code: "42501" } });
    await expect(getRevenueChurn({ data: WINDOW })).resolves.toEqual({ state: "forbidden" });
    h.rpc.mockResolvedValue({ data: null, error: { message: "x", code: "42883" } });
    await expect(getRevenueRealized({ data: WINDOW })).resolves.toEqual({ state: "unavailable" });
    h.rpc.mockResolvedValue({ data: null, error: { message: "boom", code: "XX000" } });
    await expect(getRevenueRealized({ data: WINDOW })).rejects.toThrow("boom");
  });

  it("zły kształt to błąd kontraktu z nazwą funkcji, nie zera", async () => {
    h.rpc.mockResolvedValue({ data: { since: WINDOW.sinceIso }, error: null });
    await expect(getRevenueMrrBridge({ data: WINDOW })).rejects.toThrow(/admin_revenue_mrr_bridge/);
  });

  it("kohorty i ekonomika: zakres miesięcy `YYYY-MM-01`, do 24 miesięcy", async () => {
    await expect(
      getRevenueCohorts({ data: { fromMonth: "2026-07-15", toMonth: "2026-09-01" } }),
    ).rejects.toThrow();
    await expect(
      getRevenueEconomics({ data: { fromMonth: "2024-01-01", toMonth: "2026-01-01" } }),
    ).rejects.toThrow();
    expect(h.rpc).not.toHaveBeenCalled();
    expect(monthSpan("2024-01-01", "2025-12-01")).toBe(23);
  });

  it("macierz oferty bez parametrów", async () => {
    h.rpc.mockResolvedValue({ data: { plans: [], tiers: [] }, error: null });
    await expect(getRevenueOfferMatrix()).resolves.toEqual({
      state: "ready",
      data: { plans: [], tiers: [] },
    });
    expect(h.rpc).toHaveBeenCalledWith("admin_revenue_offer_matrix", {});
  });
});

describe("zapis danej wejściowej", () => {
  const base = {
    periodMonth: "2026-09-01",
    kind: "mrr_plan" as const,
    segment: "all" as const,
    currency: "PLN",
    amountMinor: 500_000,
    ratio: null,
    note: null,
    expectedUpdatedAt: null,
  };

  it("mapuje pola na parametry RPC i oddaje wynik", async () => {
    h.rpc.mockResolvedValue({ data: { op: "delete", row: null }, error: null });
    await expect(saveRevenueInput({ data: base })).resolves.toEqual({
      state: "saved",
      result: { op: "delete", row: null },
    });
    expect(h.rpc).toHaveBeenCalledWith("admin_revenue_input_upsert", {
      p_period_month: "2026-09-01",
      p_kind: "mrr_plan",
      p_segment: "all",
      p_currency: "PLN",
      p_amount_minor: 500_000,
      p_ratio: null,
      p_note: null,
      p_expected_updated_at: null,
    });
  });

  it("40001 -> conflict, 22023 z kodem znanym -> invalid", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "stale_write", code: "40001" } });
    await expect(saveRevenueInput({ data: base })).resolves.toEqual({ state: "conflict" });
    h.rpc.mockResolvedValue({ data: null, error: { message: "value_invalid", code: "22023" } });
    await expect(saveRevenueInput({ data: base })).resolves.toEqual({
      state: "invalid",
      code: "value_invalid",
    });
  });

  it("marża bez waluty i kwoty; kwota z walutą - inaczej odrzucone przed RPC", async () => {
    await expect(
      saveRevenueInput({ data: { ...base, kind: "gross_margin_pct", ratio: 0.6 } }),
    ).rejects.toThrow();
    await expect(saveRevenueInput({ data: { ...base, currency: null } })).rejects.toThrow();
    await expect(saveRevenueInput({ data: { ...base, ratio: 1.5 } })).rejects.toThrow();
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("notatka: limit liczony po obcięciu spacji (jak `btrim` w SQL), nigdy przycinana", async () => {
    h.rpc.mockResolvedValue({ data: { op: "noop", row: null }, error: null });
    const note = `${"a".repeat(500)}   `;
    await saveRevenueInput({ data: { ...base, note } });
    expect(h.rpc.mock.calls[0]![1]).toMatchObject({ p_note: note });
    await expect(saveRevenueInput({ data: { ...base, note: "a".repeat(501) } })).rejects.toThrow();
  });
});
