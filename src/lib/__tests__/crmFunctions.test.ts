// WARSTWA SERWEROWA CRM (lib/crm.functions.ts) - 0 z 50 funkcji miało pokrycie.
//
// CO TU TESTUJEMY: to, co warstwa serwerowa robi POZA regułami - rozwiązanie
// tenanta, kształt zwracanych danych (`json` jako napis, bo serializer
// TanStacka nie przyjmuje jsonb/inet), ścieżkę błędu, zapis audytu, kolejność
// zapytań i to, że eksport CSV widzi DOKŁADNIE ten sam zbiór co lista.
//
// CZEGO NIE TESTUJEMY: autoryzacji i RLS. `requireCrmStaff` jest middleware
// (harness go nie uruchamia), a polityki bazy sprawdza pgTAP -
// `crm_upsert_lead_authz_test.sql`, `crm_lead_scoring_test.sql`,
// `crm_tasks_followups_test.sql`. Zamiast tego jest test STRUKTURALNY:
// każda serwerowa funkcja CRM musi deklarować bramkę.
//
// Dane wyłącznie syntetyczne (domena example.test).
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

const h = vi.hoisted(() => ({
  adminFrom: null as ((table: string) => unknown) | null,
  dispatch: { delivered: 0, failed: 0 },
  dispatchThrows: false,
  dispatchCalls: [] as number[],
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: (table: string) => h.adminFrom?.(table) },
}));
vi.mock("@/lib/integrations/dispatch.functions", () => ({
  runIntegrationDispatch: async (limit: number) => {
    h.dispatchCalls.push(limit);
    if (h.dispatchThrows) throw new Error("dispatcher down");
    return h.dispatch;
  },
}));

import * as crm from "@/lib/crm.functions";

const LEAD_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";
const TENANT = "33333333-3333-4333-8333-333333333333";
const USER_ID = "44444444-4444-4444-8444-444444444444";

const lead = supabaseFromStub();
const admin = supabaseFromStub();

interface RpcCall {
  fn: string;
  args: unknown;
}
let rpcCalls: RpcCall[] = [];
let rpcResults: Record<string, SupabaseResult> = {};

function context(): ServerFnContext {
  return {
    supabase: {
      from: lead.from,
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
  lead.reset();
  admin.reset();
  rpcCalls = [];
  rpcResults = {};
  h.adminFrom = admin.from;
  h.dispatch = { delivered: 0, failed: 0 };
  h.dispatchThrows = false;
  h.dispatchCalls = [];
});

describe("listCrmLeads", () => {
  const rows = [{ id: LEAD_ID, email: "anna@example.test" }];

  it("czyta widok tenanta, stronicuje i oddaje total", async () => {
    lead.setResponse("crm_leads", () => ({ data: rows, error: null, count: 42 }));
    const result = await callServerFn(crm.listCrmLeads, {
      data: { page: 2, limit: 10 },
      context: context(),
    });
    expect(result).toMatchObject({ total: 42, page: 2, pageSize: 10 });
    expect(parsed(result)).toEqual(rows);
    const chain = lead.lastChain("crm_leads");
    expect(chain?.argsOf("select")).toEqual(["*", { count: "exact" }]);
    // Strona 2 przy rozmiarze 10 to wiersze 10-19.
    expect(chain?.argsOf("range")).toEqual([10, 19]);
  });

  it("zakres „wszystkie tenanty” czyta osobny widok", async () => {
    lead.setResponse("crm_leads_all", () => ({ data: [], error: null, count: 0 }));
    await callServerFn(crm.listCrmLeads, { data: { scope: "all" }, context: context() });
    expect(lead.lastChain("crm_leads_all")).toBeTruthy();
  });

  it("filtry i sort trafiają do zapytania (nie do pamięci klienta)", async () => {
    lead.setResponse("crm_leads", () => ({ data: [], error: null, count: 0 }));
    await callServerFn(crm.listCrmLeads, {
      data: { stage: "won", band: "hot", sort: "score", sort_dir: "asc" },
      context: context(),
    });
    const chain = lead.lastChain("crm_leads");
    expect(chain?.calls.filter((c) => c.method === "eq").map((c) => c.args)).toEqual([
      ["stage", "won"],
      ["score_band", "hot"],
    ]);
    expect(chain?.calls.filter((c) => c.method === "order").map((c) => c.args[0])).toEqual([
      "score",
      "id",
    ]);
  });

  it("brak wierszy oddaje pustą listę, a nie null", async () => {
    lead.setResponse("crm_leads", () => ({ data: null, error: null, count: null }));
    const result = await callServerFn(crm.listCrmLeads, { data: {}, context: context() });
    expect(parsed(result)).toEqual([]);
    expect((result as { total: number }).total).toBe(0);
  });

  it("błąd bazy wychodzi jako wyjątek z komunikatem", async () => {
    lead.setResponse("crm_leads", () => fail("permission denied"));
    await expect(callServerFn(crm.listCrmLeads, { data: {}, context: context() })).rejects.toThrow(
      "permission denied",
    );
  });

  it("odrzuca wejście spoza schematu (rozmiar strony)", async () => {
    await expect(
      callServerFn(crm.listCrmLeads, { data: { limit: 5000 }, context: context() }),
    ).rejects.toThrow();
  });
});

describe("exportCrmLeadsCsv", () => {
  it("eksport widzi ten sam zbiór filtrów co lista i ma sufit wierszy", async () => {
    lead.setResponse("crm_leads", () => ok([]));
    await callServerFn(crm.exportCrmLeadsCsv, {
      data: { stage: "won", sort: "created", sort_dir: "desc" },
      context: context(),
    });
    const chain = lead.lastChain("crm_leads");
    expect(chain?.argsOf("eq")).toEqual(["stage", "won"]);
    expect(chain?.argsOf("limit")).toEqual([5000]);
    expect(chain?.has("range")).toBe(false);
  });

  it("plik ma nagłówek, wiersze i neutralizuje formuły", async () => {
    lead.setResponse("crm_leads", () =>
      ok([
        {
          email: "anna@example.test",
          first_name: "=SUM(A1)",
          last_name: "Kowalska",
          stage: "new",
          score: 10,
          tags: ["eu"],
          marketing_consent: true,
        },
      ]),
    );
    const result = await callServerFn<{ csv: string; count: number }>(crm.exportCrmLeadsCsv, {
      data: {},
      context: context(),
    });
    const [header, row] = result.csv.trim().split("\n");
    expect(header.startsWith("email,first_name,last_name")).toBe(true);
    // Neutralizacja formuł (lib/crm/csv) - komórka nie może zacząć się od `=`.
    expect(row).not.toMatch(/,=SUM/);
    expect(result.count).toBe(1);
  });

  it("błąd bazy przerywa eksport", async () => {
    lead.setResponse("crm_leads", () => fail("timeout"));
    await expect(
      callServerFn(crm.exportCrmLeadsCsv, { data: {}, context: context() }),
    ).rejects.toThrow("timeout");
  });
});

describe("getCrmLead", () => {
  it("składa kartę kontaktu z pięciu źródeł i dokleja avatar profilu", async () => {
    lead.setResponse("crm_leads", () =>
      ok({ id: LEAD_ID, email: "a@example.test", tenant_id: TENANT }),
    );
    lead.setResponse("contact_messages", () => ok([{ id: "m1" }]));
    lead.setResponse("newsletter_subscribers", () => ok([{ id: "s1" }]));
    lead.setResponse("crm_consent_log", () => ok([{ id: "c1" }]));
    lead.setResponse("crm_lead_notes", () => ok([{ id: "n1" }]));
    lead.setResponse("profiles", () => ok({ avatar_url: "https://example.test/a.png" }));

    const result = await callServerFn(crm.getCrmLead, {
      data: { id: LEAD_ID },
      context: context(),
    });
    expect(parsed(result)).toMatchObject({
      messages: [{ id: "m1" }],
      subscriptions: [{ id: "s1" }],
      consents: [{ id: "c1" }],
      notes: [{ id: "n1" }],
      profile_avatar_url: "https://example.test/a.png",
    });
  });

  it("brak leada to błąd, a nie pusta karta", async () => {
    lead.setResponse("crm_leads", () => ok(null));
    await expect(
      callServerFn(crm.getCrmLead, { data: { id: LEAD_ID }, context: context() }),
    ).rejects.toThrow("Lead not found");
  });

  it("błąd odczytu profilu nie wywraca karty - avatar zostaje pusty", async () => {
    lead.setResponse("crm_leads", () =>
      ok({ id: LEAD_ID, email: "a@example.test", tenant_id: TENANT }),
    );
    for (const table of [
      "contact_messages",
      "newsletter_subscribers",
      "crm_consent_log",
      "crm_lead_notes",
    ]) {
      lead.setResponse(table, () => ok([]));
    }
    lead.setResponse("profiles", () => {
      throw new Error("RLS");
    });
    const result = await callServerFn(crm.getCrmLead, {
      data: { id: LEAD_ID },
      context: context(),
    });
    expect((parsed(result) as { profile_avatar_url: unknown }).profile_avatar_url).toBeNull();
  });

  it("odrzuca identyfikator, który nie jest UUID", async () => {
    await expect(
      callServerFn(crm.getCrmLead, { data: { id: "nie-uuid" }, context: context() }),
    ).rejects.toThrow();
  });
});

describe("updateCrmLead", () => {
  it("zapis jest zawężony do tenanta leada", async () => {
    lead.setResponse("crm_leads", (chain) =>
      chain.has("update") ? ok(null) : ok({ id: LEAD_ID, tenant_id: TENANT }),
    );
    await callServerFn(crm.updateCrmLead, {
      data: { id: LEAD_ID, stage: "qualified" },
      context: context(),
    });
    const write = lead.chainsFor("crm_leads").find((c) => c.has("update"));
    expect(write?.argsOf("update")).toEqual([{ stage: "qualified", tenant_id: TENANT }]);
    expect(write?.calls.filter((c) => c.method === "eq").map((c) => c.args)).toEqual([
      ["id", LEAD_ID],
      ["tenant_id", TENANT],
    ]);
  });

  it("nieznany lead nie jest zapisywany", async () => {
    lead.setResponse("crm_leads", () => ok(null));
    await expect(
      callServerFn(crm.updateCrmLead, { data: { id: LEAD_ID, stage: "won" }, context: context() }),
    ).rejects.toThrow("lead_not_found");
  });

  it("firma z innego tenanta nie da się podpiąć pod lead", async () => {
    lead.setResponse("crm_leads", () => ok({ id: LEAD_ID, tenant_id: TENANT }));
    lead.setResponse("crm_companies", () => ok({ id: OTHER_ID, tenant_id: "inny-tenant" }));
    await expect(
      callServerFn(crm.updateCrmLead, {
        data: { id: LEAD_ID, company_id: OTHER_ID },
        context: context(),
      }),
    ).rejects.toThrow("company_tenant_mismatch");
  });

  it("błąd zapisu wychodzi na zewnątrz", async () => {
    lead.setResponse("crm_leads", (chain) =>
      chain.has("update") ? fail("update failed") : ok({ id: LEAD_ID, tenant_id: TENANT }),
    );
    await expect(
      callServerFn(crm.updateCrmLead, { data: { id: LEAD_ID, stage: "won" }, context: context() }),
    ).rejects.toThrow("update failed");
  });
});

describe("notatki", () => {
  it("notatka zapisuje autora z kontekstu", async () => {
    lead.setResponse("crm_lead_notes", () => ok(null));
    await callServerFn(crm.addCrmNote, {
      data: { lead_id: LEAD_ID, body: "Rozmowa telefoniczna" },
      context: context(),
    });
    expect(lead.lastChain("crm_lead_notes")?.argsOf("insert")).toEqual([
      { lead_id: LEAD_ID, body: "Rozmowa telefoniczna", author_id: USER_ID },
    ]);
  });

  it("błąd zapisu notatki wychodzi na zewnątrz", async () => {
    lead.setResponse("crm_lead_notes", () => fail("insert failed"));
    await expect(
      callServerFn(crm.addCrmNote, { data: { lead_id: LEAD_ID, body: "x" }, context: context() }),
    ).rejects.toThrow("insert failed");
  });

  it("pusta notatka nie przechodzi walidacji", async () => {
    await expect(
      callServerFn(crm.addCrmNote, { data: { lead_id: LEAD_ID, body: "   " }, context: context() }),
    ).rejects.toThrow();
  });

  it("klucz idempotencji przepuszcza zapis tylko raz (retry HTTP nie dubluje notatki)", async () => {
    lead.setResponse("crm_lead_notes", () => ok(null));
    rpcResults.claim_command = ok({ claimed: true, status: "claimed" });
    rpcResults.complete_command = ok(null);
    await callServerFn(crm.addCrmNote, {
      data: { lead_id: LEAD_ID, body: "Rozmowa", idempotency_key: "crm-note-0001" },
      context: context(),
    });
    expect(rpcCalls.map((c) => c.fn)).toEqual(["claim_command", "complete_command"]);
    expect(rpcCalls[0].args).toMatchObject({ p_key: "crm-note-0001", p_command: "crm.add_note" });
    expect(lead.chainsFor("crm_lead_notes").filter((c) => c.has("insert"))).toHaveLength(1);
  });

  it("powtórzone wywołanie z tym samym kluczem oddaje zapamiętany wynik, bez zapisu", async () => {
    lead.setResponse("crm_lead_notes", () => ok(null));
    rpcResults.claim_command = ok({ claimed: false, status: "succeeded", result: { ok: true } });
    const result = await callServerFn(crm.addCrmNote, {
      data: { lead_id: LEAD_ID, body: "Rozmowa", idempotency_key: "crm-note-0001" },
      context: context(),
    });
    expect(result).toEqual({ ok: true });
    expect(lead.chainsFor("crm_lead_notes")).toHaveLength(0);
  });

  it("usunięcie notatki idzie po identyfikatorze", async () => {
    lead.setResponse("crm_lead_notes", () => ok(null));
    await callServerFn(crm.deleteCrmNote, { data: { id: LEAD_ID }, context: context() });
    const chain = lead.lastChain("crm_lead_notes");
    expect(chain?.has("delete")).toBe(true);
    expect(chain?.argsOf("eq")).toEqual(["id", LEAD_ID]);
  });

  it("błąd usunięcia notatki wychodzi na zewnątrz", async () => {
    lead.setResponse("crm_lead_notes", () => fail("delete failed"));
    await expect(
      callServerFn(crm.deleteCrmNote, { data: { id: LEAD_ID }, context: context() }),
    ).rejects.toThrow("delete failed");
  });
});

describe("kronika kontaktu (timeline)", () => {
  function timelineSources(): void {
    lead.setResponse("crm_leads", () =>
      ok({ id: LEAD_ID, email: "a@example.test", tenant_id: TENANT }),
    );
    lead.setResponse("contact_messages", () =>
      ok([
        {
          id: "m1",
          form_name: "Kontakt",
          form_type: "contact",
          subject: "Pytanie",
          message: "Treść wiadomości",
          page_url: "/kontakt",
          lang: "pl",
          created_at: "2026-08-01T10:00:00.000Z",
        },
      ]),
    );
    lead.setResponse("newsletter_subscribers", () =>
      ok([
        {
          id: "s1",
          status: "subscribed",
          source_form_name: "Stopka",
          confirmed_at: "2026-08-02T10:00:00.000Z",
          created_at: "2026-08-02T09:00:00.000Z",
        },
      ]),
    );
    lead.setResponse("crm_consent_log", () =>
      ok([
        {
          id: "c1",
          consent_key: "marketing",
          given: true,
          consent_text: "Zgadzam się na otrzymywanie informacji handlowych",
          consent_version: "1.0",
          form_name: "Kontakt",
          created_at: "2026-08-03T10:00:00.000Z",
        },
      ]),
    );
    lead.setResponse("crm_lead_notes", () =>
      ok([
        { id: "n1", body: "Notatka", author_id: USER_ID, created_at: "2026-08-04T10:00:00.000Z" },
      ]),
    );
    lead.setResponse("audit_log", () =>
      ok([
        {
          id: "a1",
          action: "crm.lead.webhook_push",
          actor_id: USER_ID,
          metadata: { endpoint: "partner" },
          created_at: "2026-08-05T10:00:00.000Z",
        },
      ]),
    );
  }

  it("składa zdarzenia ze wszystkich źródeł i sortuje malejąco po dacie", async () => {
    timelineSources();
    const result = await callServerFn(crm.getCrmLeadTimeline, {
      data: { id: LEAD_ID },
      context: context(),
    });
    const { events } = parsed(result) as {
      events: Array<{ id: string; type: string; at: string }>;
    };
    expect(events.map((e) => e.type)).toEqual([
      "webhook",
      "note",
      "consent",
      "newsletter",
      "newsletter",
      "submit",
    ]);
    // Potwierdzenie DOI jest osobnym zdarzeniem, nie polem zapisu.
    expect(events.filter((e) => e.id.startsWith("sub-doi:"))).toHaveLength(1);
  });

  it("zdarzenie audytu bez „webhook” w nazwie to zmiana etapu", async () => {
    timelineSources();
    lead.setResponse("audit_log", () =>
      ok([
        {
          id: "a2",
          action: "crm.lead.stage_changed",
          actor_id: USER_ID,
          metadata: null,
          created_at: "2026-08-06T10:00:00.000Z",
        },
      ]),
    );
    const result = await callServerFn(crm.getCrmLeadTimeline, {
      data: { id: LEAD_ID },
      context: context(),
    });
    const { events } = parsed(result) as { events: Array<{ type: string }> };
    expect(events[0].type).toBe("stage_change");
  });

  it("eksport kroniki oddaje CSV, e-mail kontaktu i liczbę zdarzeń", async () => {
    timelineSources();
    const result = await callServerFn<{ csv: string; email: string; count: number }>(
      crm.exportCrmLeadTimelineCsv,
      { data: { id: LEAD_ID }, context: context() },
    );
    expect(result.email).toBe("a@example.test");
    expect(result.count).toBe(6);
    expect(result.csv.split("\n")[0]).toBe("at,type,title,detail,meta");
  });

  it("brak leada przerywa budowę kroniki", async () => {
    lead.setResponse("crm_leads", () => ok(null));
    await expect(
      callServerFn(crm.getCrmLeadTimeline, { data: { id: LEAD_ID }, context: context() }),
    ).rejects.toThrow("Lead not found");
  });
});

describe("scoring", () => {
  it("brak ustawień tenanta oddaje null zamiast błędu", async () => {
    lead.setResponse("crm_scoring_settings", () => ok(null));
    const result = await callServerFn(crm.getCrmScoringSettings, { context: context() });
    expect(parsed(result)).toBeNull();
  });

  it("błąd odczytu ustawień wychodzi na zewnątrz", async () => {
    lead.setResponse("crm_scoring_settings", () => fail("boom"));
    await expect(callServerFn(crm.getCrmScoringSettings, { context: context() })).rejects.toThrow(
      "boom",
    );
  });

  const settings = {
    enabled: true,
    half_life_days: 30,
    horizon_days: 365,
    hot_threshold: 80,
    warm_threshold: 50,
    cool_threshold: 20,
    weights: { form_submit: { points: 12 } },
  };

  it("zapis ustawień wymaga roli administratora", async () => {
    rpcResults.has_role = ok(false);
    rpcResults.is_super_admin = ok(false);
    await expect(
      callServerFn(crm.upsertCrmScoringSettings, { data: settings, context: context() }),
    ).rejects.toThrow("Forbidden");
  });

  it("bez tenanta w profilu zapis nie ma gdzie trafić", async () => {
    rpcResults.has_role = ok(true);
    lead.setResponse("profiles", () => ok(null));
    await expect(
      callServerFn(crm.upsertCrmScoringSettings, { data: settings, context: context() }),
    ).rejects.toThrow("no_tenant");
  });

  it("częściowa waga jest domykana do pełnej pary punkty+sufit", async () => {
    rpcResults.has_role = ok(true);
    lead.setResponse("profiles", () => ok({ tenant_id: TENANT }));
    lead.setResponse("crm_scoring_settings", (chain) =>
      chain.has("update") || chain.has("insert") ? ok(null) : ok(null),
    );
    await callServerFn(crm.upsertCrmScoringSettings, { data: settings, context: context() });
    const write = lead.chainsFor("crm_scoring_settings").find((c) => c.has("insert"));
    const payload = write?.argsOf("insert")?.[0] as { weights: Record<string, unknown> };
    // SQL scala wagi płytkim `jsonb ||` - brak `cap` wyzerowałby sufit sygnału.
    expect(payload.weights.form_submit).toEqual({ points: 12, cap: expect.any(Number) });
    expect(payload).toMatchObject({ tenant_id: TENANT });
  });

  it("istniejący wiersz jest aktualizowany, nie dublowany", async () => {
    rpcResults.has_role = ok(true);
    lead.setResponse("profiles", () => ok({ tenant_id: TENANT }));
    lead.setResponse("crm_scoring_settings", () => ok({ tenant_id: TENANT }));
    await callServerFn(crm.upsertCrmScoringSettings, { data: settings, context: context() });
    expect(lead.chainsFor("crm_scoring_settings").some((c) => c.has("update"))).toBe(true);
    expect(lead.chainsFor("crm_scoring_settings").some((c) => c.has("insert"))).toBe(false);
  });

  it("progi muszą maleć - inaczej wejście nie przechodzi walidacji", async () => {
    await expect(
      callServerFn(crm.upsertCrmScoringSettings, {
        data: { ...settings, hot_threshold: 10 },
        context: context(),
      }),
    ).rejects.toThrow();
  });

  it("przeliczenie jednego leada woła RPC bazy", async () => {
    rpcResults.recompute_crm_lead_score = ok({ score: 42 });
    const result = await callServerFn(crm.recomputeLeadScore, {
      data: { id: LEAD_ID },
      context: context(),
    });
    expect(rpcCalls[0]).toEqual({
      fn: "recompute_crm_lead_score",
      args: { p_lead_id: LEAD_ID },
    });
    expect(parsed(result)).toEqual({ score: 42 });
  });

  it("błąd RPC przeliczenia wychodzi na zewnątrz", async () => {
    rpcResults.recompute_crm_lead_score = fail("rpc down");
    await expect(
      callServerFn(crm.recomputeLeadScore, { data: { id: LEAD_ID }, context: context() }),
    ).rejects.toThrow("rpc down");
  });

  it("przeliczenie wsadowe oddaje kursor do następnej porcji", async () => {
    rpcResults.recompute_crm_lead_scores = ok({ processed: 500, last_id: OTHER_ID, done: false });
    const result = await callServerFn<{ processed: number; lastId: string; done: boolean }>(
      crm.recomputeAllLeadScores,
      { data: { limit: 500 }, context: context() },
    );
    expect(result).toEqual({ processed: 500, lastId: OTHER_ID, done: false });
  });

  it("pusty wynik wsadu jest traktowany jak koniec pracy", async () => {
    rpcResults.recompute_crm_lead_scores = ok(null);
    const result = await callServerFn<{ processed: number; done: boolean }>(
      crm.recomputeAllLeadScores,
      { data: {}, context: context() },
    );
    expect(result).toEqual({ processed: 0, lastId: null, done: true });
  });

  it("błąd RPC wsadu wychodzi na zewnątrz", async () => {
    rpcResults.recompute_crm_lead_scores = fail("rpc down");
    await expect(
      callServerFn(crm.recomputeAllLeadScores, { data: {}, context: context() }),
    ).rejects.toThrow("rpc down");
  });
});

describe("operacje zbiorcze", () => {
  it("zmiana pól idzie jednym zapytaniem i zapisuje audyt", async () => {
    lead.setResponse("crm_leads", () => ok(null));
    lead.setResponse("audit_log", () => ok(null));
    const result = await callServerFn<{ updated: number }>(crm.bulkUpdateCrmLeads, {
      data: { ids: [LEAD_ID, OTHER_ID], stage: "contacted" },
      context: context(),
    });
    expect(result.updated).toBe(2);
    expect(lead.lastChain("crm_leads")?.argsOf("update")).toEqual([{ stage: "contacted" }]);
    const audit = lead.lastChain("audit_log")?.argsOf("insert")?.[0] as {
      action: string;
      metadata: { count: number };
    };
    expect(audit.action).toBe("crm.lead.bulk_update");
    expect(audit.metadata.count).toBe(2);
  });

  it("tagi są dokładane i usuwane per rekord (text[] bez operatora w PATCH)", async () => {
    lead.setResponse("crm_leads", (chain) =>
      chain.has("update")
        ? ok(null)
        : ok([
            { id: LEAD_ID, tags: ["eu", "stare"] },
            { id: OTHER_ID, tags: null },
          ]),
    );
    lead.setResponse("audit_log", () => ok(null));
    await callServerFn(crm.bulkUpdateCrmLeads, {
      data: { ids: [LEAD_ID, OTHER_ID], add_tags: ["nowe"], remove_tags: ["stare"] },
      context: context(),
    });
    const writes = lead
      .chainsFor("crm_leads")
      .filter((c) => c.has("update"))
      .map((c) => c.argsOf("update")?.[0]);
    expect(writes).toEqual([{ tags: ["eu", "nowe"] }, { tags: ["nowe"] }]);
  });

  it("wyczyszczenie wszystkich tagów zapisuje NULL, nie pustą tablicę", async () => {
    lead.setResponse("crm_leads", (chain) =>
      chain.has("update") ? ok(null) : ok([{ id: LEAD_ID, tags: ["stare"] }]),
    );
    lead.setResponse("audit_log", () => ok(null));
    await callServerFn(crm.bulkUpdateCrmLeads, {
      data: { ids: [LEAD_ID], remove_tags: ["stare"] },
      context: context(),
    });
    const write = lead.chainsFor("crm_leads").find((c) => c.has("update"));
    expect(write?.argsOf("update")).toEqual([{ tags: null }]);
  });

  it("błąd zapisu zbiorczego wychodzi na zewnątrz", async () => {
    lead.setResponse("crm_leads", () => fail("bulk failed"));
    await expect(
      callServerFn(crm.bulkUpdateCrmLeads, {
        data: { ids: [LEAD_ID], stage: "won" },
        context: context(),
      }),
    ).rejects.toThrow("bulk failed");
  });

  it("awaria audytu nie wywraca operacji (best-effort)", async () => {
    lead.setResponse("crm_leads", () => ok(null));
    lead.setResponse("audit_log", () => {
      throw new Error("audit down");
    });
    await expect(
      callServerFn(crm.bulkUpdateCrmLeads, {
        data: { ids: [LEAD_ID], stage: "won" },
        context: context(),
      }),
    ).resolves.toMatchObject({ ok: true });
  });

  it("usuwanie zbiorcze jest zarezerwowane dla administratora", async () => {
    rpcResults.has_role = ok(false);
    await expect(
      callServerFn(crm.bulkDeleteCrmLeads, { data: { ids: [LEAD_ID] }, context: context() }),
    ).rejects.toThrow("forbidden");
    expect(lead.chainsFor("crm_leads")).toHaveLength(0);
  });

  it("administrator usuwa i zostawia ślad w audycie", async () => {
    rpcResults.has_role = ok(true);
    lead.setResponse("crm_leads", () => ok(null));
    lead.setResponse("audit_log", () => ok(null));
    const result = await callServerFn<{ deleted: number }>(crm.bulkDeleteCrmLeads, {
      data: { ids: [LEAD_ID, OTHER_ID] },
      context: context(),
    });
    expect(result.deleted).toBe(2);
    expect(lead.lastChain("crm_leads")?.has("delete")).toBe(true);
    expect((lead.lastChain("audit_log")?.argsOf("insert")?.[0] as { action: string }).action).toBe(
      "crm.lead.bulk_delete",
    );
  });

  it("błąd usuwania wychodzi na zewnątrz", async () => {
    rpcResults.has_role = ok(true);
    lead.setResponse("crm_leads", () => fail("delete failed"));
    await expect(
      callServerFn(crm.bulkDeleteCrmLeads, { data: { ids: [LEAD_ID] }, context: context() }),
    ).rejects.toThrow("delete failed");
  });
});

describe("lista właścicieli (staff picker)", () => {
  it("czyta role adminem i zawęża profile do tenanta z tokenu", async () => {
    admin.setResponse("user_roles", () => ok([{ user_id: USER_ID, role: "admin" }]));
    admin.setResponse("profiles", () => ok([{ id: USER_ID, display_name: "Anna" }]));
    const result = await callServerFn(crm.listStaffUsers, { context: context() });
    expect(parsed(result)).toEqual([{ id: USER_ID, display_name: "Anna" }]);
    expect(admin.lastChain("profiles")?.argsOf("eq")).toEqual(["tenant_id", TENANT]);
  });

  it("brak staffu oddaje pustą listę bez pytania o profile", async () => {
    admin.setResponse("user_roles", () => ok([]));
    const result = await callServerFn(crm.listStaffUsers, { context: context() });
    expect(parsed(result)).toEqual([]);
    expect(admin.chainsFor("profiles")).toHaveLength(0);
  });

  it("bez tenanta w tokenie lista nie jest zawężana po tenancie", async () => {
    admin.setResponse("user_roles", () => ok([{ user_id: USER_ID, role: "editor" }]));
    admin.setResponse("profiles", () => ok([]));
    await callServerFn(crm.listStaffUsers, {
      context: { supabase: context().supabase, userId: USER_ID, claims: {} },
    });
    expect(admin.lastChain("profiles")?.has("eq")).toBe(false);
  });
});

describe("push leada do partnerów", () => {
  it("brak aktywnych endpointów kończy się jasnym powodem", async () => {
    rpcResults.crm_enqueue_lead_push = ok(0);
    const result = await callServerFn(crm.pushLeadToPartners, {
      data: { lead_id: LEAD_ID },
      context: context(),
    });
    expect(result).toEqual({
      ok: false,
      enqueued: 0,
      delivered: 0,
      failed: 0,
      error: "no_active_endpoints",
    });
  });

  it("kolejkuje dostawę i budzi dispatcher od razu", async () => {
    rpcResults.crm_enqueue_lead_push = ok(3);
    h.dispatch = { delivered: 3, failed: 0 };
    const result = await callServerFn(crm.pushLeadToPartners, {
      data: { lead_id: LEAD_ID },
      context: context(),
    });
    expect(result).toEqual({ ok: true, enqueued: 3, delivered: 3, failed: 0 });
    // Limit ticku: 2x kolejka, w widełkach 5-20.
    expect(h.dispatchCalls).toEqual([6]);
  });

  it("awaria dispatchera nie gubi dostawy - zostaje w outboxie", async () => {
    rpcResults.crm_enqueue_lead_push = ok(2);
    h.dispatchThrows = true;
    const result = await callServerFn(crm.pushLeadToPartners, {
      data: { lead_id: LEAD_ID },
      context: context(),
    });
    expect(result).toEqual({ ok: true, enqueued: 2, delivered: 0, failed: 0 });
  });

  it("błąd RPC kolejkowania wychodzi na zewnątrz", async () => {
    rpcResults.crm_enqueue_lead_push = fail("enqueue failed");
    await expect(
      callServerFn(crm.pushLeadToPartners, { data: { lead_id: LEAD_ID }, context: context() }),
    ).rejects.toThrow("enqueue failed");
  });
});

describe("metering i profil leada", () => {
  it("lead bez e-maila nie ma czego mierzyć", async () => {
    lead.setResponse("crm_leads", () => ok(null));
    const result = await callServerFn(crm.getCrmLeadMonthlyMetering, {
      data: { id: LEAD_ID },
      context: context(),
    });
    expect(parsed(result)).toBeNull();
  });

  it("brak dopasowanego użytkownika kończy pomiar", async () => {
    lead.setResponse("crm_leads", () => ok({ email: "a@example.test", tenant_id: TENANT }));
    admin.setResponse("profiles", () => ok([]));
    const result = await callServerFn(crm.getCrmLeadMonthlyMetering, {
      data: { id: LEAD_ID },
      context: context(),
    });
    expect(parsed(result)).toBeNull();
  });

  it("zużycie liczy wiersze bieżącego miesiąca i domyka limit", async () => {
    lead.setResponse("crm_leads", () => ok({ email: "a@example.test", tenant_id: TENANT }));
    admin.setResponse("profiles", () => ok([{ id: USER_ID }]));
    admin.setResponse("metering_settings", () => ok({ member_monthly_limit: 5, enabled: true }));
    admin.setResponse("metered_views", () => ok([{ id: "v1" }, { id: "v2" }]));
    const result = await callServerFn(crm.getCrmLeadMonthlyMetering, {
      data: { id: LEAD_ID },
      context: context(),
    });
    expect(parsed(result)).toMatchObject({
      used: 2,
      monthly_limit: 5,
      remaining: 3,
      enabled: true,
    });
  });

  it("brak ustawień meteringu spada na domyślne 5 artykułów", async () => {
    lead.setResponse("crm_leads", () => ok({ email: "a@example.test", tenant_id: TENANT }));
    admin.setResponse("profiles", () => ok([{ id: USER_ID }]));
    admin.setResponse("metering_settings", () => ok(null));
    admin.setResponse("metered_views", () => ok([]));
    const result = await callServerFn(crm.getCrmLeadMonthlyMetering, {
      data: { id: LEAD_ID },
      context: context(),
    });
    expect(parsed(result)).toMatchObject({
      monthly_limit: 5,
      used: 0,
      remaining: 5,
      enabled: true,
    });
  });

  it("synchronizacja profilu bez dopasowania oddaje matched:false", async () => {
    lead.setResponse("crm_leads", () => ok({ email: "a@example.test", tenant_id: TENANT }));
    admin.setResponse("profiles", () => ok([]));
    const result = await callServerFn(crm.getCrmLeadProfileSync, {
      data: { lead_id: LEAD_ID },
      context: context(),
    });
    expect(parsed(result)).toEqual({ matched: false });
  });

  it("synchronizacja profilu zbiera doświadczenie, umiejętności i CV", async () => {
    lead.setResponse("crm_leads", () => ok({ email: "a@example.test", tenant_id: TENANT }));
    admin.setResponse("profiles", () =>
      ok([{ id: USER_ID, tenant_id: TENANT, display_name: "Anna" }]),
    );
    admin.setResponse("profile_experiences", () => ok([{ id: "e1" }]));
    admin.setResponse("profile_skills", () => ok([{ id: "s1" }]));
    admin.setResponse("profile_cv_files", () => ok({ id: "cv1" }));
    admin.setResponse("profile_awards", () => ok([{ id: "aw1" }]));
    admin.setResponse("profile_education", () => ok([{ id: "ed1" }]));
    const result = await callServerFn(crm.getCrmLeadProfileSync, {
      data: { lead_id: LEAD_ID },
      context: context(),
    });
    expect(parsed(result)).toMatchObject({
      matched: true,
      experiences: [{ id: "e1" }],
      skills: [{ id: "s1" }],
      cv: { id: "cv1" },
      awards: [{ id: "aw1" }],
      education: [{ id: "ed1" }],
    });
  });

  it("RODO: synchronizacja NIE czyta wyników testu osobowości", async () => {
    lead.setResponse("crm_leads", () => ok({ email: "a@example.test", tenant_id: TENANT }));
    admin.setResponse("profiles", () => ok([{ id: USER_ID, tenant_id: TENANT }]));
    for (const table of [
      "profile_experiences",
      "profile_skills",
      "profile_cv_files",
      "profile_awards",
      "profile_education",
    ]) {
      admin.setResponse(table, () => ok([]));
    }
    await callServerFn(crm.getCrmLeadProfileSync, {
      data: { lead_id: LEAD_ID },
      context: context(),
    });
    // Dane psychometryczne zostały odcięte migracją 20260711120000 - odczyt
    // service-rolem obchodziłby tę decyzję bez celu przetwarzania.
    expect(admin.chains.map((c) => c.table)).not.toContain("profile_big5_results");
    expect(admin.chains.map((c) => c.table).some((t) => t.includes("big5"))).toBe(false);
  });

  it("członkostwo leada bez dopasowanego profilu oddaje null", async () => {
    lead.setResponse("crm_leads", () => ok({ email: "a@example.test", tenant_id: TENANT }));
    admin.setResponse("profiles", () => ok([]));
    const result = await callServerFn(crm.getCrmLeadMembership, {
      data: { id: LEAD_ID },
      context: context(),
    });
    expect(parsed(result)).toBeNull();
  });

  it("członkostwo leada składa się ze źródeł tego samego tenanta", async () => {
    lead.setResponse("crm_leads", () => ok({ email: "a@example.test", tenant_id: TENANT }));
    admin.setResponse("profiles", () => ok([{ id: USER_ID }]));
    admin.setResponse("membership_tiers", () =>
      ok([{ key: "member", rank: 10, name_pl: "Członek", name_en: "Member", is_default: true }]),
    );
    admin.setResponse("user_subscriptions", () => ok([]));
    admin.setResponse("membership_grants", () => ok([]));
    admin.setResponse("organization_seats", () => ok([]));
    const result = await callServerFn(crm.getCrmLeadMembership, {
      data: { id: LEAD_ID },
      context: context(),
    });
    expect(parsed(result)).toMatchObject({ user_id: USER_ID, source: "default" });
    for (const chain of admin.chains) {
      if (chain.table === "profiles") continue;
      expect(chain.calls.some((c) => c.method === "eq" && c.args[0] === "tenant_id")).toBe(true);
    }
  });
});

describe("bramka uprawnień - test strukturalny", () => {
  it("każda serwerowa funkcja CRM deklaruje requireCrmStaff", () => {
    const fns = Object.entries(crm).filter(
      ([, value]) => typeof value === "object" && value !== null && "handler" in (value as object),
    );
    expect(fns.length).toBeGreaterThan(10);
    for (const [name, value] of fns) {
      expect(serverFnMiddlewareNames(value), `${name} bez bramki`).toContain("requireCrmStaff");
    }
  });
});
