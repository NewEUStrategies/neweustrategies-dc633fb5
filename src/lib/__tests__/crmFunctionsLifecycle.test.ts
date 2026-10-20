// CYKL ŻYCIA I HISTORIA ETAPÓW W WARSTWIE SERWEROWEJ CRM (hub S4).
//
// Pilnuje: etap cyklu życia idzie WYŁĄCZNIE przez RPC
// `admin_crm_set_lifecycle_stage` (literał - bramka kontraktu TS <-> SQL),
// bez najemcy w parametrach; etapów klienta panel nie wysyła (należą do
// billingu); kody RPC mapują się na czytelne błędy; historia etapów czyta
// tabelę pod RLS w porządku od najnowszych. Autoryzację i precedencję
// pisarzy sprawdza pgTAP (`crm_lifecycle_history_test.sql`).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ok, fail, supabaseFromStub, type SupabaseResult } from "@/test/supabaseChain";
import {
  callServerFn,
  type ServerFnContext,
  serverFnMiddlewareNames,
  validateServerFnInput,
} from "@/test/serverFnHarness";

vi.mock("@tanstack/react-start", async () => {
  const { serverFnStubModule } = await import("@/test/serverFnHarness");
  return serverFnStubModule();
});
vi.mock("@/integrations/supabase/require-staff", () => ({
  requireCrmStaff: { name: "requireCrmStaff" },
  requireStaff: { name: "requireStaff" },
}));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));
vi.mock("@/lib/integrations/dispatch.functions", () => ({
  runIntegrationDispatch: async () => ({ delivered: 0, failed: 0 }),
}));

import * as crm from "@/lib/crm.functions";
import { MANUAL_LIFECYCLE_STAGES } from "@/lib/crm/leadListSpec";

const LEAD_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "44444444-4444-4444-8444-444444444444";

const db = supabaseFromStub();
let rpcCalls: Array<{ fn: string; args: unknown }> = [];
let rpcResults: Record<
  string,
  SupabaseResult | { data: null; error: { code: string; message: string } }
> = {};

function context(): ServerFnContext {
  return {
    supabase: {
      from: db.from,
      rpc: async (fn: string, args?: unknown) => {
        rpcCalls.push({ fn, args });
        return rpcResults[fn] ?? ok(null);
      },
    },
    userId: USER_ID,
    claims: { sub: USER_ID, aal: "aal1" },
  };
}

beforeEach(() => {
  db.reset();
  rpcCalls = [];
  rpcResults = {};
});

describe("setLeadLifecycleStage", () => {
  it("woła RPC panelu z leadem i etapem - bez najemcy i bez źródła z klienta", async () => {
    rpcResults.admin_crm_set_lifecycle_stage = ok({
      changed: true,
      skipped: null,
      lead_id: LEAD_ID,
      from: "lead",
      to: "mql",
      source: "manual",
    });
    const result = await callServerFn(crm.setLeadLifecycleStage, {
      data: { id: LEAD_ID, stage: "mql" },
      context: context(),
    });
    expect(rpcCalls).toEqual([
      { fn: "admin_crm_set_lifecycle_stage", args: { p_lead_id: LEAD_ID, p_stage: "mql" } },
    ]);
    expect(result).toEqual({ changed: true, from: "lead", to: "mql", skipped: null });
  });

  it("pominięcie przez pierwszeństwo wraca jako wynik, nie wyjątek", async () => {
    rpcResults.admin_crm_set_lifecycle_stage = ok({
      changed: false,
      skipped: "precedence",
      from: "customer",
      to: "lead",
    });
    await expect(
      callServerFn(crm.setLeadLifecycleStage, {
        data: { id: LEAD_ID, stage: "lead" },
        context: context(),
      }),
    ).resolves.toMatchObject({ changed: false, skipped: "precedence" });
  });

  it("etapy klienta nie przechodzą walidacji (należą do billingu)", () => {
    for (const stage of ["customer", "former_customer", "vip"]) {
      expect(() =>
        validateServerFnInput(crm.setLeadLifecycleStage, { id: LEAD_ID, stage }),
      ).toThrow();
    }
    expect(MANUAL_LIFECYCLE_STAGES).not.toContain("customer");
    expect(MANUAL_LIFECYCLE_STAGES).toContain("opportunity");
  });

  it("kody RPC: P0002 = lead_not_found, 42501 = forbidden, reszta z komunikatem", async () => {
    const call = () =>
      callServerFn(crm.setLeadLifecycleStage, {
        data: { id: LEAD_ID, stage: "sql" },
        context: context(),
      });
    rpcResults.admin_crm_set_lifecycle_stage = {
      data: null,
      error: { code: "P0002", message: "lead_not_found" },
    };
    await expect(call()).rejects.toThrow("lead_not_found");
    rpcResults.admin_crm_set_lifecycle_stage = {
      data: null,
      error: { code: "42501", message: "nope" },
    };
    await expect(call()).rejects.toThrow("forbidden");
    rpcResults.admin_crm_set_lifecycle_stage = fail("boom");
    await expect(call()).rejects.toThrow("boom");
  });

  it("nazwa RPC jest literałem w miejscu wywołania", () => {
    const source = readFileSync(join(process.cwd(), "src/lib/crm.functions.ts"), "utf8");
    expect(source).toMatch(/\.rpc\(\s*"admin_crm_set_lifecycle_stage",/);
  });
});

describe("getCrmLeadStageHistory", () => {
  it("czyta historię leada od najnowszej, z limitem", async () => {
    const rows = [
      { id: 2, dimension: "lifecycle", from_value: "lead", to_value: "mql", source: "workflow" },
      { id: 1, dimension: "crm_stage", from_value: "new", to_value: "contacted", source: "manual" },
    ];
    db.setResponse("crm_lead_stage_history", () => ok(rows));
    const result = await callServerFn(crm.getCrmLeadStageHistory, {
      data: { id: LEAD_ID },
      context: context(),
    });
    expect(JSON.parse((result as { json: string }).json)).toEqual(rows);
    const chain = db.lastChain("crm_lead_stage_history");
    expect(chain?.argsOf("eq")).toEqual(["lead_id", LEAD_ID]);
    expect(chain?.calls.filter((c) => c.method === "order").map((c) => c.args)).toEqual([
      ["changed_at", { ascending: false }],
      ["id", { ascending: false }],
    ]);
    expect(chain?.argsOf("limit")).toEqual([100]);
  });

  it("błąd odczytu wychodzi na zewnątrz (nie pusta historia)", async () => {
    db.setResponse("crm_lead_stage_history", () => fail("permission denied"));
    await expect(
      callServerFn(crm.getCrmLeadStageHistory, { data: { id: LEAD_ID }, context: context() }),
    ).rejects.toThrow("permission denied");
  });

  it("obie funkcje za bramką sztabu CRM", () => {
    expect(serverFnMiddlewareNames(crm.setLeadLifecycleStage)).toContain("requireCrmStaff");
    expect(serverFnMiddlewareNames(crm.getCrmLeadStageHistory)).toContain("requireCrmStaff");
  });
});
