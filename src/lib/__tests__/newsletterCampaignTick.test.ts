// Tick kampanii: odpalanie zaplanowanych wysyłek i WZNAWIANIE porcji.
//
// Ta pętla działa BEZ CZŁOWIEKA PRZY KLAWIATURZE, co zmienia wagę dwóch
// rzeczy, których w wysyłce ręcznej pilnuje operator:
//   1. przy przekroczonym progu skarg kampania zaplanowana NIE MOŻE wyjść po
//      cichu - zatrzymujemy ją ze statusem `failed` i czytelnym powodem,
//      żeby admin zobaczył to na liście i wznowił świadomie,
//   2. budżet wywołania jest wspólny dla wszystkich kampanii ticku - inaczej
//      jedna wielka lista zjadłaby limit dostawcy i zablokowała pozostałe.
//
// Trzecia reguła to atomowość: dwa równoległe ticki (druga karta admina, cron)
// nie mogą odpalić tej samej kampanii dwa razy - stąd przejęcie przez UPDATE
// z warunkiem na status i dzierżawę.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ok, fail, supabaseFromStub, type RecordedChain } from "@/test/supabaseChain";

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  sendEmail: vi.fn(),
  fetchSuppressedEmails: vi.fn(),
  evaluateSendGate: vi.fn(),
}));

vi.mock("@tanstack/react-start", async () =>
  (await import("@/test/serverFn")).serverFnModuleMock(),
);
vi.mock("@/integrations/supabase/require-staff", () => ({
  requireStaff: { __mw: "requireStaff" },
  requireAdminEditor: { __mw: "requireAdminEditor" },
}));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: (t: string) => db.from(t), rpc: h.rpc },
}));
vi.mock("@/lib/email/provider.server", () => ({ sendEmail: h.sendEmail }));
vi.mock("@/lib/email/suppression.server", () => ({
  fetchSuppressedEmails: h.fetchSuppressedEmails,
}));
vi.mock("@/lib/email/reputationGate.server", () => ({ evaluateSendGate: h.evaluateSendGate }));

import { tickNewsletterCampaigns } from "@/lib/newsletter-campaigns.functions";

const db = supabaseFromStub();
const CAMPAIGNS = "newsletter_campaigns";
const SUBSCRIBERS = "newsletter_subscribers";
const RECIPIENTS = "newsletter_campaign_recipients";

const TENANT = "tenant-1";
const DUE_ID = "11111111-1111-1111-1111-111111111111";
const CONT_ID = "22222222-2222-2222-2222-222222222222";

interface Plan {
  due: Record<string, unknown>[];
  continuing: Record<string, unknown>[];
  audience: Record<string, unknown>[];
}
let plan: Plan;

function campaignRow(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    tenant_id: TENANT,
    status: "sending",
    editor: "html",
    subject_pl: "Temat",
    subject_en: "Subject",
    html_pl: "<p>PL</p>",
    html_en: "<p>EN</p>",
    from_name: "NES",
    from_email: "biuro@example.test",
    reply_to: null,
    audience_filter: {},
    content_doc: null,
    ...overrides,
  };
}

/** Atrapa klienta admina (tick dostaje go w argumencie). */
const admin = () => ({ from: db.from, rpc: h.rpc }) as never;

/** Kolejność zapytań do tabeli kampanii pozwala odróżnić listę zaległych od kontynuacji. */
function campaignsResponder(chain: RecordedChain) {
  // Przejęcie: UPDATE ... .select().maybeSingle()
  if (chain.has("update") && chain.has("select")) {
    const id = String(chain.argsOf("eq")?.[1] ?? "");
    return ok(campaignRow(id));
  }
  if (chain.has("update")) return ok(null);
  // Listy: rozróżniane po filtrze statusu.
  const statusArg = chain.calls.find((c) => c.method === "eq" && c.args[0] === "status")?.args[1];
  if (statusArg === "scheduled") return ok(plan.due);
  if (statusArg === "sending") return ok(plan.continuing);
  return ok(null);
}

let savedSiteUrl: string | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  savedSiteUrl = process.env.PUBLIC_SITE_URL;
  process.env.PUBLIC_SITE_URL = "https://example.test";

  plan = { due: [], continuing: [], audience: [] };

  db.reset();
  db.setResponse(CAMPAIGNS, campaignsResponder);
  db.setResponse(SUBSCRIBERS, () => ok(plan.audience));
  db.setResponse(RECIPIENTS, (chain: RecordedChain) => (chain.has("upsert") ? ok(null) : ok([])));

  h.rpc.mockResolvedValue({ data: null, error: null });
  h.sendEmail.mockResolvedValue({ ok: true, messageId: "m-1" });
  h.fetchSuppressedEmails.mockResolvedValue(new Map());
  h.evaluateSendGate.mockResolvedValue({ allowed: true, errorCode: null });
});

afterEach(() => {
  if (savedSiteUrl === undefined) delete process.env.PUBLIC_SITE_URL;
  else process.env.PUBLIC_SITE_URL = savedSiteUrl;
});

function subscriber(i: number) {
  return {
    id: `sub-${i}`,
    email: `odbiorca${i}@example.test`,
    first_name: null,
    last_name: null,
    language: "pl",
    unsubscribe_token: `tok-${i}`,
  };
}

describe("brak pracy", () => {
  it("pusty tick nic nie wysyła", async () => {
    const res = await tickNewsletterCampaigns(admin());

    expect(res).toEqual({ fired: 0, continued: 0, sent: 0 });
    expect(h.sendEmail).not.toHaveBeenCalled();
  });

  it("pyta wyłącznie o kampanie, których termin JUŻ minął", async () => {
    await tickNewsletterCampaigns(admin());

    const dueQuery = db.chainsFor(CAMPAIGNS)[0];
    expect(dueQuery?.has("lte")).toBe(true);
    expect(dueQuery?.argsOf("order")).toEqual(["scheduled_at", { ascending: true }]);
  });

  it("tick tenanta zawęża obie listy do jego kampanii", async () => {
    await tickNewsletterCampaigns(admin(), { tenantId: TENANT });

    for (const chain of db.chainsFor(CAMPAIGNS)) {
      const eqs = chain.calls.filter((c) => c.method === "eq").map((c) => c.args[0]);
      expect(eqs).toContain("tenant_id");
    }
  });

  it("błąd odczytu zaległych kampanii leci w górę", async () => {
    db.setResponse(CAMPAIGNS, fail("due read failed"));

    await expect(tickNewsletterCampaigns(admin())).rejects.toThrow("due read failed");
  });
});

describe("odpalanie zaplanowanych", () => {
  it("wysyła zaległą kampanię i liczy ją jako odpaloną", async () => {
    plan.due = [{ id: DUE_ID, tenant_id: TENANT }];
    plan.audience = [subscriber(1)];

    const res = await tickNewsletterCampaigns(admin());

    expect(res.fired).toBe(1);
    expect(res.sent).toBe(1);
    expect(h.sendEmail).toHaveBeenCalledTimes(1);
  });

  it("PRZEKROCZONY próg skarg zatrzymuje kampanię bez człowieka przy klawiaturze", async () => {
    plan.due = [{ id: DUE_ID, tenant_id: TENANT }];
    plan.audience = [subscriber(1)];
    h.evaluateSendGate.mockResolvedValue({ allowed: false, errorCode: "reputation_blocked" });

    const res = await tickNewsletterCampaigns(admin());

    expect(res.fired).toBe(0);
    expect(h.sendEmail).not.toHaveBeenCalled();
    // Admin ma to zobaczyć na liście, a nie zgadywać, czemu nic nie wyszło.
    const failedUpdate = db
      .chainsFor(CAMPAIGNS)
      .map((c) => c.argsOf("update")?.[0] as Record<string, unknown> | undefined)
      .find((u) => u?.status === "failed");
    expect(failedUpdate).toMatchObject({ last_error: "reputation_blocked" });
  });

  it("bramkę reputacji liczymy RAZ na tenanta, nie raz na kampanię", async () => {
    plan.due = [
      { id: DUE_ID, tenant_id: TENANT },
      { id: CONT_ID, tenant_id: TENANT },
    ];
    plan.audience = [subscriber(1)];

    await tickNewsletterCampaigns(admin());

    expect(h.evaluateSendGate).toHaveBeenCalledTimes(1);
  });

  it("kampania przejęta przez równoległy tick jest pomijana", async () => {
    plan.due = [{ id: DUE_ID, tenant_id: TENANT }];
    db.setResponse(CAMPAIGNS, (chain: RecordedChain) => {
      if (chain.has("update") && chain.has("select")) return ok(null); // ktoś był szybszy
      if (chain.has("update")) return ok(null);
      const statusArg = chain.calls.find((c) => c.method === "eq" && c.args[0] === "status")
        ?.args[1];
      return statusArg === "scheduled" ? ok(plan.due) : ok([]);
    });

    const res = await tickNewsletterCampaigns(admin());

    expect(res.fired).toBe(0);
    expect(h.sendEmail).not.toHaveBeenCalled();
  });

  it("zepsuta kampania NIE blokuje pozostałych zaległych", async () => {
    plan.due = [
      { id: DUE_ID, tenant_id: TENANT },
      { id: CONT_ID, tenant_id: TENANT },
    ];
    plan.audience = [subscriber(1)];
    // Pierwsza kampania wywala się na odczycie audiencji, druga idzie normalnie.
    let audienceCall = 0;
    db.setResponse(SUBSCRIBERS, () => {
      audienceCall += 1;
      return audienceCall === 1 ? fail("audience blew up") : ok(plan.audience);
    });

    const res = await tickNewsletterCampaigns(admin());

    expect(res.fired).toBe(2);
    expect(h.sendEmail).toHaveBeenCalledTimes(1);
  });
});

describe("wznawianie przerwanych", () => {
  it("podejmuje kampanię `sending` z oddaną dzierżawą", async () => {
    plan.continuing = [{ id: CONT_ID, tenant_id: TENANT }];
    plan.audience = [subscriber(1)];

    const res = await tickNewsletterCampaigns(admin());

    expect(res.continued).toBe(1);
    expect(res.sent).toBe(1);
  });

  it("szuka kontynuacji po NAJSTARSZEJ rozpoczętej", async () => {
    plan.continuing = [{ id: CONT_ID, tenant_id: TENANT }];
    plan.audience = [subscriber(1)];

    await tickNewsletterCampaigns(admin());

    const contQuery = db
      .chainsFor(CAMPAIGNS)
      .find(
        (c) => c.calls.some((x) => x.method === "eq" && x.args[1] === "sending") && c.has("or"),
      );
    expect(contQuery?.argsOf("order")).toEqual(["started_at", { ascending: true }]);
    expect(String(contQuery?.argsOf("or")?.[0])).toContain("lease_until.is.null");
  });

  it("błąd odczytu kontynuacji leci w górę", async () => {
    db.setResponse(CAMPAIGNS, (chain: RecordedChain) => {
      const statusArg = chain.calls.find((c) => c.method === "eq" && c.args[0] === "status")
        ?.args[1];
      if (statusArg === "scheduled") return ok([]);
      if (statusArg === "sending") return fail("continuation read failed");
      return ok(null);
    });

    await expect(tickNewsletterCampaigns(admin())).rejects.toThrow("continuation read failed");
  });
});

describe("budżet wywołania", () => {
  it("jest WSPÓLNY - wyczerpany przez pierwszą kampanię zatrzymuje kolejne", async () => {
    plan.due = [
      { id: DUE_ID, tenant_id: TENANT },
      { id: CONT_ID, tenant_id: TENANT },
    ];
    plan.audience = [subscriber(1), subscriber(2)];

    const res = await tickNewsletterCampaigns(admin(), { maxEmails: 2 });

    // Pierwsza kampania zjada cały budżet; druga czeka na kolejny tick.
    expect(res.fired).toBe(1);
    expect(h.sendEmail).toHaveBeenCalledTimes(2);
    expect(res.sent).toBe(2);
  });

  it("wyczerpany budżet blokuje też etap kontynuacji", async () => {
    plan.due = [{ id: DUE_ID, tenant_id: TENANT }];
    plan.continuing = [{ id: CONT_ID, tenant_id: TENANT }];
    plan.audience = [subscriber(1)];

    const res = await tickNewsletterCampaigns(admin(), { maxEmails: 1 });

    expect(res.fired).toBe(1);
    expect(res.continued).toBe(0);
    expect(h.sendEmail).toHaveBeenCalledTimes(1);
  });

  it("porcja mniejsza niż audiencja zostawia resztę na kolejny tick", async () => {
    plan.due = [{ id: DUE_ID, tenant_id: TENANT }];
    plan.audience = [subscriber(1), subscriber(2), subscriber(3)];

    const res = await tickNewsletterCampaigns(admin(), { maxEmails: 2 });

    expect(h.sendEmail).toHaveBeenCalledTimes(2);
    // Kampania zostaje w `sending` z oddaną dzierżawą - gotowa do podjęcia.
    const lastUpdate = db
      .chainsFor(CAMPAIGNS)
      .map((c) => c.argsOf("update")?.[0] as Record<string, unknown> | undefined)
      .filter(Boolean)
      .at(-1);
    expect(lastUpdate).toMatchObject({ lease_until: null });
    expect(res.sent).toBe(2);
  });
});
