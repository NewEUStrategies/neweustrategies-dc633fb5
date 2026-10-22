// Server fn lejka (S3, §5.2): obudowa, literał RPC, mapowanie parametrów
// i stany zamiast wyjątków.
//
// Czego pilnuje: najemca NIGDY nie idzie w parametrach (RPC bierze go z sesji),
// nazwa funkcji jest literałem w miejscu wywołania (bramka
// `generate:ts-sql-contract`), segment i tor z dziedziny kontraktu, odmowa
// roli (42501) wraca jako stan karty, a nie toast z ponowieniem.
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

import { FUNNEL_MAX_WINDOW_DAYS, getRevenueFunnel } from "@/lib/revenue/funnel/funnel.functions";

const WINDOW = {
  sinceIso: "2026-09-01T00:00:00.000Z",
  untilIso: "2026-10-01T00:00:00.000Z",
};

const RAW = {
  since: WINDOW.sinceIso,
  until: WINDOW.untilIso,
  segment: "all",
  track: "sales",
  amounts_visible: false,
  sales: { stages: [], open_tasks: 0, overdue_tasks: 0, done_tasks: 0 },
};

beforeEach(() => {
  h.rpc.mockReset();
  h.rpc.mockResolvedValue({ data: RAW, error: null });
  setServerFnContext({ supabase: { rpc: h.rpc }, userId: "user-1" });
});

afterEach(() => resetServerFnContext());

describe("obudowa", () => {
  it("POST za bramką sztabu CRM (admin/editor + aal2) - ta sama co bramka SQL", () => {
    expect(serverFnMeta(getRevenueFunnel)?.method).toBe("POST");
    expect(serverFnMeta(getRevenueFunnel)?.middleware).toEqual([{ __mw: "requireCrmStaff" }]);
    expect(serverFnMeta(getRevenueFunnel)?.hasValidator).toBe(true);
  });

  it("nazwa RPC jest literałem w miejscu wywołania", () => {
    const source = readFileSync(
      join(process.cwd(), "src/lib/revenue/funnel/funnel.functions.ts"),
      "utf8",
    );
    expect(source).toMatch(/\.rpc\(\s*"admin_revenue_funnel",/);
    expect(source).toContain("(context.supabase as unknown as RpcCallable)");
  });

  it("limit okna = REVENUE_CUSTOM_COMPARE_MAX_DAYS (ta sama granica co SQL)", () => {
    expect(FUNNEL_MAX_WINDOW_DAYS).toBe(REVENUE_CUSTOM_COMPARE_MAX_DAYS);
  });
});

describe("wywołanie RPC", () => {
  it("mapuje okno, segment i tor; NIE przekazuje najemcy", async () => {
    await getRevenueFunnel({ data: { ...WINDOW, segment: "b2c_reduced", track: "sales" } });

    expect(h.rpc).toHaveBeenCalledWith("admin_revenue_funnel", {
      p_since: WINDOW.sinceIso,
      p_until: WINDOW.untilIso,
      p_segment: "b2c_reduced",
      p_track: "sales",
    });
    const args = h.rpc.mock.calls[0]![1] as Record<string, unknown>;
    expect(Object.keys(args).some((k) => k.includes("tenant"))).toBe(false);
  });

  it("domyślnie segment all i oba tory", async () => {
    await getRevenueFunnel({ data: WINDOW });
    expect(h.rpc.mock.calls[0]![1]).toMatchObject({ p_segment: "all", p_track: "all" });
  });

  it("zwraca stan ready z DTO z parsera", async () => {
    const res = await getRevenueFunnel({ data: { ...WINDOW, track: "sales" } });
    expect(res.state).toBe("ready");
    if (res.state !== "ready") return;
    expect(res.funnel.selfServe).toBeNull();
    expect(res.funnel.amountsVisible).toBe(false);
  });

  it("odmowa roli (42501) to stan forbidden, nie wyjątek", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "forbidden", code: "42501" } });
    await expect(getRevenueFunnel({ data: WINDOW })).resolves.toEqual({ state: "forbidden" });
  });

  it.each(["PGRST202", "42883"])("brak funkcji w bazie (%s) to stan unavailable", async (code) => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "missing", code } });
    await expect(getRevenueFunnel({ data: WINDOW })).resolves.toEqual({ state: "unavailable" });
  });

  it("każdy inny błąd bazy leci w górę z komunikatem", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "window_invalid", code: "22023" } });
    await expect(getRevenueFunnel({ data: WINDOW })).rejects.toThrow("window_invalid");
  });

  it("zły kształt wyniku to błąd kontraktu, nie zera", async () => {
    h.rpc.mockResolvedValue({ data: { since: WINDOW.sinceIso }, error: null });
    await expect(getRevenueFunnel({ data: WINDOW })).rejects.toThrow(/admin_revenue_funnel/);
  });
});

describe("walidacja wejścia (przed zapytaniem)", () => {
  it.each([
    ["koniec przed początkiem", { sinceIso: WINDOW.untilIso, untilIso: WINDOW.sinceIso }],
    [
      "okno dłuższe niż 400 dni",
      { sinceIso: "2025-01-01T00:00:00.000Z", untilIso: "2026-10-01T00:00:00.000Z" },
    ],
    ["segment spoza dziedziny", { ...WINDOW, segment: "vip" }],
    ["tor spoza dziedziny", { ...WINDOW, track: "partners" }],
    ["nie-ISO", { sinceIso: "wczoraj", untilIso: WINDOW.untilIso }],
  ])("%s -> odrzucone bez wywołania RPC", async (_name, data) => {
    await expect(getRevenueFunnel({ data })).rejects.toThrow();
    expect(h.rpc).not.toHaveBeenCalled();
  });
});
