// WARSTWA SERWEROWA ZADAŃ CRM I IMPORTU (lib/crm-tasks.functions.ts) - 0 z 17 fn.
//
// Najważniejsza reguła tego pliku to `parseImportSummary`: podsumowanie importu
// przychodzi z RPC jako `jsonb`, a panel pokazuje z niego liczby użytkownikowi.
// Wynik nie-obiekt / brakujące pola / śmieci w liście błędów NIE MOGĄ zamienić
// się w „NaN zaimportowanych" ani wywrócić dialogu.
//
// Autoryzacja: pgTAP (crm_tasks_followups_test.sql). Tutaj kształt i ścieżki.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ok, fail, supabaseFromStub, type SupabaseResult } from "@/test/supabaseChain";
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

import * as tasks from "@/lib/crm-tasks.functions";

const LEAD_ID = "11111111-1111-4111-8111-111111111111";
const TASK_ID = "22222222-2222-4222-8222-222222222222";
const TENANT = "33333333-3333-4333-8333-333333333333";
const USER_ID = "44444444-4444-4444-8444-444444444444";
const ASSIGNEE = "55555555-5555-4555-8555-555555555555";

const db = supabaseFromStub();
let rpcCalls: Array<{ fn: string; args: unknown }> = [];
let rpcResults: Record<string, SupabaseResult> = {};

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
    claims: { tenant_id: TENANT },
  };
}

const parsed = (result: unknown): unknown => JSON.parse((result as { json: string }).json);

beforeEach(() => {
  db.reset();
  rpcCalls = [];
  rpcResults = {};
});

describe("lista zadań kontaktu", () => {
  it("czyta zadania jednego leada, otwarte przed zamkniętymi", async () => {
    db.setResponse("crm_tasks", () => ok([{ id: TASK_ID, status: "open" }]));
    const result = await callServerFn(tasks.listCrmLeadTasks, {
      data: { lead_id: LEAD_ID },
      context: context(),
    });
    expect(parsed(result)).toEqual([{ id: TASK_ID, status: "open" }]);
    const chain = db.lastChain("crm_tasks");
    expect(chain?.argsOf("eq")).toEqual(["lead_id", LEAD_ID]);
    expect(chain?.calls.filter((c) => c.method === "order").map((c) => c.args[0])).toEqual([
      "status",
      "due_at",
    ]);
  });

  it("błąd odczytu wychodzi na zewnątrz", async () => {
    db.setResponse("crm_tasks", () => fail("boom"));
    await expect(
      callServerFn(tasks.listCrmLeadTasks, { data: { lead_id: LEAD_ID }, context: context() }),
    ).rejects.toThrow("boom");
  });
});

describe("lista follow-upów do zrobienia", () => {
  it("bierze otwarte zadania w oknie godzinowym, z wizytówką leada", async () => {
    db.setResponse("crm_tasks", () => ok([{ id: TASK_ID, lead: { id: LEAD_ID } }]));
    await callServerFn(tasks.listCrmDueTasks, {
      data: { limit: 5, horizon_hours: 24 },
      context: context(),
    });
    const chain = db.lastChain("crm_tasks");
    expect(chain?.argsOf("eq")).toEqual(["status", "open"]);
    expect(chain?.argsOf("limit")).toEqual([5]);
    // Horyzont liczony od teraz - sprawdzamy, że to data w przyszłości.
    const horizon = String(chain?.argsOf("lte")?.[1]);
    expect(Date.parse(horizon)).toBeGreaterThan(Date.now());
    expect(String(chain?.argsOf("select")?.[0])).toContain("lead:crm_leads");
  });

  it("brak wejścia korzysta z wartości domyślnych (panel woła bez argumentów)", async () => {
    db.setResponse("crm_tasks", () => ok([]));
    await callServerFn(tasks.listCrmDueTasks, { data: undefined, context: context() });
    expect(db.lastChain("crm_tasks")?.argsOf("limit")).toEqual([10]);
  });

  it("błąd odczytu wychodzi na zewnątrz", async () => {
    db.setResponse("crm_tasks", () => fail("boom"));
    await expect(
      callServerFn(tasks.listCrmDueTasks, { data: {}, context: context() }),
    ).rejects.toThrow("boom");
  });
});

describe("tworzenie zadania", () => {
  const input = {
    lead_id: LEAD_ID,
    title: "Zadzwonić",
    due_at: "2026-08-20T09:00:00.000Z",
  };

  it("zadanie dziedziczy tenanta leada, nie tenanta z sesji", async () => {
    db.setResponse("crm_leads", () => ok({ tenant_id: "tenant-leada" }));
    db.setResponse("crm_tasks", () => ok(null));
    await callServerFn(tasks.createCrmTask, { data: input, context: context() });
    expect(db.lastChain("crm_tasks")?.argsOf("insert")?.[0]).toMatchObject({
      tenant_id: "tenant-leada",
      lead_id: LEAD_ID,
      title: "Zadzwonić",
      note: null,
      assignee_id: USER_ID,
      created_by: USER_ID,
    });
  });

  it("jawne przypisanie wygrywa nad domyślnym autorem", async () => {
    db.setResponse("crm_leads", () => ok({ tenant_id: TENANT }));
    db.setResponse("crm_tasks", () => ok(null));
    await callServerFn(tasks.createCrmTask, {
      data: { ...input, assignee_id: ASSIGNEE, note: "Umówione na 10:00" },
      context: context(),
    });
    expect(db.lastChain("crm_tasks")?.argsOf("insert")?.[0]).toMatchObject({
      assignee_id: ASSIGNEE,
      note: "Umówione na 10:00",
    });
  });

  it("nieznany lead przerywa tworzenie zadania", async () => {
    db.setResponse("crm_leads", () => ok(null));
    await expect(
      callServerFn(tasks.createCrmTask, { data: input, context: context() }),
    ).rejects.toThrow("lead_not_found");
  });

  it("błąd zapisu wychodzi na zewnątrz", async () => {
    db.setResponse("crm_leads", () => ok({ tenant_id: TENANT }));
    db.setResponse("crm_tasks", () => fail("insert failed"));
    await expect(
      callServerFn(tasks.createCrmTask, { data: input, context: context() }),
    ).rejects.toThrow("insert failed");
  });

  it("klucz idempotencji zapisuje zadanie tylko raz", async () => {
    db.setResponse("crm_leads", () => ok({ tenant_id: TENANT }));
    db.setResponse("crm_tasks", () => ok(null));
    rpcResults.claim_command = ok({ claimed: true, status: "claimed" });
    rpcResults.complete_command = ok(null);
    await callServerFn(tasks.createCrmTask, {
      data: { ...input, idempotency_key: "crm-task-0001" },
      context: context(),
    });
    expect(rpcCalls.map((c) => c.fn)).toEqual(["claim_command", "complete_command"]);
    expect(db.chainsFor("crm_tasks").filter((c) => c.has("insert"))).toHaveLength(1);
  });

  it("powtórka z tym samym kluczem oddaje zapamiętany wynik bez zapisu", async () => {
    db.setResponse("crm_leads", () => ok({ tenant_id: TENANT }));
    rpcResults.claim_command = ok({ claimed: false, status: "succeeded", result: { ok: true } });
    const result = await callServerFn(tasks.createCrmTask, {
      data: { ...input, idempotency_key: "crm-task-0001" },
      context: context(),
    });
    expect(result).toEqual({ ok: true });
    expect(db.chainsFor("crm_tasks")).toHaveLength(0);
  });

  it("pusty tytuł nie przechodzi walidacji", async () => {
    await expect(
      callServerFn(tasks.createCrmTask, { data: { ...input, title: "  " }, context: context() }),
    ).rejects.toThrow();
  });

  it("termin musi być datą ISO", async () => {
    await expect(
      callServerFn(tasks.createCrmTask, {
        data: { ...input, due_at: "jutro" },
        context: context(),
      }),
    ).rejects.toThrow();
  });
});

describe("aktualizacja i usunięcie zadania", () => {
  it("patch idzie bez identyfikatora w treści zapisu", async () => {
    db.setResponse("crm_tasks", () => ok(null));
    await callServerFn(tasks.updateCrmTask, {
      data: { id: TASK_ID, status: "done" },
      context: context(),
    });
    expect(db.lastChain("crm_tasks")?.argsOf("update")).toEqual([{ status: "done" }]);
    expect(db.lastChain("crm_tasks")?.argsOf("eq")).toEqual(["id", TASK_ID]);
  });

  it("nieznany status nie przechodzi walidacji", async () => {
    await expect(
      callServerFn(tasks.updateCrmTask, {
        data: { id: TASK_ID, status: "wykonane" },
        context: context(),
      }),
    ).rejects.toThrow();
  });

  it("błąd aktualizacji wychodzi na zewnątrz", async () => {
    db.setResponse("crm_tasks", () => fail("update failed"));
    await expect(
      callServerFn(tasks.updateCrmTask, {
        data: { id: TASK_ID, status: "done" },
        context: context(),
      }),
    ).rejects.toThrow("update failed");
  });

  it("usunięcie idzie po identyfikatorze", async () => {
    db.setResponse("crm_tasks", () => ok(null));
    await callServerFn(tasks.deleteCrmTask, { data: { id: TASK_ID }, context: context() });
    expect(db.lastChain("crm_tasks")?.has("delete")).toBe(true);
  });

  it("błąd usunięcia wychodzi na zewnątrz", async () => {
    db.setResponse("crm_tasks", () => fail("delete failed"));
    await expect(
      callServerFn(tasks.deleteCrmTask, { data: { id: TASK_ID }, context: context() }),
    ).rejects.toThrow("delete failed");
  });
});

describe("import leadów (podsumowanie z RPC)", () => {
  const rows = [{ email: "anna@example.test" }];

  it("cała porcja idzie jednym wywołaniem RPC", async () => {
    rpcResults.crm_import_leads = ok({ imported: 1, merged: 0, skipped: 0, errors: [] });
    const result = await callServerFn(tasks.importCrmLeads, {
      data: { rows, source: "import" },
      context: context(),
    });
    expect(rpcCalls[0]).toEqual({
      fn: "crm_import_leads",
      args: { p_rows: rows, p_source: "import" },
    });
    expect(result).toEqual({ imported: 1, merged: 0, skipped: 0, errors: [] });
  });

  it("źródło ma wartość domyślną, gdy klient go nie poda", async () => {
    rpcResults.crm_import_leads = ok({});
    await callServerFn(tasks.importCrmLeads, { data: { rows }, context: context() });
    expect((rpcCalls[0].args as { p_source: string }).p_source).toBe("import");
  });

  it("wynik nie-obiekt nie zamienia się w NaN w panelu", async () => {
    rpcResults.crm_import_leads = ok("nonsens");
    const result = await callServerFn(tasks.importCrmLeads, { data: { rows }, context: context() });
    expect(result).toEqual({ imported: 0, merged: 0, skipped: 0, errors: [] });
  });

  it("brakujące i nieliczbowe pola liczą się jako zero", async () => {
    rpcResults.crm_import_leads = ok({ imported: "5", merged: Number.NaN, skipped: 3 });
    const result = await callServerFn(tasks.importCrmLeads, { data: { rows }, context: context() });
    expect(result).toMatchObject({ imported: 0, merged: 0, skipped: 3 });
  });

  it("lista błędów odsiewa śmieci i domyka brakujące pola", async () => {
    rpcResults.crm_import_leads = ok({
      errors: [
        null,
        "tekst",
        { email: "zly@example.test", reason: "invalid_email" },
        { email: 42 },
      ],
    });
    const result = await callServerFn<{ errors: Array<{ email: string; reason: string }> }>(
      tasks.importCrmLeads,
      { data: { rows }, context: context() },
    );
    expect(result.errors).toEqual([
      { email: "zly@example.test", reason: "invalid_email" },
      { email: "", reason: "unknown" },
    ]);
  });

  it("błąd RPC importu wychodzi na zewnątrz", async () => {
    rpcResults.crm_import_leads = fail("too_many_rows_max_500");
    await expect(
      callServerFn(tasks.importCrmLeads, { data: { rows }, context: context() }),
    ).rejects.toThrow("too_many_rows_max_500");
  });

  it("porcja większa niż limit nie przechodzi walidacji po stronie klienta", async () => {
    const many = Array.from({ length: tasks.CRM_IMPORT_CHUNK_SIZE + 1 }, (_, i) => ({
      email: `lead${i}@example.test`,
    }));
    await expect(
      callServerFn(tasks.importCrmLeads, { data: { rows: many }, context: context() }),
    ).rejects.toThrow();
  });

  it("pusta porcja nie przechodzi walidacji", async () => {
    await expect(
      callServerFn(tasks.importCrmLeads, { data: { rows: [] }, context: context() }),
    ).rejects.toThrow();
  });
});

describe("bramka uprawnień - test strukturalny", () => {
  it("każda serwerowa funkcja zadań deklaruje requireCrmStaff", () => {
    const fns = Object.entries(tasks).filter(
      ([, value]) => typeof value === "object" && value !== null && "handler" in (value as object),
    );
    expect(fns.length).toBeGreaterThan(4);
    for (const [name, value] of fns) {
      expect(serverFnMiddlewareNames(value), `${name} bez bramki`).toContain("requireCrmStaff");
    }
  });
});
