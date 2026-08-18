// WARSTWA SERWEROWA LEJKA I ZAPISANYCH WIDOKÓW (0/19 i 0/7 funkcji).
//
// Sedno lejka to KONWERSJA subskrybenta na kontakt CRM: zgoda marketingowa
// musi być PRZEPISANA ze stanu subskrybenta, nigdy ustawiona w ciemno, a upsert
// bez dowodu zgody NIE MOŻE nadpisać zgody udowodnionej gdzie indziej (PostgREST
// nadpisuje na konflikcie wszystkie kolumny z payloadu). Stąd dwa osobne upserty
// i osobny test na każdy z nich.
//
// Autoryzacja i RLS: pgTAP. Tutaj kształt, zgoda, audyt, ścieżka błędu.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ok, fail, supabaseFromStub, type SupabaseResult } from "@/test/supabaseChain";
import { callServerFn, type ServerFnContext } from "@/test/serverFnHarness";

vi.mock("@tanstack/react-start", async () => {
  const { serverFnStubModule } = await import("@/test/serverFnHarness");
  return serverFnStubModule();
});
vi.mock("@/integrations/supabase/require-staff", () => ({
  requireCrmStaff: { name: "requireCrmStaff" },
  requireStaff: { name: "requireStaff" },
}));

import * as funnel from "@/lib/crm-funnel.functions";
import * as savedViews from "@/lib/crm-saved-views.functions";

const SUB_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_SUB = "22222222-2222-4222-8222-222222222222";
const TENANT = "33333333-3333-4333-8333-333333333333";
const USER_ID = "44444444-4444-4444-8444-444444444444";
const VIEW_ID = "55555555-5555-4555-8555-555555555555";

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

const subscriber = (over: Partial<Record<string, unknown>> = {}) => ({
  id: SUB_ID,
  tenant_id: TENANT,
  email: "Anna@Example.test",
  first_name: "Anna",
  last_name: "Kowalska",
  language: "pl",
  status: "subscribed",
  confirmed_at: "2026-08-01T10:00:00.000Z",
  consents: { marketing: true },
  ...over,
});

beforeEach(() => {
  db.reset();
  rpcCalls = [];
  rpcResults = {};
});

describe("listFunnelSubscribers", () => {
  it("czyta widok lejka z domyślnym limitem i porządkiem", async () => {
    db.setResponse("crm_funnel_view", () => ok([{ id: SUB_ID }]));
    const result = await callServerFn(funnel.listFunnelSubscribers, {
      data: {},
      context: context(),
    });
    expect(parsed(result)).toEqual([{ id: SUB_ID }]);
    const chain = db.lastChain("crm_funnel_view");
    expect(chain?.argsOf("order")).toEqual(["created_at", { ascending: false }]);
    expect(chain?.argsOf("limit")).toEqual([200]);
  });

  it("każdy wariant odbiorcy zawęża zapytanie po swojej fladze", async () => {
    const cases: Array<[string, [string, boolean]]> = [
      ["registered", ["is_registered", true]],
      ["unregistered", ["is_registered", false]],
      ["contact", ["is_contact", true]],
      ["non_contact", ["is_contact", false]],
    ];
    for (const [audience, expected] of cases) {
      db.reset();
      db.setResponse("crm_funnel_view", () => ok([]));
      await callServerFn(funnel.listFunnelSubscribers, { data: { audience }, context: context() });
      expect(db.lastChain("crm_funnel_view")?.argsOf("eq")).toEqual(expected);
    }
  });

  it("odbiorca „wszyscy” nie dokłada żadnego warunku", async () => {
    db.setResponse("crm_funnel_view", () => ok([]));
    await callServerFn(funnel.listFunnelSubscribers, {
      data: { audience: "all" },
      context: context(),
    });
    expect(db.lastChain("crm_funnel_view")?.has("eq")).toBe(false);
  });

  it("status, źródło, język i zakres dat trafiają do zapytania", async () => {
    db.setResponse("crm_funnel_view", () => ok([]));
    await callServerFn(funnel.listFunnelSubscribers, {
      data: {
        status: "pending",
        source: "stopka",
        language: "en",
        created_from: "2026-08-01T00:00:00.000Z",
        created_to: "2026-08-31T00:00:00.000Z",
      },
      context: context(),
    });
    const chain = db.lastChain("crm_funnel_view");
    expect(chain?.calls.filter((c) => c.method === "eq").map((c) => c.args)).toEqual([
      ["status", "pending"],
      ["source", "stopka"],
      ["language", "en"],
    ]);
    expect(chain?.argsOf("gte")).toEqual(["created_at", "2026-08-01T00:00:00.000Z"]);
    expect(chain?.argsOf("lte")).toEqual(["created_at", "2026-08-31T00:00:00.000Z"]);
  });

  it("fraza traci metaznaki, więc nie dopisze warunku do zapytania", async () => {
    db.setResponse("crm_funnel_view", () => ok([]));
    await callServerFn(funnel.listFunnelSubscribers, {
      data: { search: 'Kowal%ska_,("x")' },
      context: context(),
    });
    const or = String(db.lastChain("crm_funnel_view")?.argsOf("or")?.[0] ?? "");
    expect(or.split(",")).toEqual([
      "email.ilike.%Kowalskax%",
      "first_name.ilike.%Kowalskax%",
      "last_name.ilike.%Kowalskax%",
      "display_name.ilike.%Kowalskax%",
    ]);
  });

  it("pusta fraza nie dokłada warunku", async () => {
    db.setResponse("crm_funnel_view", () => ok([]));
    await callServerFn(funnel.listFunnelSubscribers, {
      data: { search: "   " },
      context: context(),
    });
    expect(db.lastChain("crm_funnel_view")?.has("or")).toBe(false);
  });

  it("błąd odczytu wychodzi na zewnątrz", async () => {
    db.setResponse("crm_funnel_view", () => fail("boom"));
    await expect(
      callServerFn(funnel.listFunnelSubscribers, { data: {}, context: context() }),
    ).rejects.toThrow("boom");
  });
});

describe("getFunnelSubscriber", () => {
  it("oddaje jeden wiersz widoku", async () => {
    db.setResponse("crm_funnel_view", () => ok({ id: SUB_ID, email: "a@example.test" }));
    const result = await callServerFn(funnel.getFunnelSubscriber, {
      data: { id: SUB_ID },
      context: context(),
    });
    expect(parsed(result)).toMatchObject({ id: SUB_ID });
  });

  it("brak wiersza to not_found", async () => {
    db.setResponse("crm_funnel_view", () => ok(null));
    await expect(
      callServerFn(funnel.getFunnelSubscriber, { data: { id: SUB_ID }, context: context() }),
    ).rejects.toThrow("not_found");
  });

  it("błąd odczytu wychodzi na zewnątrz", async () => {
    db.setResponse("crm_funnel_view", () => fail("boom"));
    await expect(
      callServerFn(funnel.getFunnelSubscriber, { data: { id: SUB_ID }, context: context() }),
    ).rejects.toThrow("boom");
  });
});

describe("funnelStats", () => {
  it("liczby z RPC są normalizowane (napisy z COUNT -> liczby)", async () => {
    rpcResults.crm_funnel_stats = ok([
      {
        total: "10",
        subscribed: "7",
        pending: 2,
        unsubscribed: null,
        registered: "4",
        contacts: 3,
      },
    ]);
    const result = await callServerFn(funnel.funnelStats, { context: context() });
    expect(result).toEqual({
      total: 10,
      subscribed: 7,
      pending: 2,
      unsubscribed: 0,
      registered: 4,
      contacts: 3,
    });
  });

  it("brak wiersza daje same zera zamiast NaN", async () => {
    rpcResults.crm_funnel_stats = ok(null);
    expect(await callServerFn(funnel.funnelStats, { context: context() })).toEqual({
      total: 0,
      subscribed: 0,
      pending: 0,
      unsubscribed: 0,
      registered: 0,
      contacts: 0,
    });
  });

  it("błąd RPC wychodzi na zewnątrz", async () => {
    rpcResults.crm_funnel_stats = fail("stats down");
    await expect(callServerFn(funnel.funnelStats, { context: context() })).rejects.toThrow(
      "stats down",
    );
  });
});

describe("bulkUnsubscribeFunnel", () => {
  it("ustawia status i stempel wypisania", async () => {
    db.setResponse("newsletter_subscribers", () => ok(null));
    const result = await callServerFn(funnel.bulkUnsubscribeFunnel, {
      data: { ids: [SUB_ID, OTHER_SUB] },
      context: context(),
    });
    expect(result).toEqual({ ok: true, count: 2 });
    const patch = db.lastChain("newsletter_subscribers")?.argsOf("update")?.[0] as {
      status: string;
      unsubscribed_at: string;
    };
    expect(patch.status).toBe("unsubscribed");
    expect(Number.isNaN(Date.parse(patch.unsubscribed_at))).toBe(false);
  });

  it("błąd zapisu wychodzi na zewnątrz", async () => {
    db.setResponse("newsletter_subscribers", () => fail("boom"));
    await expect(
      callServerFn(funnel.bulkUnsubscribeFunnel, { data: { ids: [SUB_ID] }, context: context() }),
    ).rejects.toThrow("boom");
  });

  it("pusta lista nie przechodzi walidacji", async () => {
    await expect(
      callServerFn(funnel.bulkUnsubscribeFunnel, { data: { ids: [] }, context: context() }),
    ).rejects.toThrow();
  });
});

describe("convertFunnelToContacts", () => {
  it("zgoda z dowodem trafia do payloadu, brak dowodu - NIE", async () => {
    db.setResponse("newsletter_subscribers", () =>
      ok([
        subscriber({ id: SUB_ID, consents: { marketing: true } }),
        subscriber({
          id: OTHER_SUB,
          email: "bez@example.test",
          consents: null,
          confirmed_at: null,
        }),
      ]),
    );
    db.setResponse("crm_leads", () => ok(null));
    db.setResponse("audit_log", () => ok(null));

    const result = await callServerFn(funnel.convertFunnelToContacts, {
      data: { ids: [SUB_ID, OTHER_SUB] },
      context: context(),
    });
    expect(result).toEqual({ ok: true, count: 2 });

    const upserts = db
      .chainsFor("crm_leads")
      .filter((c) => c.has("upsert"))
      .map((c) => c.argsOf("upsert"));
    expect(upserts).toHaveLength(2);

    const [withConsent] = upserts[0] as [Array<Record<string, unknown>>, unknown];
    const [withoutConsent] = upserts[1] as [Array<Record<string, unknown>>, unknown];
    expect(withConsent[0]).toMatchObject({
      email: "Anna@Example.test",
      email_norm: "anna@example.test",
      source_type: "newsletter",
      marketing_consent: true,
    });
    // KLUCZOWE: brak klucza `marketing_consent` w payloadzie - upsert nie może
    // zdjąć zgody udowodnionej z innego źródła.
    expect(Object.keys(withoutConsent[0])).not.toContain("marketing_consent");
    expect(upserts[0][1]).toEqual({ onConflict: "tenant_id,email_norm" });
  });

  it("sami subskrybenci bez dowodu = jeden upsert, bez kolumny zgody", async () => {
    db.setResponse("newsletter_subscribers", () =>
      ok([subscriber({ consents: null, confirmed_at: null })]),
    );
    db.setResponse("crm_leads", () => ok(null));
    db.setResponse("audit_log", () => ok(null));
    await callServerFn(funnel.convertFunnelToContacts, {
      data: { ids: [SUB_ID] },
      context: context(),
    });
    expect(db.chainsFor("crm_leads").filter((c) => c.has("upsert"))).toHaveLength(1);
  });

  it("pusty wybór nie pisze niczego", async () => {
    db.setResponse("newsletter_subscribers", () => ok([]));
    const result = await callServerFn(funnel.convertFunnelToContacts, {
      data: { ids: [SUB_ID] },
      context: context(),
    });
    expect(result).toEqual({ ok: true, count: 0 });
    expect(db.chainsFor("crm_leads")).toHaveLength(0);
  });

  it("audyt notuje ilu subskrybentów miało dowód zgody", async () => {
    db.setResponse("newsletter_subscribers", () =>
      ok([subscriber(), subscriber({ id: OTHER_SUB, consents: null, confirmed_at: null })]),
    );
    db.setResponse("crm_leads", () => ok(null));
    db.setResponse("audit_log", () => ok(null));
    await callServerFn(funnel.convertFunnelToContacts, {
      data: { ids: [SUB_ID, OTHER_SUB] },
      context: context(),
    });
    expect(db.lastChain("audit_log")?.argsOf("insert")?.[0]).toMatchObject({
      action: "crm.funnel.convert",
      metadata: { count: 2, with_marketing_consent: 1, without_marketing_consent: 1 },
    });
  });

  it("błąd odczytu subskrybentów przerywa konwersję", async () => {
    db.setResponse("newsletter_subscribers", () => fail("read failed"));
    await expect(
      callServerFn(funnel.convertFunnelToContacts, { data: { ids: [SUB_ID] }, context: context() }),
    ).rejects.toThrow("read failed");
  });

  it("błąd upsertu przerywa konwersję", async () => {
    db.setResponse("newsletter_subscribers", () => ok([subscriber()]));
    db.setResponse("crm_leads", () => fail("upsert failed"));
    await expect(
      callServerFn(funnel.convertFunnelToContacts, { data: { ids: [SUB_ID] }, context: context() }),
    ).rejects.toThrow("upsert failed");
  });

  it("awaria audytu nie wywraca konwersji", async () => {
    db.setResponse("newsletter_subscribers", () => ok([subscriber()]));
    db.setResponse("crm_leads", () => ok(null));
    db.setResponse("audit_log", () => {
      throw new Error("audit down");
    });
    await expect(
      callServerFn(funnel.convertFunnelToContacts, { data: { ids: [SUB_ID] }, context: context() }),
    ).resolves.toMatchObject({ ok: true });
  });
});

describe("updateFunnelStatus", () => {
  it("ręczna zmiana statusu NIE wytwarza stempla potwierdzenia zgody", async () => {
    db.setResponse("newsletter_subscribers", () => ok(null));
    db.setResponse("audit_log", () => ok(null));
    await callServerFn(funnel.updateFunnelStatus, {
      data: { id: SUB_ID, status: "subscribed" },
      context: context(),
    });
    const patch = db.lastChain("newsletter_subscribers")?.argsOf("update")?.[0] as Record<
      string,
      unknown
    >;
    expect(patch).toEqual({ status: "subscribed" });
    expect(Object.keys(patch)).not.toContain("confirmed_at");
  });

  it("wypisanie dokłada stempel wypisania", async () => {
    db.setResponse("newsletter_subscribers", () => ok(null));
    db.setResponse("audit_log", () => ok(null));
    await callServerFn(funnel.updateFunnelStatus, {
      data: { id: SUB_ID, status: "unsubscribed" },
      context: context(),
    });
    const patch = db.lastChain("newsletter_subscribers")?.argsOf("update")?.[0] as Record<
      string,
      unknown
    >;
    expect(Object.keys(patch).sort()).toEqual(["status", "unsubscribed_at"]);
  });

  it("nieznany status nie przechodzi walidacji", async () => {
    await expect(
      callServerFn(funnel.updateFunnelStatus, {
        data: { id: SUB_ID, status: "zapisany" },
        context: context(),
      }),
    ).rejects.toThrow();
  });

  it("błąd zapisu wychodzi na zewnątrz", async () => {
    db.setResponse("newsletter_subscribers", () => fail("boom"));
    await expect(
      callServerFn(funnel.updateFunnelStatus, {
        data: { id: SUB_ID, status: "pending" },
        context: context(),
      }),
    ).rejects.toThrow("boom");
  });

  it("awaria audytu nie wywraca zmiany statusu", async () => {
    db.setResponse("newsletter_subscribers", () => ok(null));
    db.setResponse("audit_log", () => {
      throw new Error("audit down");
    });
    await expect(
      callServerFn(funnel.updateFunnelStatus, {
        data: { id: SUB_ID, status: "pending" },
        context: context(),
      }),
    ).resolves.toMatchObject({ ok: true });
  });
});

describe("zapisane widoki list", () => {
  it("lista jest zawężona do encji i uporządkowana ręczną kolejnością", async () => {
    db.setResponse("saved_views", () => ok([{ id: VIEW_ID, name: "Moje" }]));
    const result = await callServerFn(savedViews.listSavedViews, {
      data: { entity: "lead" },
      context: context(),
    });
    expect(parsed(result)).toEqual([{ id: VIEW_ID, name: "Moje" }]);
    const chain = db.lastChain("saved_views");
    expect(chain?.argsOf("eq")).toEqual(["entity", "lead"]);
    expect(chain?.argsOf("order")).toEqual(["sort_order", { ascending: true }]);
  });

  it("nieznana encja nie przechodzi walidacji", async () => {
    await expect(
      callServerFn(savedViews.listSavedViews, { data: { entity: "faktura" }, context: context() }),
    ).rejects.toThrow();
  });

  it("błąd odczytu wychodzi na zewnątrz", async () => {
    db.setResponse("saved_views", () => fail("boom"));
    await expect(
      callServerFn(savedViews.listSavedViews, { data: { entity: "lead" }, context: context() }),
    ).rejects.toThrow("boom");
  });

  it("nowy widok jest wstawiany i oddaje identyfikator", async () => {
    db.setResponse("saved_views", () => ok({ id: VIEW_ID }));
    const result = await callServerFn(savedViews.upsertSavedView, {
      data: { entity: "lead", name: "Gorące", config: { columns: ["name"] } },
      context: context(),
    });
    expect(result).toEqual({ ok: true, id: VIEW_ID });
    expect(db.lastChain("saved_views")?.argsOf("insert")?.[0]).toMatchObject({
      entity: "lead",
      name: "Gorące",
      is_shared: false,
    });
  });

  it("istniejący widok jest aktualizowany, nie dublowany", async () => {
    db.setResponse("saved_views", () => ok(null));
    const result = await callServerFn(savedViews.upsertSavedView, {
      data: { id: VIEW_ID, entity: "lead", name: "Gorące", config: {} },
      context: context(),
    });
    expect(result).toEqual({ ok: true, id: VIEW_ID });
    expect(db.lastChain("saved_views")?.has("update")).toBe(true);
    expect(db.lastChain("saved_views")?.has("insert")).toBe(false);
  });

  it("wynik zapisu bez identyfikatora oddaje null zamiast undefined", async () => {
    db.setResponse("saved_views", () => ok({ nazwa: "bez id" }));
    const result = await callServerFn(savedViews.upsertSavedView, {
      data: { entity: "company", name: "Widok", config: {} },
      context: context(),
    });
    expect(result).toEqual({ ok: true, id: null });
  });

  it("błąd zapisu i aktualizacji wychodzi na zewnątrz", async () => {
    db.setResponse("saved_views", () => fail("write failed"));
    await expect(
      callServerFn(savedViews.upsertSavedView, {
        data: { entity: "lead", name: "X", config: {} },
        context: context(),
      }),
    ).rejects.toThrow("write failed");
    await expect(
      callServerFn(savedViews.upsertSavedView, {
        data: { id: VIEW_ID, entity: "lead", name: "X", config: {} },
        context: context(),
      }),
    ).rejects.toThrow("write failed");
  });

  it("pusta nazwa widoku nie przechodzi walidacji", async () => {
    await expect(
      callServerFn(savedViews.upsertSavedView, {
        data: { entity: "lead", name: "   ", config: {} },
        context: context(),
      }),
    ).rejects.toThrow();
  });

  it("usunięcie idzie po identyfikatorze", async () => {
    db.setResponse("saved_views", () => ok(null));
    await callServerFn(savedViews.deleteSavedView, { data: { id: VIEW_ID }, context: context() });
    expect(db.lastChain("saved_views")?.has("delete")).toBe(true);
    expect(db.lastChain("saved_views")?.argsOf("eq")).toEqual(["id", VIEW_ID]);
  });

  it("błąd usunięcia wychodzi na zewnątrz", async () => {
    db.setResponse("saved_views", () => fail("delete failed"));
    await expect(
      callServerFn(savedViews.deleteSavedView, { data: { id: VIEW_ID }, context: context() }),
    ).rejects.toThrow("delete failed");
  });
});

describe("bramka uprawnień - test strukturalny", () => {
  it("lejek i zapisane widoki deklarują requireCrmStaff", () => {
    const fns = [...Object.entries(funnel), ...Object.entries(savedViews)].filter(
      ([, value]) => typeof value === "object" && value !== null && "handler" in (value as object),
    );
    expect(fns.length).toBeGreaterThan(6);
    for (const [name, value] of fns) {
      const middleware = (value as { middleware: Array<{ name?: string }> }).middleware;
      expect(
        middleware.map((m) => m?.name),
        `${name} bez bramki`,
      ).toContain("requireCrmStaff");
    }
  });
});
