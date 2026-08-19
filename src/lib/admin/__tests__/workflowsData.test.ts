// WARSTWA DANYCH modułu „Automatyzacje" - zapytania i mutacje przez PostgREST
// oraz dwa helpery, których nie dotykał test czystych helperów obok
// (`workflows.test.ts`).
//
// DLACZEGO OSOBNY PLIK. `workflows.test.ts` atrapuje klienta Supabase pustym
// obiektem (`supabase: {}`), bo do czystych helperów klient nie jest potrzebny.
// Dziewięć funkcji asynchronicznych tego modułu potrzebuje PEŁNEGO łańcucha
// PostgREST, `rpc()` i `auth.getSession()` - i to one, nie helpery, stały na
// zerze (audyt 18.08 podał 21 z 32 funkcji; niedobita reszta to dokładnie ta
// warstwa plus `isUuid` i `conditionValueToInput`).
//
// CO TE TESTY PILNUJĄ - nie „czy zapytanie się wykonało", tylko reguły, których
// złamanie jest ciche i kosztowne:
//   * `saveWorkflowDefinition` PINUJE `tenant_id` z rpc `current_tenant_id()`,
//     bo kolumna nie ma defaultu, a policy WITH CHECK i tak go wymusza - bez
//     pinu INSERT leci na policy, a redaktor widzi „nie udało się zapisać";
//   * brak tenanta MUSI być wyjątkiem, nie INSERT-em z `tenant_id: null`;
//   * `fetchCorrelationTrace` NIE odpytuje outboxu, gdy ślad nie ma zdarzeń
//     (puste `.in("event_id", [])` to zapytanie po całej tabeli dostaw);
//   * każdy odczyt propaguje błąd PostgREST wyjątkiem, a `data: null`
//     zamienia na pustą listę - panel nie może dostać `null` do `.map()`.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fail, ok, type SupabaseFromStub, type SupabaseResult } from "@/test/supabaseChain";

// Atrapy modułowe muszą powstać w fabryce `vi.mock` (hoisting), więc trzymamy
// je w kontenerze `vi.hoisted` - ten sam wzorzec, co w testach czatu i profilu.
const stubs = vi.hoisted(() => ({
  from: null as unknown,
  rpc: null as unknown,
  getSession: null as unknown,
}));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabaseChain");
  const { vi: v } = await import("vitest");
  const from = supabaseFromStub();
  const rpc = v.fn(async (_name: string, _args?: Record<string, unknown>) => ({
    data: null as unknown,
    error: null as unknown,
  }));
  const getSession = v.fn(async () => ({ data: { session: null as unknown }, error: null }));
  stubs.from = from;
  stubs.rpc = rpc;
  stubs.getSession = getSession;
  return { supabase: { from: from.from, rpc, auth: { getSession } } };
});

import {
  conditionValueToInput,
  deleteWorkflowDefinition,
  fetchCorrelationTrace,
  fetchRecentWorkflowRuns,
  fetchWorkflowDefinitions,
  fetchWorkflowRuns,
  fetchWorkflowTemplates,
  installWorkflowTemplate,
  isUuid,
  saveWorkflowDefinition,
  setWorkflowEnabled,
  type WorkflowDraft,
} from "@/lib/admin/workflows";

const db = stubs.from as SupabaseFromStub;
const rpc = stubs.rpc as ReturnType<typeof vi.fn>;
const getSession = stubs.getSession as ReturnType<typeof vi.fn>;

const TENANT = "11111111-1111-4111-8111-111111111111";
const DEF_ID = "22222222-2222-4222-8222-222222222222";
const CORRELATION = "6f1e0c1a-8b2d-4e3f-9a5c-2d7b8e9f0a1b";

beforeEach(() => {
  db.reset();
  rpc.mockReset();
  rpc.mockResolvedValue({ data: null, error: null });
  getSession.mockReset();
  getSession.mockResolvedValue({ data: { session: null }, error: null });
});

// ---------------------------------------------------------------------------
// Helpery pominięte przez test czystych helperów.
// ---------------------------------------------------------------------------

describe("isUuid", () => {
  it("przyjmuje uuid v4, wielkie litery i wartość otoczoną spacjami", () => {
    expect(isUuid(CORRELATION)).toBe(true);
    expect(isUuid(CORRELATION.toUpperCase())).toBe(true);
    // Pole śladu korelacji jest wklejane z konsoli/logu - spacje po bokach są
    // regułą, nie wyjątkiem, więc walidacja trimuje przed sprawdzeniem.
    expect(isUuid(`  ${CORRELATION}  `)).toBe(true);
  });

  it("odrzuca wszystko, co nie jest uuid", () => {
    expect(isUuid("")).toBe(false);
    expect(isUuid("nie-uuid")).toBe(false);
    // Za krótki ostatni segment (11 znaków zamiast 12).
    expect(isUuid("6f1e0c1a-8b2d-4e3f-9a5c-2d7b8e9f0a1")).toBe(false);
    // Znak poza zakresem szesnastkowym.
    expect(isUuid("6f1e0c1a-8b2d-4e3f-9a5c-2d7b8e9f0a1z")).toBe(false);
    // Bez myślników.
    expect(isUuid(CORRELATION.replace(/-/g, ""))).toBe(false);
    // Coś doklejone w środku wartości poprawnej.
    expect(isUuid(`${CORRELATION} i jeszcze coś`)).toBe(false);
  });
});

describe("conditionValueToInput", () => {
  it("null pokazuje jako literał `null`, nie jako pusty input", () => {
    // Pusty input znaczy „warunek na pusty string"; `null` to inna wartość
    // JSON i containment @> je rozróżnia.
    expect(conditionValueToInput(null)).toBe("null");
  });

  it("string wchodzi do inputu bez cudzysłowów", () => {
    expect(conditionValueToInput("won")).toBe("won");
    expect(conditionValueToInput("")).toBe("");
  });

  it("pozostałe typy JSON serializuje", () => {
    expect(conditionValueToInput(true)).toBe("true");
    expect(conditionValueToInput(false)).toBe("false");
    expect(conditionValueToInput(42)).toBe("42");
    expect(conditionValueToInput(-3.5)).toBe("-3.5");
    expect(conditionValueToInput({ a: 1 })).toBe('{"a":1}');
    expect(conditionValueToInput([1, 2])).toBe("[1,2]");
  });
});

// ---------------------------------------------------------------------------
// Odczyty.
// ---------------------------------------------------------------------------

describe("fetchWorkflowDefinitions", () => {
  it("czyta definicje w kolejności utworzenia (stabilna lista w panelu)", async () => {
    db.setResponse("workflow_definitions", ok([{ id: DEF_ID }]));
    const rows = await fetchWorkflowDefinitions();
    expect(rows).toEqual([{ id: DEF_ID }]);
    const chain = db.lastChain("workflow_definitions");
    expect(chain?.argsOf("select")).toEqual(["*"]);
    expect(chain?.argsOf("order")).toEqual(["created_at", { ascending: true }]);
  });

  it("`data: null` daje pustą listę, nie null (panel woła .map())", async () => {
    db.setResponse("workflow_definitions", { data: null, error: null });
    await expect(fetchWorkflowDefinitions()).resolves.toEqual([]);
  });

  it("błąd PostgREST propaguje wyjątkiem", async () => {
    db.setResponse("workflow_definitions", fail("permission denied", "42501"));
    await expect(fetchWorkflowDefinitions()).rejects.toThrow("permission denied");
  });
});

describe("fetchRecentWorkflowRuns", () => {
  it("domyślnie bierze okno 500 najnowszych przebiegów", async () => {
    db.setResponse("workflow_runs", ok([]));
    await fetchRecentWorkflowRuns();
    const chain = db.lastChain("workflow_runs");
    expect(chain?.argsOf("order")).toEqual(["created_at", { ascending: false }]);
    expect(chain?.argsOf("limit")).toEqual([500]);
  });

  it("respektuje własny limit okna", async () => {
    db.setResponse("workflow_runs", ok([]));
    await fetchRecentWorkflowRuns(10);
    expect(db.lastChain("workflow_runs")?.argsOf("limit")).toEqual([10]);
  });

  it("null -> [], błąd -> wyjątek", async () => {
    db.setResponse("workflow_runs", { data: null, error: null });
    await expect(fetchRecentWorkflowRuns()).resolves.toEqual([]);
    db.setResponse("workflow_runs", fail("boom"));
    await expect(fetchRecentWorkflowRuns()).rejects.toThrow("boom");
  });
});

describe("fetchWorkflowRuns", () => {
  it("bez filtrów: sam limit 200 i join po nazwie definicji", async () => {
    db.setResponse("workflow_runs", ok([]));
    await fetchWorkflowRuns();
    const chain = db.lastChain("workflow_runs");
    expect(chain?.argsOf("select")).toEqual(["*, workflow_definitions(name)"]);
    expect(chain?.argsOf("limit")).toEqual([200]);
    // Kluczowe: BRAK filtrów, gdy ich nie podano - `eq(undefined)` zwróciłoby
    // pustą historię i wyglądało jak „silnik nic nie zrobił".
    expect(chain?.has("eq")).toBe(false);
  });

  it("nakłada filtr przepisu i statusu, gdy podane", async () => {
    db.setResponse("workflow_runs", ok([]));
    await fetchWorkflowRuns({ workflowId: DEF_ID, status: "failed", limit: 25 });
    const chain = db.lastChain("workflow_runs");
    expect(chain?.argsOf("limit")).toEqual([25]);
    const eqs = chain?.calls.filter((c) => c.method === "eq").map((c) => c.args);
    expect(eqs).toEqual([
      ["workflow_id", DEF_ID],
      ["status", "failed"],
    ]);
  });

  it("null -> [], błąd -> wyjątek", async () => {
    db.setResponse("workflow_runs", { data: null, error: null });
    await expect(fetchWorkflowRuns()).resolves.toEqual([]);
    db.setResponse("workflow_runs", fail("runs down"));
    await expect(fetchWorkflowRuns()).rejects.toThrow("runs down");
  });
});

describe("fetchWorkflowTemplates", () => {
  it("katalog szablonów sortowany po kluczu", async () => {
    db.setResponse("workflow_templates", ok([{ key: "a" }]));
    await expect(fetchWorkflowTemplates()).resolves.toEqual([{ key: "a" }]);
    expect(db.lastChain("workflow_templates")?.argsOf("order")).toEqual([
      "key",
      { ascending: true },
    ]);
  });

  it("null -> [], błąd -> wyjątek", async () => {
    db.setResponse("workflow_templates", { data: null, error: null });
    await expect(fetchWorkflowTemplates()).resolves.toEqual([]);
    db.setResponse("workflow_templates", fail("no catalog"));
    await expect(fetchWorkflowTemplates()).rejects.toThrow("no catalog");
  });
});

describe("installWorkflowTemplate", () => {
  it("instaluje przez RPC (SECURITY DEFINER, idempotentna per tenant+klucz)", async () => {
    rpc.mockResolvedValue({ data: DEF_ID, error: null });
    await expect(installWorkflowTemplate("comment-pending-notify-staff")).resolves.toBe(DEF_ID);
    expect(rpc).toHaveBeenCalledWith("install_workflow_template", {
      p_key: "comment-pending-notify-staff",
    });
  });

  it("błąd RPC propaguje wyjątkiem", async () => {
    rpc.mockResolvedValue({ data: null, error: new Error("unknown template") });
    await expect(installWorkflowTemplate("nie-ma")).rejects.toThrow("unknown template");
  });
});

// ---------------------------------------------------------------------------
// Zapisy.
// ---------------------------------------------------------------------------

function draft(overrides: Partial<WorkflowDraft> = {}): WorkflowDraft {
  return {
    id: null,
    name: "  Lead won -> staff  ",
    enabled: true,
    triggerEventType: "  crm_lead.stage_changed.v1  ",
    conditionPairs: [{ key: " new_stage ", value: "won" }],
    steps: [{ action: "notify_staff", params: { roles: "admin, editor" } }],
    ...overrides,
  };
}

describe("saveWorkflowDefinition - aktualizacja istniejącego przepisu", () => {
  it("przycina nazwę i wyzwalacz, serializuje warunek i kroki, stempluje updated_at", async () => {
    db.setResponse("workflow_definitions", ok(null));
    const id = await saveWorkflowDefinition(draft({ id: DEF_ID }));
    expect(id).toBe(DEF_ID);

    const chain = db.lastChain("workflow_definitions");
    const [patch] = (chain?.argsOf("update") ?? []) as [Record<string, unknown>];
    expect(patch.name).toBe("Lead won -> staff");
    expect(patch.trigger_event_type).toBe("crm_lead.stage_changed.v1");
    // Klucz warunku przycięty, wartość otypowana; roles z CSV na tablicę.
    expect(patch.condition).toEqual({ new_stage: "won" });
    expect(patch.steps).toEqual([
      { action: "notify_staff", params: { roles: ["admin", "editor"] } },
    ]);
    expect(patch.enabled).toBe(true);
    expect(typeof patch.updated_at).toBe("string");
    expect(chain?.argsOf("eq")).toEqual(["id", DEF_ID]);
  });

  it("aktualizacja NIE woła current_tenant_id (wiersz już ma tenanta)", async () => {
    db.setResponse("workflow_definitions", ok(null));
    await saveWorkflowDefinition(draft({ id: DEF_ID }));
    expect(rpc).not.toHaveBeenCalled();
  });

  it("błąd UPDATE propaguje wyjątkiem", async () => {
    db.setResponse("workflow_definitions", fail("row level security"));
    await expect(saveWorkflowDefinition(draft({ id: DEF_ID }))).rejects.toThrow(
      "row level security",
    );
  });
});

describe("saveWorkflowDefinition - nowy przepis", () => {
  it("pinuje tenant_id z rpc current_tenant_id i autora z sesji", async () => {
    rpc.mockResolvedValue({ data: TENANT, error: null });
    getSession.mockResolvedValue({
      data: { session: { user: { id: "user-1" } } },
      error: null,
    });
    db.setResponse("workflow_definitions", ok({ id: DEF_ID }));

    await expect(saveWorkflowDefinition(draft())).resolves.toBe(DEF_ID);

    expect(rpc).toHaveBeenCalledWith("current_tenant_id");
    const chain = db.lastChain("workflow_definitions");
    const [row] = (chain?.argsOf("insert") ?? []) as [Record<string, unknown>];
    // Kolumna tenant_id nie ma defaultu w bazie - brak pinu = INSERT odrzucony
    // przez policy WITH CHECK.
    expect(row.tenant_id).toBe(TENANT);
    expect(row.created_by).toBe("user-1");
    expect(row.name).toBe("Lead won -> staff");
    expect(chain?.argsOf("select")).toEqual(["id"]);
  });

  it("bez sesji zapisuje created_by: null zamiast rzucać", async () => {
    rpc.mockResolvedValue({ data: TENANT, error: null });
    getSession.mockResolvedValue({ data: { session: null }, error: null });
    db.setResponse("workflow_definitions", ok({ id: DEF_ID }));

    await saveWorkflowDefinition(draft());
    const [row] = (db.lastChain("workflow_definitions")?.argsOf("insert") ?? []) as [
      Record<string, unknown>,
    ];
    expect(row.created_by).toBeNull();
  });

  it("błąd rpc current_tenant_id przerywa zapis PRZED INSERT-em", async () => {
    rpc.mockResolvedValue({ data: null, error: new Error("rpc down") });
    await expect(saveWorkflowDefinition(draft())).rejects.toThrow("rpc down");
    // Żaden wiersz nie poszedł do bazy - inaczej wpadłby tam tenant_id: null.
    expect(db.chainsFor("workflow_definitions")).toHaveLength(0);
  });

  it("brak tenanta dla użytkownika to wyjątek, nie INSERT z tenant_id: null", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(saveWorkflowDefinition(draft())).rejects.toThrow(
      "workflows: no tenant for current user",
    );
    expect(db.chainsFor("workflow_definitions")).toHaveLength(0);
  });

  it("błąd INSERT propaguje wyjątkiem", async () => {
    rpc.mockResolvedValue({ data: TENANT, error: null });
    db.setResponse("workflow_definitions", fail("duplicate key"));
    await expect(saveWorkflowDefinition(draft())).rejects.toThrow("duplicate key");
  });
});

describe("setWorkflowEnabled", () => {
  it("przełącza wyłącznie `enabled` (plus stempel czasu)", async () => {
    db.setResponse("workflow_definitions", ok(null));
    await setWorkflowEnabled(DEF_ID, false);
    const chain = db.lastChain("workflow_definitions");
    const [patch] = (chain?.argsOf("update") ?? []) as [Record<string, unknown>];
    expect(patch.enabled).toBe(false);
    // Patch nie może nieść nic poza tymi dwiema kolumnami - szeroki UPDATE
    // z ekranu listy nadpisałby warunek i kroki wartościami, których ta lista
    // nawet nie wczytuje (klasa defektu K10 z audytu treści).
    expect(Object.keys(patch).sort()).toEqual(["enabled", "updated_at"]);
    expect(chain?.argsOf("eq")).toEqual(["id", DEF_ID]);
  });

  it("błąd propaguje wyjątkiem", async () => {
    db.setResponse("workflow_definitions", fail("nope"));
    await expect(setWorkflowEnabled(DEF_ID, true)).rejects.toThrow("nope");
  });
});

describe("deleteWorkflowDefinition", () => {
  it("usuwa dokładnie jeden wiersz po id", async () => {
    db.setResponse("workflow_definitions", ok(null));
    await deleteWorkflowDefinition(DEF_ID);
    const chain = db.lastChain("workflow_definitions");
    expect(chain?.has("delete")).toBe(true);
    expect(chain?.argsOf("eq")).toEqual(["id", DEF_ID]);
  });

  it("błąd propaguje wyjątkiem", async () => {
    db.setResponse("workflow_definitions", fail("fk violation"));
    await expect(deleteWorkflowDefinition(DEF_ID)).rejects.toThrow("fk violation");
  });
});

// ---------------------------------------------------------------------------
// Ślad korelacji: komenda -> zdarzenia -> workflowy -> dostawy integracji.
// ---------------------------------------------------------------------------

const EVENT_A = { id: "event-a", created_at: "2026-08-18T10:00:00.000Z" };
const EVENT_B = { id: "event-b", created_at: "2026-08-18T10:00:01.000Z" };

describe("fetchCorrelationTrace", () => {
  it("składa trzy warstwy śladu i przycina correlation_id na wejściu", async () => {
    rpc.mockResolvedValue({ data: [EVENT_A, EVENT_B], error: null });
    db.setResponse("workflow_runs", ok([{ id: "run-1", event_id: "event-a" }]));
    db.setResponse("integration_deliveries", ok([{ id: "del-1", event_id: "event-b" }]));

    const trace = await fetchCorrelationTrace(`  ${CORRELATION}  `);

    expect(trace.correlationId).toBe(CORRELATION);
    expect(trace.events).toEqual([EVENT_A, EVENT_B]);
    expect(trace.runs).toEqual([{ id: "run-1", event_id: "event-a" }]);
    expect(trace.deliveries).toEqual([{ id: "del-1", event_id: "event-b" }]);

    // Wartość przycięta idzie do WSZYSTKICH trzech zapytań - inaczej wklejony
    // ze spacją uuid znajdowałby zdarzenia, ale nie przebiegi.
    expect(rpc).toHaveBeenCalledWith("get_correlated_events", {
      p_correlation_id: CORRELATION,
    });
    expect(db.lastChain("workflow_runs")?.argsOf("eq")).toEqual(["correlation_id", CORRELATION]);
    // Dostawy są przypięte do ZDARZEŃ śladu, nie do correlation_id (outbox nie
    // nosi tej kolumny).
    expect(db.lastChain("integration_deliveries")?.argsOf("in")).toEqual([
      "event_id",
      ["event-a", "event-b"],
    ]);
  });

  it("oś czasu rośnie: przebiegi sortowane rosnąco po dacie", async () => {
    rpc.mockResolvedValue({ data: [EVENT_A], error: null });
    db.setResponse("workflow_runs", ok([]));
    db.setResponse("integration_deliveries", ok([]));
    await fetchCorrelationTrace(CORRELATION);
    expect(db.lastChain("workflow_runs")?.argsOf("order")).toEqual([
      "created_at",
      { ascending: true },
    ]);
  });

  it("ślad bez zdarzeń NIE odpytuje outboxu", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    db.setResponse("workflow_runs", ok([]));

    const trace = await fetchCorrelationTrace(CORRELATION);

    expect(trace.deliveries).toEqual([]);
    // `.in("event_id", [])` to zapytanie po CAŁEJ tabeli dostaw - warunek
    // `events.length > 0` jest tu jedyną zaporą, więc ma własny test.
    expect(db.chainsFor("integration_deliveries")).toHaveLength(0);
  });

  it("`data: null` w każdej warstwie daje pustą listę", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    db.setResponse("workflow_runs", { data: null, error: null });

    const trace = await fetchCorrelationTrace(CORRELATION);

    expect(trace.events).toEqual([]);
    expect(trace.runs).toEqual([]);
    expect(trace.deliveries).toEqual([]);
  });

  it("`data: null` w samych dostawach też daje pustą listę", async () => {
    // Osobny przypadek od tego wyżej: tam pusta lista zdarzeń w ogóle nie
    // pozwala dojść do outboxu, więc ramię `?? []` przy dostawach zostawało
    // nietknięte. Panel woła `.map()` na tej liście.
    rpc.mockResolvedValue({ data: [EVENT_A], error: null });
    db.setResponse("workflow_runs", ok([]));
    db.setResponse("integration_deliveries", { data: null, error: null });

    await expect(fetchCorrelationTrace(CORRELATION)).resolves.toMatchObject({ deliveries: [] });
  });

  it("błąd którejkolwiek warstwy przerywa cały ślad", async () => {
    // Zdarzenia.
    rpc.mockResolvedValue({ data: null, error: new Error("rpc denied") });
    db.setResponse("workflow_runs", ok([]));
    await expect(fetchCorrelationTrace(CORRELATION)).rejects.toThrow("rpc denied");

    // Przebiegi.
    db.reset();
    rpc.mockResolvedValue({ data: [EVENT_A], error: null });
    db.setResponse("workflow_runs", fail("runs denied"));
    await expect(fetchCorrelationTrace(CORRELATION)).rejects.toThrow("runs denied");

    // Dostawy.
    db.reset();
    db.setResponse("workflow_runs", ok([]));
    db.setResponse("integration_deliveries", fail("deliveries denied"));
    await expect(fetchCorrelationTrace(CORRELATION)).rejects.toThrow("deliveries denied");
  });

  it("wybiera z outboxu wyłącznie kolumny panelu (bez ciała żądania/odpowiedzi)", async () => {
    rpc.mockResolvedValue({ data: [EVENT_A], error: null });
    db.setResponse("workflow_runs", ok([]));
    db.setResponse("integration_deliveries", ok([]));

    await fetchCorrelationTrace(CORRELATION);

    const [projection] = (db.lastChain("integration_deliveries")?.argsOf("select") ?? []) as [
      string,
    ];
    // Ładunki webhooków mogą nieść dane osobowe - panel śladu ich nie pokazuje,
    // więc nie mają prawa nawet opuścić bazy.
    expect(projection).not.toContain("payload");
    expect(projection).not.toContain("request_body");
    expect(projection).not.toContain("response_body");
    expect(projection).toContain("integration_endpoints(name)");
  });
});

// Kontrola higieny atrapy: gdyby `supabaseFromStub` cicho zwracał pustą listę
// dla tabeli bez zaplanowanej odpowiedzi, połowa asercji wyżej przechodziłaby
// przypadkiem. Ten test dowodzi, że brak planu to BŁĄD.
describe("higiena atrapy", () => {
  it("tabela bez zaplanowanej odpowiedzi kończy się błędem, nie pustką", async () => {
    const result: SupabaseResult = await (db.from(
      "workflow_definitions",
    ) as PromiseLike<SupabaseResult>);
    expect(result.error).not.toBeNull();
    expect(result.error?.message).toContain("brak zaplanowanej odpowiedzi");
  });
});
