// NAPRAWA ZBIORCZA ZADAŃ BEZ OSOBY (P24, hub S4).
//
// Pilnuje: zadania bez osoby trafiają do właściciela leada, reszta do
// wskazanej osoby z zespołu najemcy (osoba spoza zespołu = odmowa), zapis
// nie nadpisuje zadań przypisanych w międzyczasie (`is(assignee_id, null)`),
// a wynik mówi, ile zostało bez osoby.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ok, supabaseFromStub } from "@/test/supabaseChain";
import {
  callServerFn,
  type ServerFnContext,
  serverFnMiddlewareNames,
} from "@/test/serverFnHarness";

vi.mock("@tanstack/react-start", async () => {
  const { serverFnStubModule } = await import("@/test/serverFnHarness");
  return serverFnStubModule();
});
vi.mock("@/integrations/supabase/require-staff", () => ({
  requireCrmStaff: { name: "requireCrmStaff" },
  requireStaff: { name: "requireStaff" },
}));

const h = vi.hoisted(() => ({ adminFrom: null as ((table: string) => unknown) | null }));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: (table: string) => h.adminFrom?.(table) },
}));

import * as tasks from "@/lib/crm-tasks.functions";

const USER_ID = "44444444-4444-4444-8444-444444444444";
const OWNER_A = "55555555-5555-4555-8555-555555555555";
const FALLBACK = "66666666-6666-4666-8666-666666666666";
const TENANT = "33333333-3333-4333-8333-333333333333";

const db = supabaseFromStub();
const admin = supabaseFromStub();

function context(): ServerFnContext {
  return { supabase: { from: db.from, rpc: async () => ok(null) }, userId: USER_ID };
}

const UNASSIGNED = [
  { id: "t1", lead: { owner_id: OWNER_A } },
  { id: "t2", lead: { owner_id: OWNER_A } },
  { id: "t3", lead: { owner_id: null } },
  { id: "t4", lead: null },
];

beforeEach(() => {
  db.reset();
  admin.reset();
  h.adminFrom = admin.from;
  db.setResponse("crm_tasks", (chain) => ok(chain.has("update") ? null : UNASSIGNED));
  db.setResponse("profiles", () => ok({ tenant_id: TENANT }));
});

describe("planUnassignedTaskFix", () => {
  it("dzieli zadania po właścicielu leada; bez właściciela = pula do osoby zapasowej", () => {
    const plan = tasks.planUnassignedTaskFix(UNASSIGNED);
    expect([...plan.byOwner.entries()]).toEqual([[OWNER_A, ["t1", "t2"]]]);
    expect(plan.orphans).toEqual(["t3", "t4"]);
  });
});

describe("assignUnassignedCrmTasks", () => {
  it("bez osoby zapasowej: właściciel leada, reszta zostaje policzona", async () => {
    const result = await callServerFn(tasks.assignUnassignedCrmTasks, {
      data: {},
      context: context(),
    });
    expect(result).toEqual({ assigned_to_owner: 2, assigned_to_fallback: 0, remaining: 2 });
    const read = db.chainsFor("crm_tasks").find((c) => !c.has("update"));
    expect(read?.argsOf("eq")).toEqual(["status", "open"]);
    expect(read?.argsOf("is")).toEqual(["assignee_id", null]);
    const update = db.chainsFor("crm_tasks").find((c) => c.has("update"));
    expect(update?.argsOf("update")).toEqual([{ assignee_id: OWNER_A }]);
    expect(update?.argsOf("in")).toEqual(["id", ["t1", "t2"]]);
    // Zapis nie nadpisze zadania przypisanego ręcznie w międzyczasie.
    expect(update?.argsOf("is")).toEqual(["assignee_id", null]);
  });

  it("osoba zapasowa z zespołu najemcy dostaje zadania leadów bez właściciela", async () => {
    admin.setResponse("user_roles", () => ok([{ user_id: FALLBACK }]));
    const result = await callServerFn(tasks.assignUnassignedCrmTasks, {
      data: { fallback_assignee_id: FALLBACK },
      context: context(),
    });
    expect(result).toEqual({ assigned_to_owner: 2, assigned_to_fallback: 2, remaining: 0 });
    const roles = admin.lastChain("user_roles");
    expect(roles?.calls.filter((c) => c.method === "eq").map((c) => c.args)).toEqual([
      ["tenant_id", TENANT],
      ["user_id", FALLBACK],
    ]);
    const updates = db.chainsFor("crm_tasks").filter((c) => c.has("update"));
    expect(updates.map((c) => c.argsOf("update")?.[0])).toEqual([
      { assignee_id: OWNER_A },
      { assignee_id: FALLBACK },
    ]);
  });

  it("osoba spoza zespołu najemcy: odmowa, nic nie zapisane", async () => {
    admin.setResponse("user_roles", () => ok([]));
    await expect(
      callServerFn(tasks.assignUnassignedCrmTasks, {
        data: { fallback_assignee_id: FALLBACK },
        context: context(),
      }),
    ).rejects.toThrow("assignee_not_staff");
    expect(db.chainsFor("crm_tasks").filter((c) => c.has("update"))).toHaveLength(0);
  });

  it("za bramką sztabu CRM", () => {
    expect(serverFnMiddlewareNames(tasks.assignUnassignedCrmTasks)).toContain("requireCrmStaff");
  });
});
