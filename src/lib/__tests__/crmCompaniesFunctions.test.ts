// WARSTWA SERWEROWA FIRM CRM (lib/crm-companies.functions.ts) - 0 z 28 funkcji.
//
// Sedno tego pliku to REGUŁY ROZPOZNAWANIA (`isCompanyAggregate`, `isCompanyLead`,
// `hasId`): wiersze przychodzą z widoków i RPC spoza wygenerowanych typów, więc
// jedynym zabezpieczeniem przed „undefined w interfejsie" jest strażnik kształtu.
// Testujemy je przez zachowanie handlerów - śmieciowy wiersz ma po prostu
// wypaść, a nie wywrócić listę.
//
// Autoryzacja i RLS: pgTAP. Tutaj kształt danych, tenant, audyt, ścieżka błędu.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ok, fail, pgError, supabaseFromStub, type SupabaseResult } from "@/test/supabaseChain";
import { callServerFn, type ServerFnContext } from "@/test/serverFnHarness";

vi.mock("@tanstack/react-start", async () => {
  const { serverFnStubModule } = await import("@/test/serverFnHarness");
  return serverFnStubModule();
});
vi.mock("@/integrations/supabase/require-staff", () => ({
  requireCrmStaff: { name: "requireCrmStaff" },
  requireStaff: { name: "requireStaff" },
}));

import * as companies from "@/lib/crm-companies.functions";

const COMPANY_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";
const TENANT = "33333333-3333-4333-8333-333333333333";
const USER_ID = "44444444-4444-4444-8444-444444444444";

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

describe("listCrmCompanies", () => {
  it("dokleja liczniki z jednego RPC zamiast dociągać leady", async () => {
    db.setResponse("crm_companies", () => ok([{ id: COMPANY_ID, name: "Acme" }]));
    rpcResults.crm_companies_aggregates = ok([
      {
        company_id: COMPANY_ID,
        leads_count: "3",
        contacts_count: 2,
        last_lead_activity_at: "2026-08-10T10:00:00.000Z",
      },
    ]);
    const result = await callServerFn(companies.listCrmCompanies, {
      data: {},
      context: context(),
    });
    expect(parsed(result)).toEqual([
      {
        id: COMPANY_ID,
        name: "Acme",
        leads_count: 3,
        contacts_count: 2,
        last_lead_activity_at: "2026-08-10T10:00:00.000Z",
      },
    ]);
    expect(rpcCalls[0]).toEqual({
      fn: "crm_companies_aggregates",
      args: { _company_ids: [COMPANY_ID] },
    });
  });

  it("wiersz bez identyfikatora wypada z listy (strażnik hasId)", async () => {
    db.setResponse("crm_companies", () =>
      ok([{ name: "Bez id" }, { id: COMPANY_ID, name: "Acme" }]),
    );
    rpcResults.crm_companies_aggregates = ok([]);
    const result = await callServerFn(companies.listCrmCompanies, { data: {}, context: context() });
    expect((parsed(result) as Array<{ name: string }>).map((r) => r.name)).toEqual(["Acme"]);
  });

  it("śmieciowy wiersz agregatu nie psuje liczników (strażnik isCompanyAggregate)", async () => {
    db.setResponse("crm_companies", () => ok([{ id: COMPANY_ID, name: "Acme" }]));
    rpcResults.crm_companies_aggregates = ok([
      null,
      "tekst",
      { leads_count: 9 },
      { company_id: COMPANY_ID, leads_count: "nie liczba", contacts_count: null },
    ]);
    const result = await callServerFn(companies.listCrmCompanies, { data: {}, context: context() });
    expect(parsed(result)).toEqual([
      {
        id: COMPANY_ID,
        name: "Acme",
        leads_count: 0,
        contacts_count: 0,
        last_lead_activity_at: null,
      },
    ]);
  });

  it("pusta lista firm nie woła agregatu", async () => {
    db.setResponse("crm_companies", () => ok([]));
    const result = await callServerFn(companies.listCrmCompanies, { data: {}, context: context() });
    expect(parsed(result)).toEqual([]);
    expect(rpcCalls).toHaveLength(0);
  });

  it("filtry i fraza trafiają do zapytania, fraza bez metaznaków", async () => {
    db.setResponse("crm_companies", () => ok([]));
    await callServerFn(companies.listCrmCompanies, {
      data: {
        country: "Poland",
        branch: "Energetyka",
        updated_from: "2026-08-01T00:00:00.000Z",
        updated_to: "2026-08-31T00:00:00.000Z",
        search: 'Ac%me_,("x")',
      },
      context: context(),
    });
    const chain = db.lastChain("crm_companies");
    expect(chain?.calls.filter((c) => c.method === "eq").map((c) => c.args)).toEqual([
      ["country", "Poland"],
      ["branch", "Energetyka"],
    ]);
    expect(chain?.argsOf("gte")).toEqual(["updated_at", "2026-08-01T00:00:00.000Z"]);
    expect(chain?.argsOf("lte")).toEqual(["updated_at", "2026-08-31T00:00:00.000Z"]);
    // Fraza traci metaznaki `.or()` i wieloznaczniki LIKE, więc nie może
    // dopisać do zapytania piątego warunku ani rozszerzyć wzorca.
    const or = String(chain?.argsOf("or")?.[0] ?? "");
    expect(or.split(",")).toEqual([
      "name.ilike.%acmex%",
      "domain.ilike.%acmex%",
      "city.ilike.%acmex%",
      "country.ilike.%acmex%",
    ]);
  });

  it("błąd listy wychodzi na zewnątrz", async () => {
    db.setResponse("crm_companies", () => fail("boom"));
    await expect(
      callServerFn(companies.listCrmCompanies, { data: {}, context: context() }),
    ).rejects.toThrow("boom");
  });

  it("błąd RPC agregatów przerywa listę zamiast oddawać zera", async () => {
    db.setResponse("crm_companies", () => ok([{ id: COMPANY_ID, name: "Acme" }]));
    rpcResults.crm_companies_aggregates = fail("agg down");
    await expect(
      callServerFn(companies.listCrmCompanies, { data: {}, context: context() }),
    ).rejects.toThrow("agg down");
  });
});

describe("getCrmCompany", () => {
  it("składa kartę firmy z profili i leadów", async () => {
    db.setResponse("crm_companies", () => ok({ id: COMPANY_ID, name: "Acme" }));
    db.setResponse("profiles", () => ok([{ id: USER_ID }]));
    db.setResponse("crm_leads", () => ok([{ id: OTHER_ID, email: "a@example.test" }]));
    const result = await callServerFn(companies.getCrmCompany, {
      data: { id: COMPANY_ID },
      context: context(),
    });
    expect(parsed(result)).toMatchObject({
      company: { id: COMPANY_ID },
      profiles: [{ id: USER_ID }],
      leads: [{ id: OTHER_ID }],
    });
  });

  it("nieistniejąca firma to not_found", async () => {
    db.setResponse("crm_companies", () => ok(null));
    await expect(
      callServerFn(companies.getCrmCompany, { data: { id: COMPANY_ID }, context: context() }),
    ).rejects.toThrow("not_found");
  });

  it("błąd odczytu firmy wychodzi na zewnątrz", async () => {
    db.setResponse("crm_companies", () => fail("boom"));
    await expect(
      callServerFn(companies.getCrmCompany, { data: { id: COMPANY_ID }, context: context() }),
    ).rejects.toThrow("boom");
  });
});

describe("createCrmCompany", () => {
  it("tenant i autor są rozwiązywane serwerowo, puste pola idą jako NULL", async () => {
    db.setResponse("profiles", () => ok({ tenant_id: TENANT }));
    db.setResponse("crm_companies", () => ok({ id: COMPANY_ID }));
    db.setResponse("audit_log", () => ok(null));
    const result = await callServerFn<{ id: string }>(companies.createCrmCompany, {
      data: { name: "Acme", domain: "   ", city: "Bruksela" },
      context: context(),
    });
    expect(result).toEqual({ ok: true, id: COMPANY_ID });
    expect(db.lastChain("crm_companies")?.argsOf("insert")?.[0]).toMatchObject({
      tenant_id: TENANT,
      created_by: USER_ID,
      name: "Acme",
      domain: null,
      city: "Bruksela",
    });
  });

  it("brak tenanta w profilu przerywa zapis", async () => {
    db.setResponse("profiles", () => ok(null));
    await expect(
      callServerFn(companies.createCrmCompany, { data: { name: "Acme" }, context: context() }),
    ).rejects.toThrow("tenant_unresolved");
  });

  it("błąd odczytu profilu przerywa zapis", async () => {
    db.setResponse("profiles", () => fail("profile down"));
    await expect(
      callServerFn(companies.createCrmCompany, { data: { name: "Acme" }, context: context() }),
    ).rejects.toThrow("profile down");
  });

  it("naruszenie unikatu tłumaczy się na duplicate_name (a nie kod bazy)", async () => {
    db.setResponse("profiles", () => ok({ tenant_id: TENANT }));
    db.setResponse("crm_companies", () => ({
      data: null,
      error: pgError("duplicate key", "23505"),
    }));
    await expect(
      callServerFn(companies.createCrmCompany, { data: { name: "Acme" }, context: context() }),
    ).rejects.toThrow("duplicate_name");
  });

  it("inny błąd zapisu idzie z komunikatem bazy", async () => {
    db.setResponse("profiles", () => ok({ tenant_id: TENANT }));
    db.setResponse("crm_companies", () => fail("write failed"));
    await expect(
      callServerFn(companies.createCrmCompany, { data: { name: "Acme" }, context: context() }),
    ).rejects.toThrow("write failed");
  });

  it("awaria audytu nie blokuje sukcesu", async () => {
    db.setResponse("profiles", () => ok({ tenant_id: TENANT }));
    db.setResponse("crm_companies", () => ok({ id: COMPANY_ID }));
    db.setResponse("audit_log", () => {
      throw new Error("audit down");
    });
    await expect(
      callServerFn(companies.createCrmCompany, { data: { name: "Acme" }, context: context() }),
    ).resolves.toMatchObject({ ok: true });
  });
});

describe("updateCrmCompany", () => {
  it("zapisuje patch i notuje zmienione pola w audycie", async () => {
    db.setResponse("crm_companies", () => ok(null));
    db.setResponse("audit_log", () => ok(null));
    await callServerFn(companies.updateCrmCompany, {
      data: { id: COMPANY_ID, city: "Warszawa", branch: null },
      context: context(),
    });
    expect(db.lastChain("crm_companies")?.argsOf("update")).toEqual([
      { city: "Warszawa", branch: null },
    ]);
    const audit = db.lastChain("audit_log")?.argsOf("insert")?.[0] as {
      metadata: { fields: string[] };
    };
    expect(audit.metadata.fields.sort()).toEqual(["branch", "city"]);
  });

  it("błąd zapisu wychodzi na zewnątrz", async () => {
    db.setResponse("crm_companies", () => fail("update failed"));
    await expect(
      callServerFn(companies.updateCrmCompany, {
        data: { id: COMPANY_ID, city: "Warszawa" },
        context: context(),
      }),
    ).rejects.toThrow("update failed");
  });

  it("adres logo musi być URL-em", async () => {
    await expect(
      callServerFn(companies.updateCrmCompany, {
        data: { id: COMPANY_ID, logo_url: "nie-url" },
        context: context(),
      }),
    ).rejects.toThrow();
  });
});

describe("createCrmContactForCompany", () => {
  it("kontakt dziedziczy tenanta firmy, nie tenanta z sesji", async () => {
    db.setResponse("crm_companies", () => ok({ tenant_id: "tenant-firmy" }));
    db.setResponse("crm_leads", () => ok({ id: OTHER_ID }));
    db.setResponse("audit_log", () => ok(null));
    const result = await callServerFn(companies.createCrmContactForCompany, {
      data: { company_id: COMPANY_ID, email: "Anna@Example.Test", first_name: "Anna" },
      context: context(),
    });
    expect(result).toEqual({ ok: true, id: OTHER_ID });
    const insert = db.lastChain("crm_leads")?.argsOf("insert")?.[0] as Record<string, unknown>;
    expect(insert).toMatchObject({
      tenant_id: "tenant-firmy",
      company_id: COMPANY_ID,
      email: "anna@example.test",
      email_norm: "anna@example.test",
      stage: "new",
      source_type: "manual",
    });
  });

  it("nieznana firma przerywa dodanie kontaktu", async () => {
    db.setResponse("crm_companies", () => ok(null));
    await expect(
      callServerFn(companies.createCrmContactForCompany, {
        data: { company_id: COMPANY_ID, email: "a@example.test" },
        context: context(),
      }),
    ).rejects.toThrow("company_not_found");
  });

  it("powtórzony e-mail w tenancie tłumaczy się na duplicate_email", async () => {
    db.setResponse("crm_companies", () => ok({ tenant_id: TENANT }));
    db.setResponse("crm_leads", () => ({ data: null, error: pgError("duplicate key", "23505") }));
    await expect(
      callServerFn(companies.createCrmContactForCompany, {
        data: { company_id: COMPANY_ID, email: "a@example.test" },
        context: context(),
      }),
    ).rejects.toThrow("duplicate_email");
  });

  it("inny błąd zapisu idzie z komunikatem bazy", async () => {
    db.setResponse("crm_companies", () => ok({ tenant_id: TENANT }));
    db.setResponse("crm_leads", () => fail("insert failed"));
    await expect(
      callServerFn(companies.createCrmContactForCompany, {
        data: { company_id: COMPANY_ID, email: "a@example.test" },
        context: context(),
      }),
    ).rejects.toThrow("insert failed");
  });

  it("adres, który nie jest e-mailem, nie przechodzi walidacji", async () => {
    await expect(
      callServerFn(companies.createCrmContactForCompany, {
        data: { company_id: COMPANY_ID, email: "nie-email" },
        context: context(),
      }),
    ).rejects.toThrow();
  });
});

describe("notatka firmowa", () => {
  it("ląduje w audycie z treścią i identyfikatorem firmy", async () => {
    db.setResponse("audit_log", () => ok(null));
    await callServerFn(companies.addCrmCompanyNote, {
      data: { company_id: COMPANY_ID, body: "Spotkanie w Brukseli" },
      context: context(),
    });
    expect(db.lastChain("audit_log")?.argsOf("insert")?.[0]).toMatchObject({
      action: "crm.company.note",
      entity_type: "crm_company",
      entity_id: COMPANY_ID,
      metadata: { body: "Spotkanie w Brukseli" },
    });
  });

  it("błąd zapisu notatki wychodzi na zewnątrz (to nie jest audyt best-effort)", async () => {
    db.setResponse("audit_log", () => fail("note failed"));
    await expect(
      callServerFn(companies.addCrmCompanyNote, {
        data: { company_id: COMPANY_ID, body: "x" },
        context: context(),
      }),
    ).rejects.toThrow("note failed");
  });
});

describe("getCrmCompanyActivity", () => {
  it("łączy audyt, notatki i utworzenie leadów w jeden strumień", async () => {
    db.setResponse("crm_leads", () =>
      ok([
        {
          id: OTHER_ID,
          email: "anna@example.test",
          first_name: "Anna",
          last_name: "Kowalska",
          created_at: "2026-08-01T10:00:00.000Z",
          last_activity_at: "2026-08-05T10:00:00.000Z",
          stage: "new",
        },
        { id: "nie-lead" },
      ]),
    );
    db.setResponse("audit_log", (chain) =>
      chain.has("in")
        ? ok([
            {
              id: "a2",
              action: "crm.lead.update",
              entity_type: "crm_lead",
              entity_id: OTHER_ID,
              metadata: { field: "stage" },
              actor_id: USER_ID,
              created_at: "2026-08-04T10:00:00.000Z",
            },
          ])
        : ok([
            {
              id: "a1",
              action: "crm.company.note",
              entity_type: "crm_company",
              entity_id: COMPANY_ID,
              metadata: { body: "Notatka firmowa" },
              actor_id: USER_ID,
              created_at: "2026-08-06T10:00:00.000Z",
            },
          ]),
    );
    db.setResponse("crm_lead_notes", () =>
      ok([
        {
          id: "n1",
          body: "Notatka przy kontakcie",
          lead_id: OTHER_ID,
          author_id: USER_ID,
          created_at: "2026-08-03T10:00:00.000Z",
        },
      ]),
    );

    const result = await callServerFn(companies.getCrmCompanyActivity, {
      data: { id: COMPANY_ID },
      context: context(),
    });
    const events = parsed(result) as Array<{
      id: string;
      kind: string;
      lead_label: string | null;
      body?: string | null;
    }>;
    expect(events.map((e) => e.kind)).toEqual(["note", "audit", "note", "lead_created"]);
    // Notatka firmowa idzie z audytu, ale ma być pokazana jako notatka z treścią.
    expect(events[0].body).toBe("Notatka firmowa");
    // Etykieta kontaktu pochodzi z leadów firmy, nie z wpisu audytu.
    expect(events[1].lead_label).toBe("Anna Kowalska");
  });

  it("firma bez kontaktów nie pyta o notatki ani o audyt leadów", async () => {
    db.setResponse("crm_leads", () => ok([]));
    db.setResponse("audit_log", () => ok([]));
    const result = await callServerFn(companies.getCrmCompanyActivity, {
      data: { id: COMPANY_ID },
      context: context(),
    });
    expect(parsed(result)).toEqual([]);
    expect(db.chainsFor("crm_lead_notes")).toHaveLength(0);
    expect(db.chainsFor("audit_log")).toHaveLength(1);
  });

  it("kontakt bez nazwiska i e-maila dostaje etykietę ze skrótu identyfikatora", async () => {
    db.setResponse("crm_leads", () =>
      ok([
        {
          id: OTHER_ID,
          email: "",
          first_name: null,
          last_name: null,
          created_at: "2026-08-01T10:00:00.000Z",
          last_activity_at: null,
          stage: "new",
        },
      ]),
    );
    db.setResponse("audit_log", () => ok([]));
    db.setResponse("crm_lead_notes", () => ok([]));
    const result = await callServerFn(companies.getCrmCompanyActivity, {
      data: { id: COMPANY_ID },
      context: context(),
    });
    const events = parsed(result) as Array<{ lead_label: string }>;
    expect(events[0].lead_label).toBe(OTHER_ID.slice(0, 6));
  });
});

describe("operacje zbiorcze na firmach", () => {
  it("pusty patch nie rusza bazy", async () => {
    const result = await callServerFn(companies.bulkUpdateCrmCompanies, {
      data: { ids: [COMPANY_ID] },
      context: context(),
    });
    expect(result).toEqual({ ok: true, updated: 0 });
    expect(db.chains).toHaveLength(0);
  });

  it("zmiana kraju idzie jednym zapytaniem i zapisuje audyt", async () => {
    db.setResponse("crm_companies", () => ok(null));
    db.setResponse("audit_log", () => ok(null));
    const result = await callServerFn(companies.bulkUpdateCrmCompanies, {
      data: { ids: [COMPANY_ID, OTHER_ID], country: "Belgia" },
      context: context(),
    });
    expect(result).toEqual({ ok: true, updated: 2 });
    expect(db.lastChain("crm_companies")?.argsOf("update")).toEqual([{ country: "Belgia" }]);
  });

  it("błąd zapisu zbiorczego wychodzi na zewnątrz", async () => {
    db.setResponse("crm_companies", () => fail("bulk failed"));
    await expect(
      callServerFn(companies.bulkUpdateCrmCompanies, {
        data: { ids: [COMPANY_ID], country: "Belgia" },
        context: context(),
      }),
    ).rejects.toThrow("bulk failed");
  });

  it("awaria audytu nie wywraca operacji zbiorczej", async () => {
    db.setResponse("crm_companies", () => ok(null));
    db.setResponse("audit_log", () => {
      throw new Error("audit down");
    });
    await expect(
      callServerFn(companies.bulkUpdateCrmCompanies, {
        data: { ids: [COMPANY_ID], branch: "Energetyka" },
        context: context(),
      }),
    ).resolves.toMatchObject({ ok: true });
  });

  it("usuwanie firm jest zarezerwowane dla administratora", async () => {
    rpcResults.has_role = ok(false);
    await expect(
      callServerFn(companies.bulkDeleteCrmCompanies, {
        data: { ids: [COMPANY_ID] },
        context: context(),
      }),
    ).rejects.toThrow("forbidden");
    expect(db.chains).toHaveLength(0);
  });

  it("administrator usuwa i zostawia ślad w audycie", async () => {
    rpcResults.has_role = ok(true);
    db.setResponse("crm_companies", () => ok(null));
    db.setResponse("audit_log", () => ok(null));
    const result = await callServerFn(companies.bulkDeleteCrmCompanies, {
      data: { ids: [COMPANY_ID] },
      context: context(),
    });
    expect(result).toEqual({ ok: true, deleted: 1 });
    expect((db.lastChain("audit_log")?.argsOf("insert")?.[0] as { action: string }).action).toBe(
      "crm.company.bulk_delete",
    );
  });

  it("błąd usuwania wychodzi na zewnątrz", async () => {
    rpcResults.has_role = ok(true);
    db.setResponse("crm_companies", () => fail("delete failed"));
    await expect(
      callServerFn(companies.bulkDeleteCrmCompanies, {
        data: { ids: [COMPANY_ID] },
        context: context(),
      }),
    ).rejects.toThrow("delete failed");
  });

  it("awaria audytu przy usuwaniu nie wywraca operacji", async () => {
    rpcResults.has_role = ok(true);
    db.setResponse("crm_companies", () => ok(null));
    db.setResponse("audit_log", () => {
      throw new Error("audit down");
    });
    await expect(
      callServerFn(companies.bulkDeleteCrmCompanies, {
        data: { ids: [COMPANY_ID] },
        context: context(),
      }),
    ).resolves.toMatchObject({ ok: true });
  });
});

describe("bramka uprawnień - test strukturalny", () => {
  it("każda serwerowa funkcja firm deklaruje requireCrmStaff", () => {
    const fns = Object.entries(companies).filter(
      ([, value]) => typeof value === "object" && value !== null && "handler" in (value as object),
    );
    expect(fns.length).toBeGreaterThan(5);
    for (const [name, value] of fns) {
      const middleware = (value as { middleware: Array<{ name?: string }> }).middleware;
      expect(
        middleware.map((m) => m?.name),
        `${name} bez bramki`,
      ).toContain("requireCrmStaff");
    }
  });
});
