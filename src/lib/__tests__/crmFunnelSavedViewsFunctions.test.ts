// WARSTWA SERWEROWA LEJKA I ZAPISANYCH WIDOKÓW (0/19 i 0/7 funkcji).
//
// Sedno lejka to KONWERSJA subskrybenta na kontakt CRM: zgoda marketingowa
// musi być PRZEPISANA ze stanu subskrybenta, nigdy ustawiona w ciemno, a upsert
// bez dowodu zgody NIE MOŻE nadpisać zgody udowodnionej gdzie indziej (PostgREST
// nadpisuje na konflikcie wszystkie kolumny z payloadu). Stąd dwa osobne upserty
// i osobny test na każdy z nich.
//
// ODCZYT LEJKA idzie spod service-role (atrapa `supabaseAdmin` niżej): widok
// `crm_funnel_view` łączy profile po `profiles.email`, a ta kolumna nie ma
// grantu SELECT dla `authenticated` (20260724090100) - pod klientem staff
// każdy odczyt kończył się 42501. Tu pilnujemy granicy, która pod
// service-role zastępuje RLS: najemca z PROFILU wołającego (nie z ładunku),
// `tenant_id` w każdym zapytaniu do widoku, rola admin/editor jak w polityce
// `newsletter staff read`, kolumny wyłącznie z ekranu.
//
// Autoryzacja i RLS zapisów: pgTAP. Tutaj kształt, zgoda, audyt, ścieżka błędu.
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

// Klient service-role - jedyna droga do widoku lejka.
const h = vi.hoisted(() => ({
  adminFrom: null as ((table: string) => unknown) | null,
}));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: (table: string) => h.adminFrom?.(table) },
}));

import * as funnel from "@/lib/crm-funnel.functions";
import * as savedViews from "@/lib/crm-saved-views.functions";

const SUB_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_SUB = "22222222-2222-4222-8222-222222222222";
const TENANT = "33333333-3333-4333-8333-333333333333";
const USER_ID = "44444444-4444-4444-8444-444444444444";
const VIEW_ID = "55555555-5555-4555-8555-555555555555";

const db = supabaseFromStub();
const admin = supabaseFromStub();
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

/** Kolumny odpowiedzi lejka - dokładnie pola typu `FunnelRow` trasy. */
const KOLUMNY_LEJKA =
  "id, tenant_id, email, first_name, last_name, display_name, language, source, status, confirmed_at, unsubscribed_at, created_at, user_id, profile_id, avatar_url, is_registered, contact_id, is_contact, contact_stage, contact_score";

beforeEach(() => {
  db.reset();
  admin.reset();
  h.adminFrom = (table) => admin.from(table);
  // Wołający: profil w najemcy TENANT, rola admin (odczyt własnych ról).
  db.setResponse("profiles", ok({ tenant_id: TENANT }));
  db.setResponse("user_roles", ok([{ role: "admin" }]));
  rpcCalls = [];
  rpcResults = {};
});

/** Warunki `eq` łańcucha w kolejności wywołania. */
const eqs = (table: string) =>
  admin
    .lastChain(table)
    ?.calls.filter((c) => c.method === "eq")
    .map((c) => c.args);

describe("odczyt lejka - granica najemcy i roli pod service-role", () => {
  const odczyty = [
    [
      "listFunnelSubscribers",
      () => callServerFn(funnel.listFunnelSubscribers, { data: {}, context: context() }),
    ],
    [
      "getFunnelSubscriber",
      () => callServerFn(funnel.getFunnelSubscriber, { data: { id: SUB_ID }, context: context() }),
    ],
    ["funnelStats", () => callServerFn(funnel.funnelStats, { context: context() })],
  ] as const;

  beforeEach(() => {
    admin.setResponse("crm_funnel_view", (chain) =>
      chain.has("maybeSingle") ? ok(subscriber()) : { data: [], error: null, count: 0 },
    );
  });

  it.each(odczyty)(
    "%s: widok czyta WYŁĄCZNIE klient service-role, nigdy klient wołającego",
    async (_n, run) => {
      // Klient wołającego dostałby 42501 z `profiles.email` w złączeniu widoku.
      await run();
      expect(db.chainsFor("crm_funnel_view")).toHaveLength(0);
      expect(admin.chainsFor("crm_funnel_view").length).toBeGreaterThan(0);
      expect(rpcCalls).toEqual([]);
    },
  );

  it.each(odczyty)(
    "%s: KAŻDE zapytanie do widoku niesie najemcę z profilu wołającego",
    async (_n, run) => {
      await run();
      for (const chain of admin.chainsFor("crm_funnel_view")) {
        expect(chain.calls.find((c) => c.method === "eq")?.args).toEqual(["tenant_id", TENANT]);
      }
      // Najemca z PROFILU wołającego pod RLS (filtr po id sesji), nie z ładunku.
      expect(db.lastChain("profiles")?.argsOf("eq")).toEqual(["id", USER_ID]);
    },
  );

  it.each(odczyty)(
    "%s: rola sprawdzana jak w `newsletter staff read` - admin albo editor w TYM najemcy",
    async (_n, run) => {
      await run();
      const role = db.lastChain("user_roles");
      expect(role?.calls.filter((c) => c.method === "eq").map((c) => c.args)).toEqual([
        ["user_id", USER_ID],
        ["tenant_id", TENANT],
      ]);
      // Bez `super_admin` i bez `author`: pod RLS żaden z nich nie widział
      // subskrybentów, więc service-role nie może im ich pokazać.
      expect(role?.argsOf("in")).toEqual(["role", ["admin", "editor"]]);
    },
  );

  it.each(odczyty)("%s: bez roli admin/editor - ODMOWA i zero odczytów widoku", async (_n, run) => {
    db.setResponse("user_roles", ok([]));
    await expect(run()).rejects.toThrow("Forbidden: newsletter staff required");
    expect(admin.chainsFor("crm_funnel_view")).toHaveLength(0);
  });

  it.each(odczyty)("%s: odmowa odczytu ról to odmowa, nie pusty lejek", async (_n, run) => {
    db.setResponse("user_roles", fail("permission denied for table user_roles"));
    await expect(run()).rejects.toThrow("permission denied for table user_roles");
    expect(admin.chainsFor("crm_funnel_view")).toHaveLength(0);
  });

  it.each(odczyty)(
    "%s: nierozpoznany najemca wołającego - odmowa, nigdy „pokaż wszystko”",
    async (_n, run) => {
      db.setResponse("profiles", ok(null));
      await expect(run()).rejects.toThrow("tenant_unresolved");
      expect(admin.chainsFor("crm_funnel_view")).toHaveLength(0);
    },
  );
});

describe("listFunnelSubscribers", () => {
  it("czyta widok lejka z domyślnym limitem i porządkiem", async () => {
    admin.setResponse("crm_funnel_view", () => ok([{ id: SUB_ID }]));
    const result = await callServerFn(funnel.listFunnelSubscribers, {
      data: {},
      context: context(),
    });
    expect(parsed(result)).toEqual([{ id: SUB_ID }]);
    const chain = admin.lastChain("crm_funnel_view");
    expect(chain?.argsOf("order")).toEqual(["created_at", { ascending: false }]);
    expect(chain?.argsOf("limit")).toEqual([200]);
  });

  it("pyta o kolumny ekranu, nie o `*` - bez `consents` i bez kolumn spoza listy", async () => {
    admin.setResponse("crm_funnel_view", () => ok([]));
    await callServerFn(funnel.listFunnelSubscribers, { data: {}, context: context() });
    expect(admin.lastChain("crm_funnel_view")?.argsOf("select")).toEqual([KOLUMNY_LEJKA]);
  });

  it("każdy wariant odbiorcy zawęża zapytanie po swojej fladze", async () => {
    const cases: Array<[string, [string, boolean]]> = [
      ["registered", ["is_registered", true]],
      ["unregistered", ["is_registered", false]],
      ["contact", ["is_contact", true]],
      ["non_contact", ["is_contact", false]],
    ];
    for (const [audience, expected] of cases) {
      admin.reset();
      admin.setResponse("crm_funnel_view", () => ok([]));
      await callServerFn(funnel.listFunnelSubscribers, { data: { audience }, context: context() });
      expect(eqs("crm_funnel_view")).toEqual([["tenant_id", TENANT], expected]);
    }
  });

  it("odbiorca „wszyscy” nie dokłada warunku poza granicą najemcy", async () => {
    admin.setResponse("crm_funnel_view", () => ok([]));
    await callServerFn(funnel.listFunnelSubscribers, {
      data: { audience: "all" },
      context: context(),
    });
    expect(eqs("crm_funnel_view")).toEqual([["tenant_id", TENANT]]);
  });

  it("status, źródło, język i zakres dat trafiają do zapytania", async () => {
    admin.setResponse("crm_funnel_view", () => ok([]));
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
    const chain = admin.lastChain("crm_funnel_view");
    expect(eqs("crm_funnel_view")).toEqual([
      ["tenant_id", TENANT],
      ["status", "pending"],
      ["source", "stopka"],
      ["language", "en"],
    ]);
    expect(chain?.argsOf("gte")).toEqual(["created_at", "2026-08-01T00:00:00.000Z"]);
    expect(chain?.argsOf("lte")).toEqual(["created_at", "2026-08-31T00:00:00.000Z"]);
  });

  it("fraza traci metaznaki, więc nie dopisze warunku do zapytania", async () => {
    admin.setResponse("crm_funnel_view", () => ok([]));
    await callServerFn(funnel.listFunnelSubscribers, {
      data: { search: 'Kowal%ska_,("x")' },
      context: context(),
    });
    const or = String(admin.lastChain("crm_funnel_view")?.argsOf("or")?.[0] ?? "");
    expect(or.split(",")).toEqual([
      "email.ilike.%Kowalskax%",
      "first_name.ilike.%Kowalskax%",
      "last_name.ilike.%Kowalskax%",
      "display_name.ilike.%Kowalskax%",
    ]);
  });

  it("pusta fraza nie dokłada warunku", async () => {
    admin.setResponse("crm_funnel_view", () => ok([]));
    await callServerFn(funnel.listFunnelSubscribers, {
      data: { search: "   " },
      context: context(),
    });
    expect(admin.lastChain("crm_funnel_view")?.has("or")).toBe(false);
  });

  it("błąd odczytu wychodzi na zewnątrz", async () => {
    admin.setResponse("crm_funnel_view", () => fail("boom"));
    await expect(
      callServerFn(funnel.listFunnelSubscribers, { data: {}, context: context() }),
    ).rejects.toThrow("boom");
  });
});

describe("getFunnelSubscriber", () => {
  it("oddaje jeden wiersz widoku - z najemcy wołającego, kolumnami ekranu", async () => {
    admin.setResponse("crm_funnel_view", () => ok({ id: SUB_ID, email: "a@example.test" }));
    const result = await callServerFn(funnel.getFunnelSubscriber, {
      data: { id: SUB_ID },
      context: context(),
    });
    expect(parsed(result)).toMatchObject({ id: SUB_ID });
    expect(eqs("crm_funnel_view")).toEqual([
      ["tenant_id", TENANT],
      ["id", SUB_ID],
    ]);
    expect(admin.lastChain("crm_funnel_view")?.argsOf("select")).toEqual([KOLUMNY_LEJKA]);
  });

  it("brak wiersza to not_found", async () => {
    admin.setResponse("crm_funnel_view", () => ok(null));
    await expect(
      callServerFn(funnel.getFunnelSubscriber, { data: { id: SUB_ID }, context: context() }),
    ).rejects.toThrow("not_found");
  });

  it("błąd odczytu wychodzi na zewnątrz", async () => {
    admin.setResponse("crm_funnel_view", () => fail("boom"));
    await expect(
      callServerFn(funnel.getFunnelSubscriber, { data: { id: SUB_ID }, context: context() }),
    ).rejects.toThrow("boom");
  });
});

describe("funnelStats", () => {
  /** Odpowiedź zapytania liczącego: licznik zależny od filtra łańcucha. */
  function liczniki(per: Record<string, number>, blad?: string) {
    admin.setResponse("crm_funnel_view", (chain) => {
      const warunki = chain.calls
        .filter((c) => c.method === "eq" && c.args[0] !== "tenant_id")
        .map((c) => `${String(c.args[0])}=${String(c.args[1])}`);
      const klucz = warunki.join("&") || "total";
      if (blad && klucz === "is_contact=true") return fail(blad);
      return { data: null, error: null, count: per[klucz] ?? null };
    });
  }

  it("sześć liczników liczy baza - zapytania liczące nad widokiem, każde w najemcy wołającego", async () => {
    liczniki({
      total: 10,
      "status=subscribed": 7,
      "status=pending": 2,
      "status=unsubscribed": 1,
      "is_registered=true": 4,
      "is_contact=true": 3,
    });
    const result = await callServerFn(funnel.funnelStats, { context: context() });
    expect(result).toEqual({
      total: 10,
      subscribed: 7,
      pending: 2,
      unsubscribed: 1,
      registered: 4,
      contacts: 3,
    });
    const lancuchy = admin.chainsFor("crm_funnel_view");
    expect(lancuchy).toHaveLength(6);
    for (const chain of lancuchy) {
      // Sam licznik, bez wierszy - i bez kolumn spoza widoku.
      expect(chain.argsOf("select")).toEqual(["id", { count: "exact", head: true }]);
      expect(chain.calls.find((c) => c.method === "eq")?.args).toEqual(["tenant_id", TENANT]);
    }
    // `crm_funnel_stats` (SECURITY INVOKER bez filtra najemcy) nie jest wołane.
    expect(rpcCalls).toEqual([]);
  });

  it("brak licznika daje zero zamiast NaN", async () => {
    liczniki({});
    expect(await callServerFn(funnel.funnelStats, { context: context() })).toEqual({
      total: 0,
      subscribed: 0,
      pending: 0,
      unsubscribed: 0,
      registered: 0,
      contacts: 0,
    });
  });

  it("odmowa JEDNEGO licznika wywraca podsumowanie - licznik z odmowy to nie zero", async () => {
    liczniki({ total: 10 }, "stats down");
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

    const [withConsent, upsertOptions] = upserts[0] as [Array<Record<string, unknown>>, unknown];
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
    expect(upsertOptions).toEqual({ onConflict: "tenant_id,email_norm" });
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
      expect(serverFnMiddlewareNames(value), `${name} bez bramki`).toContain("requireCrmStaff");
    }
  });
});
