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
import {
  ok,
  fail,
  supabaseFromStub,
  type RecordedChain,
  type SupabaseResult,
} from "@/test/supabaseChain";
import { decodeOrParam, runRecordedChain } from "@/test/supabase/postgrestGrammar";
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

import { APP_ROLES } from "@/lib/authz/roles";
import * as crm from "@/lib/crm.functions";
import { RPC_SHAPES } from "@/lib/journeys/__tests__/rpcShapes.fixture";

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
    // Realistyczne claimy: Supabase w tym projekcie NIE wzbogaca tokenu o
    // `tenant_id` (brak custom access token hooka), więc atrapa też nie może.
    claims: { sub: USER_ID, aal: "aal1" },
  };
}

const parsed = (result: unknown): unknown => JSON.parse((result as { json: string }).json);

/**
 * Lookup awatara w dwóch zapytaniach na porcję, oba z drzewem `.or(...)`
 * odczytanym portem parsera PostgREST: adres logowania (jeden liść
 * `email.in.(...)`) i adres kontaktowy (liście `contact_email.*`).
 */
const orLeaves = (chain: RecordedChain) => decodeOrParam(`(${String(chain.argsOf("or")?.[0])})`);
const avatarChainKind = (chain: RecordedChain): "email" | "contact_email" => {
  if (chain.has("in") || chain.calls.filter((c) => c.method === "or").length !== 1) {
    throw new Error("nieznany kształt zapytania o awatar");
  }
  const columns = new Set(orLeaves(chain).map((f) => f.column));
  if (columns.size === 1 && columns.has("email") && orLeaves(chain).length === 1) return "email";
  if (columns.size === 1 && columns.has("contact_email")) return "contact_email";
  throw new Error("nieznany kształt zapytania o awatar");
};
const contactLeaves = orLeaves;
/** Wartości listy `email.in.(...)` zapytania o adres logowania. */
const loginValues = (chain: RecordedChain): string[] => {
  const [leaf] = orLeaves(chain);
  if (leaf?.op !== "in" || leaf.column !== "email") throw new Error("oczekiwano email.in");
  return leaf.values;
};

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
  // Zdjęcie członka na karcie kontaktu. Do 2026-11-16 karta pytała `profiles`
  // o `email`/`contact_email` klientem wołającego - te kolumny nie mają grantu
  // dla `authenticated` (20260724090100), więc PostgREST odrzucał całe
  // zapytanie (42501), a pusty `catch` dawał brak zdjęcia na KAŻDEJ karcie.
  // Atrapa oddawała wtedy wiersz, którego prawdziwa baza nie wyda. Teraz karta
  // idzie tą samą ścieżką co lista (`getCrmLeadAvatars`): tenant z sesji,
  // lookup spod service-role zawężony do tego tenanta.
  const LEAD = {
    id: LEAD_ID,
    email: "Anna@Example.test",
    email_norm: "anna@example.test",
    tenant_id: TENANT,
  };
  const AVATAR = "https://cdn.test/anna.png";
  const avatarOf = (result: unknown) =>
    (parsed(result) as { profile_avatar_url: unknown }).profile_avatar_url;

  /** Lead + cztery źródła karty puste + tenant wołającego z jego profilu (RLS). */
  const planCard = (row: unknown = LEAD, callerTenant: unknown = { tenant_id: TENANT }) => {
    lead.setResponse("crm_leads", () => ok(row));
    for (const table of [
      "contact_messages",
      "newsletter_subscribers",
      "crm_consent_log",
      "crm_lead_notes",
    ]) {
      lead.setResponse(table, () => ok([]));
    }
    lead.setResponse("profiles", () => ok(callerTenant));
  };

  it("bramka staffu CRM zostaje na funkcji (lookup spod service-role nie jest publiczny)", () => {
    expect(serverFnMiddlewareNames(crm.getCrmLead)).toEqual(["requireCrmStaff"]);
  });

  it("składa kartę kontaktu z pięciu źródeł i dokleja avatar członka o adresie leada", async () => {
    planCard();
    lead.setResponse("contact_messages", () => ok([{ id: "m1" }]));
    lead.setResponse("newsletter_subscribers", () => ok([{ id: "s1" }]));
    lead.setResponse("crm_consent_log", () => ok([{ id: "c1" }]));
    lead.setResponse("crm_lead_notes", () => ok([{ id: "n1" }]));
    admin.setResponse("profiles", (chain) =>
      avatarChainKind(chain) === "email"
        ? ok([{ email: "anna@example.test", contact_email: null, avatar_url: AVATAR }])
        : ok([]),
    );

    const result = await callServerFn(crm.getCrmLead, {
      data: { id: LEAD_ID },
      context: context(),
    });
    expect(parsed(result)).toMatchObject({
      messages: [{ id: "m1" }],
      subscriptions: [{ id: "s1" }],
      consents: [{ id: "c1" }],
      notes: [{ id: "n1" }],
      profile_avatar_url: AVATAR,
    });
  });

  it("klient wołającego nie pyta o kolumny bez grantu - tylko o własny tenant", async () => {
    planCard();
    admin.setResponse("profiles", () => ok([]));

    await callServerFn(crm.getCrmLead, { data: { id: LEAD_ID }, context: context() });

    // Jedyny odczyt `profiles` klientem użytkownika: własny wiersz, kolumna z grantem.
    const own = lead.chainsFor("profiles");
    expect(own.map((chain) => chain.argsOf("select"))).toEqual([["tenant_id"]]);
    expect(own[0]?.argsOf("eq")).toEqual(["id", USER_ID]);
  });

  it("lookup spod service-role stoi na tenancie wołającego, adresy biorą się z leada", async () => {
    planCard();
    admin.setResponse("profiles", () => ok([]));

    await callServerFn(crm.getCrmLead, { data: { id: LEAD_ID }, context: context() });

    const chains = admin.chainsFor("profiles");
    expect(chains.map(avatarChainKind).sort()).toEqual(["contact_email", "email"]);
    for (const chain of chains) {
      expect(chain.argsOf("select")).toEqual(["email, contact_email, avatar_url"]);
      expect(chain.argsOf("eq")).toEqual(["tenant_id", TENANT]);
      expect(chain.argsOf("not")).toEqual(["avatar_url", "is", null]);
    }
    // Adres leada `Anna@Example.test`: logowanie dokładnie (z auth, małymi
    // literami), kontakt bez wielkości liter - jeden liść `ilike`.
    const byKind = Object.fromEntries(chains.map((c) => [avatarChainKind(c), c]));
    expect(loginValues(byKind.email as RecordedChain)).toEqual(["anna@example.test"]);
    expect(contactLeaves(byKind.contact_email as RecordedChain)).toEqual([
      { column: "contact_email", negated: false, op: "ilike", value: "anna@example.test" },
    ]);
  });

  it("odpowiedź nie niesie adresów profilu - tylko avatar_url", async () => {
    planCard();
    admin.setResponse("profiles", () =>
      ok([{ email: "inny@example.test", contact_email: "Anna@Example.test", avatar_url: AVATAR }]),
    );

    const result = await callServerFn(crm.getCrmLead, {
      data: { id: LEAD_ID },
      context: context(),
    });
    expect(avatarOf(result)).toBe(AVATAR);
    expect(JSON.stringify(result)).not.toContain("inny@example.test");
  });

  it("lead innego najemcy niż wołający: bez lookupu spod service-role, inicjały", async () => {
    planCard({ ...LEAD, tenant_id: "66666666-6666-4666-8666-666666666666" });

    const result = await callServerFn(crm.getCrmLead, {
      data: { id: LEAD_ID },
      context: context(),
    });
    expect(avatarOf(result)).toBeNull();
    expect(admin.chains).toHaveLength(0);
  });

  it("bez tenanta w profilu wołającego: ODMOWA lookupu (bez service-role), karta działa, błąd w logu", async () => {
    planCard(LEAD, null);
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const result = await callServerFn(crm.getCrmLead, {
        data: { id: LEAD_ID },
        context: context(),
      });
      expect(avatarOf(result)).toBeNull();
      expect(admin.chains).toHaveLength(0);
      expect(logged).toHaveBeenCalledWith("[crm] lead avatar lookup failed", {
        leadId: LEAD_ID,
        error: "tenant_unresolved",
      });
    } finally {
      logged.mockRestore();
    }
  });

  it("błąd lookupu nie wywraca karty, ale nie znika po cichu - trafia do logu bez adresu", async () => {
    planCard();
    admin.setResponse("profiles", () => fail("connection reset", "08006"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const result = await callServerFn(crm.getCrmLead, {
        data: { id: LEAD_ID },
        context: context(),
      });
      expect(avatarOf(result)).toBeNull();
      expect(logged).toHaveBeenCalledTimes(1);
      expect(logged).toHaveBeenCalledWith("[crm] lead avatar lookup failed", {
        leadId: LEAD_ID,
        error: "connection reset",
      });
      expect(JSON.stringify(logged.mock.calls)).not.toContain("example.test");
    } finally {
      logged.mockRestore();
    }
  });

  it("brak leada to błąd, a nie pusta karta", async () => {
    lead.setResponse("crm_leads", () => ok(null));
    await expect(
      callServerFn(crm.getCrmLead, { data: { id: LEAD_ID }, context: context() }),
    ).rejects.toThrow("Lead not found");
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

  it("zachowuje całą wiadomość formularza w osi czasu i eksporcie", async () => {
    timelineSources();
    const message = "Pełna treść\n" + "x".repeat(7900) + "\nKONIEC";
    lead.setResponse("contact_messages", () =>
      ok([
        {
          id: "long",
          form_type: "contact_form",
          subject: "Temat",
          message,
          created_at: "2026-08-01T10:00:00.000Z",
          lang: "pl",
          page_url: "/kontakt",
        },
      ]),
    );
    const result = await callServerFn(crm.getCrmLeadTimeline, {
      data: { id: LEAD_ID },
      context: context(),
    });
    const { events } = parsed(result) as { events: Array<{ type: string; detail: string }> };
    expect(events.find((event) => event.type === "submit")?.detail).toBe(`Temat\n\n${message}`);
  });

  it("zachowuje pełną treść zgody", async () => {
    timelineSources();
    const consent = "Zgoda " + "x".repeat(600) + " KONIEC";
    lead.setResponse("crm_consent_log", () =>
      ok([
        {
          id: "long-consent",
          consent_key: "rodo",
          given: true,
          consent_text: consent,
          created_at: "2026-08-03T10:00:00.000Z",
        },
      ]),
    );
    const result = await callServerFn(crm.getCrmLeadTimeline, {
      data: { id: LEAD_ID },
      context: context(),
    });
    const { events } = parsed(result) as { events: Array<{ type: string; detail: string }> };
    expect(events.find((event) => event.type === "consent")?.detail).toBe(consent);
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

  it("zdarzenie audytu z modułu Wydarzeń (`event.*`) to typ „event” z polskim zdaniem i pełnym kontraktem", async () => {
    // Bez tego wpis „zgłosił wystąpienie" stał na osi jako „Zmiana etapu".
    timelineSources();
    const metadata = {
      event_id: "3f1a0c8e-0000-4000-8000-000000000042",
      event_slug: "kongres-cee-2026",
      summary_pl: "Zgłoszenie wystąpienia",
      summary_en: "Talk submitted",
    };
    lead.setResponse("audit_log", () =>
      ok([
        {
          id: "a3",
          action: "event.cfp.submitted",
          actor_id: null,
          metadata,
          // Najpozniejszy wpis osi (bez nowego literalu daty w pliku).
          created_at: new Date(Date.UTC(2026, 7, 6, 10)).toISOString(),
        },
      ]),
    );
    const result = await callServerFn(crm.getCrmLeadTimeline, {
      data: { id: LEAD_ID },
      context: context(),
    });
    const { events } = parsed(result) as {
      events: Array<{ id: string; type: string; title: string; meta: unknown }>;
    };
    expect(events[0]).toMatchObject({
      id: "au:a3",
      type: "event",
      title: "Zgłoszenie wystąpienia",
    });
    // Wersja angielska zostaje w metadanych - widok wybiera zdanie w swoim języku.
    expect(events[0].meta).toEqual(metadata);
  });

  // Integrator S8 (SPEC §2.7): zapisy kontaktu do ścieżek komunikacji na osi -
  // z RPC S5 (najemca z sesji, w payloadzie tylko lead), bez własnego SQL.
  it("zapisy do ścieżek z RPC S5 to wpisy „journey” (wejście i koniec) z kontraktem w `meta`", async () => {
    timelineSources();
    rpcResults.admin_journey_lead_enrollments = ok(RPC_SHAPES.leadEnrollments);
    const result = await callServerFn(crm.getCrmLeadTimeline, {
      data: { id: LEAD_ID },
      context: context(),
    });
    expect(rpcCalls).toContainEqual({
      fn: "admin_journey_lead_enrollments",
      args: { p_lead_id: LEAD_ID },
    });
    const { events } = parsed(result) as {
      events: Array<{ id: string; type: string; title: string; meta: Record<string, unknown> }>;
    };
    const journeys = events.filter((e) => e.type === "journey");
    const enrollmentId = RPC_SHAPES.leadEnrollments[0].enrollment_id;
    expect(journeys.map((e) => e.id).sort()).toEqual([
      `jr:${enrollmentId}:in`,
      `jr:${enrollmentId}:out`,
    ]);
    const out = journeys.find((e) => e.id.endsWith(":out"));
    expect(out?.title).toBe("Ścieżka „Porzucona kasa (v1)” (test): Wyszedł - Wyjęty ręcznie");
    expect(out?.meta).toMatchObject({
      journey_id: RPC_SHAPES.leadEnrollments[0].journey_id,
      enrollment_id: enrollmentId,
      status: "exited",
      exit_reason: "manual",
      summary_en: "Journey “Porzucona kasa (v1)” (test): Left - Removed by staff",
    });
  });

  it.each([
    ["odmowa roli (42501)", fail("permission denied", "42501")],
    ["kształt spoza kontraktu", ok([{ enrollment_id: 1 }])],
  ])("ścieżki są dodatkiem osi: %s nie psuje kroniki", async (_case, response) => {
    timelineSources();
    rpcResults.admin_journey_lead_enrollments = response;
    const result = await callServerFn(crm.getCrmLeadTimeline, {
      data: { id: LEAD_ID },
      context: context(),
    });
    const { events } = parsed(result) as { events: Array<{ type: string }> };
    expect(events).toHaveLength(6);
    expect(events.some((e) => e.type === "journey")).toBe(false);
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

  it("odznaczenie zgody marketingowej idzie RPC z wierszem given=false, nie gołym UPDATE (R12)", async () => {
    // Gołe `marketing_consent = false` nie zostawiało śladu w rejestrze zgód
    // i most wydarzeń włączał zgodę z powrotem przy następnym wywołaniu.
    rpcResults.crm_leads_marketing_consent_withdraw = ok(2);
    lead.setResponse("crm_leads", () => ok(null));
    lead.setResponse("audit_log", () => ok(null));
    const result = await callServerFn<{ updated: number }>(crm.bulkUpdateCrmLeads, {
      data: { ids: [LEAD_ID, OTHER_ID], marketing_consent: false },
      context: context(),
    });
    expect(rpcCalls).toEqual([
      { fn: "crm_leads_marketing_consent_withdraw", args: { p_lead_ids: [LEAD_ID, OTHER_ID] } },
    ]);
    // Żadnej łatki `crm_leads` z polem zgody - RPC robi UPDATE i wpis rejestru.
    expect(lead.chainsFor("crm_leads").filter((c) => c.has("update"))).toHaveLength(0);
    expect(result.updated).toBe(2);
    const audit = lead.lastChain("audit_log")?.argsOf("insert")?.[0] as {
      metadata: { fields: string[] };
    };
    expect(audit.metadata.fields).toEqual(["marketing_consent"]);
  });

  it("odznaczenie razem z etapem: etap łatką, zgoda RPC", async () => {
    rpcResults.crm_leads_marketing_consent_withdraw = ok(1);
    lead.setResponse("crm_leads", () => ok(null));
    lead.setResponse("audit_log", () => ok(null));
    await callServerFn(crm.bulkUpdateCrmLeads, {
      data: { ids: [LEAD_ID], stage: "contacted", marketing_consent: false },
      context: context(),
    });
    expect(rpcCalls.map((call) => call.fn)).toEqual(["crm_leads_marketing_consent_withdraw"]);
    expect(lead.lastChain("crm_leads")?.argsOf("update")).toEqual([{ stage: "contacted" }]);
  });

  it("zaznaczenie zgody zostaje zwykłą łatką - bez RPC wycofania", async () => {
    lead.setResponse("crm_leads", () => ok(null));
    lead.setResponse("audit_log", () => ok(null));
    await callServerFn(crm.bulkUpdateCrmLeads, {
      data: { ids: [LEAD_ID], marketing_consent: true },
      context: context(),
    });
    expect(rpcCalls).toEqual([]);
    expect(lead.lastChain("crm_leads")?.argsOf("update")).toEqual([{ marketing_consent: true }]);
  });

  it.each(["PGRST202", "42883"])(
    "okno wdrożenia (%s): baza bez RPC - dotychczasowy UPDATE",
    async (code) => {
      rpcResults.crm_leads_marketing_consent_withdraw = fail("function not found", code);
      lead.setResponse("crm_leads", () => ok(null));
      lead.setResponse("audit_log", () => ok(null));
      await callServerFn(crm.bulkUpdateCrmLeads, {
        data: { ids: [LEAD_ID], marketing_consent: false },
        context: context(),
      });
      expect(lead.lastChain("crm_leads")?.argsOf("update")).toEqual([{ marketing_consent: false }]);
    },
  );

  it("inny błąd RPC wycofania wychodzi na zewnątrz - bez cichej łatki", async () => {
    rpcResults.crm_leads_marketing_consent_withdraw = fail("forbidden: CRM staff role required");
    lead.setResponse("crm_leads", () => ok(null));
    await expect(
      callServerFn(crm.bulkUpdateCrmLeads, {
        data: { ids: [LEAD_ID], marketing_consent: false },
        context: context(),
      }),
    ).rejects.toThrow("forbidden");
    expect(lead.chainsFor("crm_leads")).toHaveLength(0);
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
  it("czyta role i profile zawężone do tenanta z profilu wołającego", async () => {
    lead.setResponse("profiles", () => ok({ tenant_id: TENANT }));
    admin.setResponse("user_roles", () => ok([{ user_id: USER_ID, role: "admin" }]));
    admin.setResponse("profiles", () => ok([{ id: USER_ID, display_name: "Anna" }]));
    const result = await callServerFn(crm.listStaffUsers, { context: context() });
    expect(parsed(result)).toEqual([{ id: USER_ID, display_name: "Anna" }]);
    // OBA zapytania spod service-role muszą być zawężone - `user_roles` bez
    // filtru wydawało mapę tożsamości staffu wszystkich najemców.
    expect(admin.lastChain("user_roles")?.argsOf("eq")).toEqual(["tenant_id", TENANT]);
    expect(admin.lastChain("profiles")?.argsOf("eq")).toEqual(["tenant_id", TENANT]);
  });

  it("brak staffu oddaje pustą listę bez pytania o profile", async () => {
    lead.setResponse("profiles", () => ok({ tenant_id: TENANT }));
    admin.setResponse("user_roles", () => ok([]));
    const result = await callServerFn(crm.listStaffUsers, { context: context() });
    expect(parsed(result)).toEqual([]);
    expect(admin.chainsFor("profiles")).toHaveLength(0);
  });

  it("bez tenanta w profilu ODMAWIA, zamiast listować wszystkich", async () => {
    // Regresja: wcześniej tenanta czytano z claimów JWT, których Supabase w tym
    // projekcie nie wzbogaca (brak custom access token hooka) - warunek zawsze
    // schodził na gałąź bez filtru i picker sięgałby po staff WSZYSTKICH
    // najemców spod service-role. Poprzedni test przypinał ten brak filtru jako
    // KONTRAKT (`expect(admin.lastChain("profiles")?.has("eq")).toBe(false)`) -
    // dlatego został usunięty, a nie "naprawiony".
    lead.setResponse("profiles", () => ok(null));
    await expect(callServerFn(crm.listStaffUsers, { context: context() })).rejects.toThrow(
      "tenant_unresolved",
    );
    expect(admin.chainsFor("user_roles")).toHaveLength(0);
    expect(admin.chainsFor("profiles")).toHaveLength(0);
  });

  it("filtruje wyłącznie po wartościach enuma app_role", async () => {
    // 'moderator' NIE jest wartością public.app_role (to rola klubowa).
    // PostgREST rzutuje literały z in.() na typ kolumny, więc taki filtr kończy
    // się 22P02 i - przy połykaniu błędu - cichą pustą listą.
    lead.setResponse("profiles", () => ok({ tenant_id: TENANT }));
    admin.setResponse("user_roles", () => ok([{ user_id: USER_ID, role: "admin" }]));
    admin.setResponse("profiles", () => ok([{ id: USER_ID }]));
    await callServerFn(crm.listStaffUsers, { context: context() });
    const roles = admin.lastChain("user_roles")?.argsOf("in")?.[1] as string[];
    expect(roles.every((r) => (APP_ROLES as readonly string[]).includes(r))).toBe(true);
  });

  it("błąd odczytu ról wychodzi na zewnątrz, nie zamienia się w pustą listę", async () => {
    lead.setResponse("profiles", () => ok({ tenant_id: TENANT }));
    admin.setResponse("user_roles", () => fail("invalid input value for enum app_role"));
    await expect(callServerFn(crm.listStaffUsers, { context: context() })).rejects.toThrow(
      "invalid input value for enum app_role",
    );
  });
});

describe("getCrmLeadAvatars", () => {
  // Wcześniej lista pytała o `profiles.email`/`contact_email` klientem
  // przeglądarki. Te kolumny nie mają grantu SELECT dla `authenticated`, więc
  // PostgREST odrzucał całe zapytanie (42501), a ignorowany `error` dawał
  // listę bez zdjęć. Teraz lookup idzie tu: service-role, zawężony do tenanta.
  const SECOND_ID = "55555555-5555-4555-8555-555555555555";
  const avatarsOf = (result: unknown) => (result as { avatars: unknown[] }).avatars;

  const planTenantAndLeads = (leads: unknown[]) => {
    lead.setResponse("profiles", () => ok({ tenant_id: TENANT }));
    lead.setResponse("crm_leads", () => ok(leads));
  };

  it("dopasowuje zdjęcia po e-mailu i oddaje je po id leada", async () => {
    planTenantAndLeads([
      { id: LEAD_ID, email: "Anna@Example.test", email_norm: "anna@example.test" },
      { id: SECOND_ID, email: "bartek@example.test", email_norm: "bartek@example.test" },
    ]);
    admin.setResponse("profiles", (chain) =>
      avatarChainKind(chain) === "email"
        ? ok([
            {
              email: "anna@example.test",
              contact_email: null,
              avatar_url: "https://cdn.test/a.png",
            },
          ])
        : ok([
            {
              email: "inny@example.test",
              contact_email: "bartek@example.test",
              avatar_url: "https://cdn.test/b.png",
            },
          ]),
    );
    const result = await callServerFn(crm.getCrmLeadAvatars, {
      data: { lead_ids: [LEAD_ID, SECOND_ID] },
      context: context(),
    });
    expect(avatarsOf(result)).toEqual([
      { lead_id: LEAD_ID, avatar_url: "https://cdn.test/a.png" },
      { lead_id: SECOND_ID, avatar_url: "https://cdn.test/b.png" },
    ]);
  });

  it("OBA zapytania stoją na tenancie wołającego - spod service-role to jedyna granica", async () => {
    planTenantAndLeads([
      { id: LEAD_ID, email: "anna@example.test", email_norm: "anna@example.test" },
    ]);
    admin.setResponse("profiles", () => ok([]));
    await callServerFn(crm.getCrmLeadAvatars, {
      data: { lead_ids: [LEAD_ID] },
      context: context(),
    });
    // Leady: user-scoped klient (RLS) + jawny filtr tenanta + id z wejścia.
    const leadChain = lead.lastChain("crm_leads");
    expect(leadChain?.argsOf("eq")).toEqual(["tenant_id", TENANT]);
    expect(leadChain?.argsOf("in")).toEqual(["id", [LEAD_ID]]);
    // Profile: po jednym zapytaniu na kolumnę adresu, każde zawężone do tenanta.
    const profileChains = admin.chainsFor("profiles");
    expect(profileChains.map(avatarChainKind).sort()).toEqual(["contact_email", "email"]);
    for (const chain of profileChains) {
      expect(chain.argsOf("eq")).toEqual(["tenant_id", TENANT]);
      expect(chain.argsOf("not")).toEqual(["avatar_url", "is", null]);
    }
  });

  it("adresy do lookupu pochodzą z leadów tenanta, nie z wejścia", async () => {
    // Wejściem są id. Endpoint przyjmujący adresy byłby wyrocznią „czy ten
    // e-mail należy do członka" - obejściem grantu kolumnowego.
    planTenantAndLeads([
      { id: LEAD_ID, email: " Anna@Example.test ", email_norm: "anna@example.test" },
    ]);
    admin.setResponse("profiles", () => ok([]));
    await callServerFn(crm.getCrmLeadAvatars, {
      data: { lead_ids: [LEAD_ID] },
      context: context(),
    });
    const chains = admin.chainsFor("profiles");
    expect(chains).toHaveLength(2);
    for (const chain of chains) {
      if (avatarChainKind(chain) === "email") {
        expect(loginValues(chain)).toEqual(["anna@example.test"]);
      } else {
        expect(contactLeaves(chain).map((f) => (f.op === "ilike" ? f.value : null))).toEqual([
          "anna@example.test",
        ]);
      }
    }
  });

  it("odpowiedź nie niesie adresów profilu - tylko id leada i avatar_url", async () => {
    planTenantAndLeads([
      { id: LEAD_ID, email: "anna@example.test", email_norm: "anna@example.test" },
    ]);
    admin.setResponse("profiles", () =>
      ok([
        {
          email: "anna@example.test",
          contact_email: "prywatny@example.test",
          avatar_url: "https://cdn.test/a.png",
        },
      ]),
    );
    const result = await callServerFn(crm.getCrmLeadAvatars, {
      data: { lead_ids: [LEAD_ID] },
      context: context(),
    });
    expect(JSON.stringify(result)).not.toContain("prywatny@example.test");
  });

  it("pusta strona nie pyta bazy w ogóle", async () => {
    const result = await callServerFn(crm.getCrmLeadAvatars, {
      data: { lead_ids: [] },
      context: context(),
    });
    expect(avatarsOf(result)).toEqual([]);
    expect(lead.chains).toHaveLength(0);
    expect(admin.chains).toHaveLength(0);
  });

  it("bez tenanta w profilu ODMAWIA, zanim dotknie profili spod service-role", async () => {
    lead.setResponse("profiles", () => ok(null));
    await expect(
      callServerFn(crm.getCrmLeadAvatars, { data: { lead_ids: [LEAD_ID] }, context: context() }),
    ).rejects.toThrow("tenant_unresolved");
    expect(lead.chainsFor("crm_leads")).toHaveLength(0);
    expect(admin.chains).toHaveLength(0);
  });

  it("id spoza tenanta (zero leadów) nie uruchamia lookupu profili", async () => {
    planTenantAndLeads([]);
    const result = await callServerFn(crm.getCrmLeadAvatars, {
      data: { lead_ids: [OTHER_ID] },
      context: context(),
    });
    expect(avatarsOf(result)).toEqual([]);
    expect(admin.chains).toHaveLength(0);
  });

  it("błąd odczytu leadów wychodzi na zewnątrz", async () => {
    lead.setResponse("profiles", () => ok({ tenant_id: TENANT }));
    lead.setResponse("crm_leads", () => fail("permission denied for table crm_leads", "42501"));
    await expect(
      callServerFn(crm.getCrmLeadAvatars, { data: { lead_ids: [LEAD_ID] }, context: context() }),
    ).rejects.toThrow("permission denied for table crm_leads");
  });

  it("błąd odczytu profili wychodzi na zewnątrz, nie zamienia się w brak zdjęć", async () => {
    planTenantAndLeads([
      { id: LEAD_ID, email: "anna@example.test", email_norm: "anna@example.test" },
    ]);
    admin.setResponse("profiles", () => fail("permission denied for table profiles", "42501"));
    await expect(
      callServerFn(crm.getCrmLeadAvatars, { data: { lead_ids: [LEAD_ID] }, context: context() }),
    ).rejects.toThrow("permission denied for table profiles");
  });

  it("dzieli długą stronę na porcje - lista `.in()` jedzie w adresie URL", async () => {
    const ids = Array.from(
      { length: 150 },
      (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    );
    lead.setResponse("profiles", () => ok({ tenant_id: TENANT }));
    lead.setResponse("crm_leads", (chain) =>
      ok(
        (chain.argsOf("in")?.[1] as string[]).map((id) => ({
          id,
          email: `${id}@example.test`,
          email_norm: `${id}@example.test`,
        })),
      ),
    );
    admin.setResponse("profiles", () => ok([]));
    await callServerFn(crm.getCrmLeadAvatars, { data: { lead_ids: ids }, context: context() });
    expect(
      lead.chainsFor("crm_leads").map((c) => (c.argsOf("in")?.[1] as string[]).length),
    ).toEqual([100, 50]);
    // Profile: porcje trzymają LICZBĘ adresów (<= 100) i DŁUGOŚĆ filtra
    // kontaktowego w URL (<= 6000 znaków po kodowaniu, jak w postgrest-js) -
    // liść `ilike` jest kilka razy dłuższy niż wartość w `.in()`.
    const chains = admin.chainsFor("profiles");
    const emailChains = chains.filter((c) => avatarChainKind(c) === "email");
    const contactChains = chains.filter((c) => avatarChainKind(c) === "contact_email");
    expect(emailChains.length).toBe(contactChains.length);
    expect(emailChains.length).toBeGreaterThan(1);
    for (const chain of emailChains) {
      expect(loginValues(chain).length).toBeLessThanOrEqual(100);
    }
    for (const chain of chains) {
      const param = new URLSearchParams([["or", `(${String(chain.argsOf("or")?.[0])})`]]);
      expect(param.toString().length - "or=".length).toBeLessThanOrEqual(6000);
    }
    // Każdy adres dokładnie raz w każdej klasie.
    const expected = ids.map((id) => `${id}@example.test`).sort();
    expect(emailChains.flatMap(loginValues).sort()).toEqual(expected);
    expect(
      contactChains
        .flatMap(contactLeaves)
        .map((f) => (f.op === "ilike" ? f.value : ""))
        .sort(),
    ).toEqual(expected);
  });

  it("walidator odbija id spoza UUID i stronę ponad maksymalny rozmiar", () => {
    expect(() => validateServerFnInput(crm.getCrmLeadAvatars, { lead_ids: ["x"] })).toThrow();
    expect(() =>
      validateServerFnInput(crm.getCrmLeadAvatars, {
        lead_ids: Array.from({ length: 501 }, () => LEAD_ID),
      }),
    ).toThrow();
  });
});

describe("awatar leada: kontakt bez wielkości liter, bez wieloznaczników (lista i karta)", () => {
  // Członek, którego `contact_email` różni się od adresu leada TYLKO wielkością
  // liter (lead anna.kowalska@firma.test, kontakt Anna.Kowalska@Firma.TEST,
  // inny adres logowania), do 2026-11-16 nie dostawał zdjęcia: oba zapytania
  // szły dokładnym `.in()`. Teraz kontakt idzie `ilike` z wzorcem bez
  // wieloznaczników.
  //
  // Atrapa `profiles` WYKONUJE zapisany łańcuch tak, jak PostgREST (port
  // parsera drzewa `or=(...)`, cytowanie postgrest-js w `.in()`, zamiana `*`
  // na `%`, semantyka LIKE/ILIKE z `lower()` bazy - test/supabase/
  // postgrestGrammar.ts; filtry tego testu dają na PG16 te same wiersze).
  //
  // Członkowie „przynęty" (p1-p5, p17, p20) mają MNIEJSZE id niż właściwi, ale
  // SAME zdjęcia przecieku wieloznacznika nie wykażą: wiersz przypisuje się
  // leadowi po WŁASNYM adresie (`pgCaseFold`), więc przynęta przyniesiona przez
  // `_` czy `%` i tak nie dostałaby leada - wynik zdjęć byłby ten sam. Przeciek
  // filtra łapie test wierszy, które atrapa ODDAJE zapytaniu kontaktowemu
  // („przynęty nie wracają z bazy").
  const OTHER_TENANT = "66666666-6666-4666-8666-666666666666";
  const pid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const member = (
    n: number,
    contact_email: string | null,
    over: { email?: string; tenant_id?: string; avatar_url?: string | null } = {},
  ) => ({
    id: pid(n),
    tenant_id: TENANT,
    email: `konto${n}@inna.test`,
    contact_email,
    avatar_url: `https://cdn.test/${n}.png`,
    ...over,
  });
  // Kolejność w tablicy celowo NIE jest kolejnością id (p14 przed p13).
  const MEMBERS = [
    member(0, "Login@Firma.test"),
    member(1, "janXkowalski@firma.test"),
    member(2, "100abcpewny@firma.test"),
    member(3, "ab@firma.test"),
    member(4, "ktokolwiek@firma.test"),
    member(5, "aXYZb@firma.test"),
    member(6, "Anna.Kowalska@Firma.TEST", { tenant_id: OTHER_TENANT }),
    member(7, "Anna.Kowalska@Firma.TEST"),
    member(8, "JAN_KOWALSKI@FIRMA.TEST"),
    member(9, "100%PEWNY@firma.test"),
    member(10, "A\\B@Firma.test"),
    member(11, "a*b@firma.test"),
    member(12, 'O"Neil,(PR):x+1@Firma.test'),
    member(14, "WSPOLNY@firma.test"),
    member(13, "wspolny@firma.test"),
    member(15, null, { email: "login@firma.test" }),
    member(16, "Bez.Zdjecia@firma.test", { avatar_url: null }),
    member(18, "X*Y@FIRMA.TEST"),
    // Poza ASCII baza porównuje SWOIM `lower()` (glibc, znak po znaku), nie
    // JS `toLowerCase`: `lower('İ')` = `i`, `lower('ΟΔΟΣ')` = `οδοσ` (bez `ς`),
    // `lower('ẞ')` = `ß`, `lower('ı')` = `ı` - sprawdzone na PG16.
    member(17, "STRASSE@firma.test"), // `ss` to nie `ß` (mniejsze id niż p24)
    member(19, "ΟΔΟΣ@firma.test"),
    member(20, "ızmir@firma.test"), // kropka-nie-kropka: `ı` to nie `i` (mniejsze id niż p23)
    member(21, "οδοΣ@firma.test"),
    member(23, "İzmir@firma.test"),
    member(24, "STRAẞE@firma.test"),
    member(25, "ILGAZ@firma.test"),
    member(26, "ılgaz@firma.test"),
  ];
  const lid = (n: number) => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const HOSTILE = 'a",contact_email.ilike."%@firma.test';
  // [adres leada, oczekiwany awatar albo null, opcjonalnie `email_norm` z bazy]
  const CASES: ReadonlyArray<readonly [string, string | null, string?]> = [
    ["anna.kowalska@firma.test", "https://cdn.test/7.png"], // tylko wielkość liter
    ["jan_kowalski@firma.test", "https://cdn.test/8.png"], // `_` nie trafia p1
    ["100%pewny@firma.test", "https://cdn.test/9.png"], // `%` nie trafia p2
    ["a\\b@firma.test", "https://cdn.test/10.png"], // `\` nie trafia p3
    ["A*b@Firma.test", null], // `*`: dokładnie, a p11 ma inną wielkość liter
    ["a*b@firma.test", "https://cdn.test/11.png"], // `*`: dokładnie, nie trafia p5
    ["x*y@firma.test", null], // `*` z inną wielkością liter: świadomie bez trafienia
    ['o"neil,(pr):x+1@firma.test', "https://cdn.test/12.png"], // gramatyka PostgREST
    ["Wspolny@Firma.test", "https://cdn.test/13.png"], // kilku członków: najmniejsze id
    ["login@firma.test", "https://cdn.test/15.png"], // logowanie wygrywa z kontaktem p0
    ["bez.zdjecia@firma.test", null], // członek bez zdjęcia
    [HOSTILE, null], // cytat nie domyka się w środku adresu
    // Identyczny adres spoza ASCII. Klucz JS `i̇zmir@` (i + U+0307) w `ILIKE`
    // nie trafia `İzmir@` w bazie - trafia liść z postacią zapisaną.
    ["İzmir@firma.test", "https://cdn.test/23.png"],
    // `email_norm` z `lower(btrim())` bazy (formularze), nie z JS.
    ["İzmir@firma.test", "https://cdn.test/23.png", "izmir@firma.test"],
    ["izmir@firma.test", "https://cdn.test/23.png"], // `lower('İzmir')` = `izmir`; p20 nie
    ["ΟΔΟΣ@firma.test", "https://cdn.test/19.png"], // klucz JS `οδος@` (ς) - liść zapisany
    ["οδοσ@firma.test", "https://cdn.test/19.png"], // p19 i p21 zrównane, najmniejsze id
    // `ς` wpisane w leadzie: baza nie zrównuje go z `Σ` -> brak, choć JS
    // `toLowerCase('ΟΔΟΣ@')` daje dokładnie ten adres.
    ["οδος@firma.test", null],
    ["straße@firma.test", "https://cdn.test/24.png"], // `ẞ` -> `ß`; p17 (`SS`) nie
    ["strasse@firma.test", "https://cdn.test/17.png"], // p24 nie
    ["ılgaz@firma.test", "https://cdn.test/26.png"], // p25 (`I` -> `i`) nie
    ["Ilgaz@firma.test", "https://cdn.test/25.png"], // p26 (`ı`) nie
  ];
  // Dwa leady z tym samym adresem `*` w różnej wielkości liter mają ten sam
  // klucz `a*b@firma.test`, a klucz jest postacią KAŻDEGO z nich - lookup
  // dokładny trafia p11 dla obu (każdy swoją listą, nie listą sąsiada).
  const LEADS = CASES.map(([email, , norm], i) => ({
    id: lid(i),
    email,
    email_norm: norm ?? email.trim().toLowerCase(),
    tenant_id: TENANT,
  }));
  const expectedFor = (i: number) =>
    LEADS[i]?.email_norm === "a*b@firma.test" ? "https://cdn.test/11.png" : CASES[i]?.[1];

  /** Członkowie (numer z `avatar_url`), których atrapa oddała zapytaniom kontaktowym. */
  let servedContact: number[] = [];
  beforeEach(() => {
    servedContact = [];
    admin.setResponse("profiles", (chain) => {
      const rows = runRecordedChain(chain, MEMBERS);
      if (avatarChainKind(chain) === "contact_email") {
        servedContact.push(
          ...rows.map((r) => Number(/\/(\d+)\.png$/.exec(String(r.avatar_url))?.[1])),
        );
      }
      return ok(rows);
    });
  });

  const listAvatars = async () => {
    lead.setResponse("profiles", () => ok({ tenant_id: TENANT }));
    lead.setResponse("crm_leads", () => ok(LEADS.map(({ tenant_id: _t, ...row }) => row)));
    const result = (await callServerFn(crm.getCrmLeadAvatars, {
      data: { lead_ids: LEADS.map((l) => l.id) },
      context: context(),
    })) as { avatars: Array<{ lead_id: string; avatar_url: string }> };
    return new Map(result.avatars.map((a) => [a.lead_id, a.avatar_url]));
  };

  const cardAvatar = async (row: (typeof LEADS)[number]) => {
    lead.setResponse("crm_leads", () => ok(row));
    for (const table of [
      "contact_messages",
      "newsletter_subscribers",
      "crm_consent_log",
      "crm_lead_notes",
    ]) {
      lead.setResponse(table, () => ok([]));
    }
    lead.setResponse("profiles", () => ok({ tenant_id: TENANT }));
    const result = await callServerFn(crm.getCrmLead, { data: { id: row.id }, context: context() });
    return (parsed(result) as { profile_avatar_url: string | null }).profile_avatar_url;
  };

  it("lista: kontakt w innej wielkości liter trafia, wieloznacznik i obcy tenant - nie", async () => {
    const avatars = await listAvatars();
    expect(LEADS.map((l) => avatars.get(l.id) ?? null)).toEqual(
      LEADS.map((_, i) => expectedFor(i) ?? null),
    );
  });

  it("karta pokazuje DOKŁADNIE to samo zdjęcie co lista - dla każdego leada", async () => {
    const avatars = await listAvatars();
    for (const row of LEADS) {
      expect(await cardAvatar(row)).toBe(avatars.get(row.id) ?? null);
    }
  });

  it("przynęty nie wracają z bazy: filtr kontaktu nie przepuszcza wieloznacznika", async () => {
    // p1 `janXkowalski` (dla `_`), p2 `100abcpewny` (`%`), p3 `ab` (`\`),
    // p4 `ktokolwiek` (cytat HOSTILE z `%@firma.test`), p5 `aXYZb` (`*`),
    // p17 `STRASSE` i p20 `ızmir` - przynęty tylko dla kart `straße@` i `izmir@`
    // (`ß` to nie `ss`, `ı` to nie `i`); p17 jest właściwy dla `strasse@`.
    const DECOYS = [1, 2, 3, 4, 5];
    await listAvatars();
    expect(servedContact.filter((n) => DECOYS.includes(n))).toEqual([]);
    // Dokładnie te wiersze, które ten sam filtr zwraca na PG16 (p16 bez zdjęcia
    // odpada na `not avatar_url is null`, p6 - na tenancie).
    expect([...servedContact].sort((a, b) => a - b)).toEqual([
      0, 7, 8, 9, 10, 11, 12, 13, 14, 17, 19, 21, 23, 24, 25, 26,
    ]);

    // Karta pojedynczego leada: wyłącznie właściwy członek, przynęta z mniejszym id - nie.
    const servedForCard = async (email: string) => {
      servedContact = [];
      await cardAvatar(LEADS.find((l) => l.email === email) as (typeof LEADS)[number]);
      return servedContact;
    };
    expect(await servedForCard("jan_kowalski@firma.test")).toEqual([8]);
    expect(await servedForCard("100%pewny@firma.test")).toEqual([9]);
    expect(await servedForCard("a\\b@firma.test")).toEqual([10]);
    expect(await servedForCard("a*b@firma.test")).toEqual([11]);
    expect(await servedForCard(HOSTILE)).toEqual([]);
    expect(await servedForCard("straße@firma.test")).toEqual([24]);
    expect(await servedForCard("izmir@firma.test")).toEqual([23]);
  });

  it("adres droższy niż budżet URL: lead bez zdjęcia (lista i karta), reszta strony działa", async () => {
    // 305 znaków - w limicie importu (320). `İ` daje dwie postaci, `\` po
    // kodowaniu to 12 znaków każdy: jeden klucz to ponad 7 tys. znaków filtra.
    const oversized = `İ${"\\".repeat(299)}@firma.test`;
    const members = [member(40, oversized), member(41, "Anna@Firma.test")];
    admin.setResponse("profiles", (chain) => ok(runRecordedChain(chain, members)));
    const row = (id: string, email: string) => ({ id, email, email_norm: email.toLowerCase() });
    const big = row(lid(300), oversized);
    const anna = row(lid(301), "anna@firma.test");
    lead.setResponse("profiles", () => ok({ tenant_id: TENANT }));
    lead.setResponse("crm_leads", () => ok([big, anna]));
    const result = (await callServerFn(crm.getCrmLeadAvatars, {
      data: { lead_ids: [big.id, anna.id] },
      context: context(),
    })) as { avatars: Array<{ lead_id: string; avatar_url: string }> };
    expect(result.avatars).toEqual([{ lead_id: anna.id, avatar_url: "https://cdn.test/41.png" }]);
    const chains = admin.chainsFor("profiles");
    expect(chains.map(avatarChainKind).sort()).toEqual(["contact_email", "email"]);
    for (const chain of chains) {
      const param = new URLSearchParams([["or", `(${String(chain.argsOf("or")?.[0])})`]]);
      expect(param.toString().length - "or=".length).toBeLessThanOrEqual(6000);
    }

    admin.reset();
    admin.setResponse("profiles", (chain) => ok(runRecordedChain(chain, members)));
    expect(await cardAvatar({ ...big, tenant_id: TENANT })).toBeNull();
    // Karta nie wysyła zapytania, którego proxy by nie przyjęło.
    expect(admin.chainsFor("profiles")).toEqual([]);
  });

  it("strona w kilku porcjach: wybór zdjęcia w obrębie porcji leada, jak na karcie", async () => {
    // Lead `İzmir@` (klucz JS `i̇zmir@`) pasuje do dwóch członków: p30
    // (`İzmir@` rozłożone, I + U+0307 - liść klucza) i p31 (`İzmir@` - liść
    // postaci zapisanej). Lead `izmir@` w PIERWSZEJ porcji przynosi tylko p31
    // (`lower('İ')` = `i`). Wybór po połączeniu porcji dałby leadowi `İzmir@`
    // p31 (wcześniej na liście), karta - p30 (najmniejsze id).
    const members = [member(30, "I\u0307zmir@firma.test"), member(31, "İzmir@firma.test")];
    admin.setResponse("profiles", (chain) => ok(runRecordedChain(chain, members)));
    const row = (id: string, email: string) => ({ id, email, email_norm: email.toLowerCase() });
    const first = row(lid(100), "izmir@firma.test");
    const fillers = Array.from({ length: 100 }, (_, i) =>
      row(lid(200 + i), `wypelniacz${String(i).padStart(3, "0")}@firma.test`),
    );
    const last = row(lid(101), "İzmir@firma.test");
    const page = [first, ...fillers, last];
    lead.setResponse("profiles", () => ok({ tenant_id: TENANT }));
    lead.setResponse("crm_leads", () => ok(page));
    const result = (await callServerFn(crm.getCrmLeadAvatars, {
      data: { lead_ids: page.map((l) => l.id) },
      context: context(),
    })) as { avatars: Array<{ lead_id: string; avatar_url: string }> };
    const list = new Map(result.avatars.map((a) => [a.lead_id, a.avatar_url]));

    // Warunek scenariusza: `izmir@` i `İzmir@` w RÓŻNYCH porcjach.
    const contact = admin
      .chainsFor("profiles")
      .filter((c) => avatarChainKind(c) === "contact_email")
      .map((c) => contactLeaves(c).map((f) => (f.op === "ilike" ? f.value : "")));
    expect(contact.length).toBeGreaterThan(1);
    expect(contact.findIndex((v) => v.includes("izmir@firma.test"))).not.toBe(
      contact.findIndex((v) => v.includes("İzmir@firma.test")),
    );

    expect(list.get(first.id)).toBe("https://cdn.test/31.png");
    expect(list.get(last.id)).toBe("https://cdn.test/30.png");
    expect(await cardAvatar({ ...last, tenant_id: TENANT })).toBe("https://cdn.test/30.png");
    expect(await cardAvatar({ ...first, tenant_id: TENANT })).toBe("https://cdn.test/31.png");
  });

  it("filtr kontaktu: liść na postać adresu leada, `ilike` bez wieloznaczników, `*` tylko dokładnie", async () => {
    await listAvatars();
    const contact = admin
      .chainsFor("profiles")
      .filter((c) => avatarChainKind(c) === "contact_email");
    expect(contact).toHaveLength(1);
    const leaves = contactLeaves(contact[0] as RecordedChain);
    expect(leaves.every((f) => f.column === "contact_email" && !f.negated)).toBe(true);
    for (const leaf of leaves) {
      if (leaf.op === "ilike") {
        // Wzorzec nie ma ANI JEDNEGO wieloznacznika bez ucieczki.
        expect(leaf.value.replace(/\\[\s\S]/g, "")).not.toMatch(/[%_*]/);
      } else {
        // Ścieżka dokładna: PostgREST zrobiłby z `*` w ilike wieloznacznik `%`.
        expect(leaf.op).toBe("in");
      }
    }
    // Wartości po stronie serwera (po zdjęciu cytowania PostgREST), w kolejności
    // leadów; `in:` - lista dokładna, reszta - wzorce `ilike`. Postaci są
    // WŁASNE dla leada: `A*b@Firma.test` i `a*b@firma.test` (ten sam klucz)
    // mają osobne listy, a `οδος@` (lead z `ς`) nie dostaje `ΟΔΟΣ@` sąsiada.
    expect(leaves.map((f) => (f.op === "in" ? `in:${f.values.join(" | ")}` : f.value))).toEqual([
      "anna.kowalska@firma.test",
      "jan\\_kowalski@firma.test",
      "100\\%pewny@firma.test",
      "a\\\\b@firma.test",
      "in:a*b@firma.test | A*b@Firma.test",
      "in:a*b@firma.test",
      "in:x*y@firma.test",
      'o"neil,(pr):x+1@firma.test',
      "wspolny@firma.test",
      "login@firma.test",
      "bez.zdjecia@firma.test",
      'a",contact\\_email.ilike."\\%@firma.test',
      // `İzmir@` z kluczem JS: klucz `i̇zmir@` (i + U+0307) i postać zapisana -
      // `lower()` bazy rozróżnia je, więc dwa liście.
      "i\u0307zmir@firma.test",
      "İzmir@firma.test",
      // `İzmir@` z `email_norm` bazy i `izmir@`: `lower('İ')` = `i`, jeden liść.
      "izmir@firma.test",
      "οδος@firma.test",
      "ΟΔΟΣ@firma.test",
      "οδοσ@firma.test",
      "straße@firma.test",
      "strasse@firma.test",
      "ılgaz@firma.test",
      "ilgaz@firma.test",
    ]);
  });

  it("oba zapytania karty i listy stoją na tenancie wołającego", async () => {
    await listAvatars();
    await cardAvatar(LEADS[0] as (typeof LEADS)[number]);
    const chains = admin.chainsFor("profiles");
    expect(chains.map(avatarChainKind).sort()).toEqual([
      "contact_email",
      "contact_email",
      "email",
      "email",
    ]);
    for (const chain of chains) {
      expect(chain.calls.filter((c) => c.method === "eq").map((c) => c.args)).toEqual([
        ["tenant_id", TENANT],
      ]);
      expect(chain.argsOf("order")).toEqual(["id", { ascending: true }]);
    }
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
