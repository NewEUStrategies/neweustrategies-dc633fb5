// Kampania KUPONOWA newslettera (P04) - serwer wysyłki.
//
// Dawniej panel tworzył kampanię newslettera z `{{coupon_code}}` i od razu
// ustawiał kampanii kuponowej `sent`, filtr `segment` był po cichu odrzucany
// przez zod (kampania szła do CAŁEJ listy), a renderer nie znał tagu - więc
// odbiorcy dostawali surowe `{{coupon_code}}`. Ten plik przypina zachowanie
// po naprawie, na którym opiera się zaufanie do kodów rabatowych:
//   * wysyłka idzie WYŁĄCZNIE do segmentu (2 z 3 subskrybentów), każdy dostaje
//     INNY kod, a przypisanie ląduje w `b2b_coupons.metadata`;
//   * status `sent` kampanii kuponowej ustawia serwer - dopiero po wysyłce,
//     nigdy przy wysyłce w całości nieudanej;
//   * za mało kodów = błąd z liczbami i ZERO maili;
//   * wznowienie po przerwanej wysyłce używa kodu już przypisanego;
//   * tworzenie kampanii newslettera dla kuponowej jest idempotentne, a
//     edytor kampanii widzi stan puli kodów; wysyłka testowa nigdy nie
//     wysyła surowego tagu.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ok, supabaseFromStub, type RecordedChain } from "@/test/supabaseChain";
import { resetServerFnContext, setServerFnContext } from "@/test/serverFn";

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  sendEmail: vi.fn(),
  fetchSuppressedEmails: vi.fn(),
  evaluateSendGate: vi.fn(),
  events: [] as string[],
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

import {
  createCouponNewsletterCampaign,
  getCampaign,
  sendCampaign,
  sendCampaignTest,
} from "@/lib/newsletter-campaigns.functions";

const db = supabaseFromStub();
const CAMPAIGNS = "newsletter_campaigns";
const SUBSCRIBERS = "newsletter_subscribers";
const RECIPIENTS = "newsletter_campaign_recipients";
const COUPONS = "b2b_coupons";
const COUPON_CAMPAIGNS = "b2b_coupon_campaigns";
const SETTINGS = "newsletter_settings";
const PROFILES = "profiles";

const TENANT = "tenant-1";
const CAMPAIGN_ID = "11111111-2222-3333-4444-555555555555";
const COUPON_CAMPAIGN_ID = "99999999-8888-7777-6666-555555555555";

interface CodeRow {
  id: string;
  code: string;
  active: boolean;
  metadata: Record<string, unknown>;
}

interface Plan {
  claimed: Record<string, unknown> | null;
  audience: Record<string, unknown>[];
  logged: Record<string, unknown>[];
  codes: CodeRow[];
  lists: { id: string; label_pl: string; label_en: string }[];
  couponRow: Record<string, unknown> | null;
  linkWins: boolean;
}

let plan: Plan;

function couponLink(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: COUPON_CAMPAIGN_ID,
    tenant_id: TENANT,
    name: "Jesień",
    status: "generated",
    newsletter_segment: "ekonomia",
    ...overrides,
  };
}

function campaign(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: CAMPAIGN_ID,
    tenant_id: TENANT,
    status: "draft",
    editor: "html",
    subject_pl: "Twój kod",
    subject_en: "Your code",
    html_pl: "<p>Kod: {{coupon_code}}</p>",
    html_en: "<p>Code: {{coupon_code}}</p>",
    from_name: "NES",
    from_email: "biuro@example.test",
    reply_to: null,
    audience_filter: { segment: "ekonomia" },
    content_doc: null,
    coupon_link: [couponLink()],
    ...overrides,
  };
}

function subscriber(id: string, lists: string): Record<string, unknown> {
  return {
    id,
    email: `${id}@example.test`,
    first_name: "Ola",
    last_name: "Nowak",
    language: "pl",
    unsubscribe_token: `unsub-${id}`,
    meta: { mailing_lists: lists },
  };
}

function code(id: string, value: string, metadata: Record<string, unknown> = {}): CodeRow {
  return { id, code: value, active: true, metadata };
}

function filterValue(chain: RecordedChain, method: string, column: string): unknown {
  return chain.calls.find((c) => c.method === method && c.args[0] === column)?.args[1];
}

/** Atrapa `b2b_coupons`: odczyt przypisanych, puli wolnych i warunkowe przypisanie. */
function couponsResponder(chain: RecordedChain) {
  const assignedKey = "metadata->>assigned_subscriber_id";
  if (chain.has("update")) {
    const id = filterValue(chain, "eq", "id");
    const row = plan.codes.find((c) => c.id === id);
    const patch = chain.argsOf("update")?.[0] as { metadata: Record<string, unknown> };
    // Warunek „nadal wolny" - jak w bazie.
    if (!row || row.metadata.assigned_subscriber_id !== undefined) return ok([]);
    row.metadata = patch.metadata;
    h.events.push(`assign:${row.code}`);
    return ok([{ id: row.id }]);
  }
  const forIds = filterValue(chain, "in", assignedKey) as string[] | undefined;
  if (forIds) {
    return ok(
      plan.codes.filter((c) => forIds.includes(String(c.metadata.assigned_subscriber_id ?? ""))),
    );
  }
  if (chain.calls.some((c) => c.method === "is" && c.args[0] === assignedKey)) {
    const free = plan.codes.filter(
      (c) => c.active && c.metadata.assigned_subscriber_id === undefined,
    );
    const limit = chain.argsOf("limit")?.[0] as number | undefined;
    const head = chain.argsOf("select")?.[1] as { head?: boolean } | undefined;
    if (head?.head) return { data: null, error: null, count: free.length };
    return { data: free.slice(0, limit ?? free.length), error: null, count: free.length };
  }
  if ((chain.argsOf("select")?.[1] as { head?: boolean } | undefined)?.head) {
    return { data: null, error: null, count: plan.codes.length };
  }
  return ok(plan.codes);
}

function couponCampaignUpdates(): Array<{ patch: unknown; chain: RecordedChain }> {
  return db
    .chainsFor(COUPON_CAMPAIGNS)
    .filter((c) => c.has("update"))
    .map((c) => ({ patch: c.argsOf("update")?.[0], chain: c }));
}

const ENV_KEYS = ["PUBLIC_SITE_URL", "SITE_URL", "URL"] as const;
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  vi.clearAllMocks();
  h.events.length = 0;
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const key of ENV_KEYS) delete process.env[key];
  process.env.PUBLIC_SITE_URL = "https://example.test";

  plan = {
    claimed: campaign(),
    audience: [
      subscriber("s1", "ekonomia"),
      subscriber("s2", "kultura,ekonomia"),
      subscriber("s3", "kultura"),
    ],
    logged: [],
    codes: [code("c1", "KOD-AAA1"), code("c2", "KOD-BBB2"), code("c3", "KOD-CCC3")],
    lists: [
      { id: "ekonomia", label_pl: "Ekonomia", label_en: "Economy" },
      { id: "kultura", label_pl: "Kultura", label_en: "Culture" },
    ],
    couponRow: {
      id: COUPON_CAMPAIGN_ID,
      name: "Jesień <VIP>",
      status: "generated",
      valid_until: "2026-12-31T22:59:59.000Z",
      newsletter_segment: "ekonomia",
      newsletter_campaign_id: null,
    },
    linkWins: true,
  };

  db.reset();
  db.setResponse(PROFILES, ok({ tenant_id: TENANT }));
  db.setResponse(SUBSCRIBERS, () => ok(plan.audience));
  db.setResponse(RECIPIENTS, (chain) => (chain.has("upsert") ? ok(null) : ok(plan.logged)));
  db.setResponse(SETTINGS, () => ok({ popup_mailing_lists: plan.lists }));
  db.setResponse(COUPONS, couponsResponder);
  db.setResponse(COUPON_CAMPAIGNS, (chain) => {
    if (chain.has("update")) {
      h.events.push(`coupon-campaign:${JSON.stringify(chain.argsOf("update")?.[0])}`);
      if (chain.has("select")) return ok(plan.linkWins ? [{ id: COUPON_CAMPAIGN_ID }] : []);
      return ok(null);
    }
    return ok(plan.couponRow);
  });
  db.setResponse(CAMPAIGNS, (chain) => {
    if (chain.has("update") && chain.has("select")) return ok(plan.claimed);
    if (chain.has("update") || chain.has("delete")) return ok(null);
    if (chain.has("insert")) return ok({ id: "nowa-kampania" });
    if (String(chain.argsOf("select")?.[0] ?? "") === "status") return ok({ status: "draft" });
    return ok(plan.claimed);
  });

  setServerFnContext({ supabase: { from: db.from, rpc: h.rpc }, userId: "user-1" });
  h.rpc.mockResolvedValue({ data: null, error: null });
  h.sendEmail.mockImplementation(async (msg: { to: string }) => {
    h.events.push(`mail:${msg.to}`);
    return { ok: true, messageId: `m-${msg.to}` };
  });
  h.fetchSuppressedEmails.mockResolvedValue(new Map());
  h.evaluateSendGate.mockResolvedValue({ allowed: true, errorCode: null });
});

afterEach(() => {
  resetServerFnContext();
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function mailedCodes(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [msg] of h.sendEmail.mock.calls as Array<[{ to: string; html: string }]>) {
    const match = /Kod: (KOD-[A-Z0-9]+)/.exec(msg.html);
    out[msg.to] = match?.[1] ?? "<brak>";
  }
  return out;
}

describe("wysyłka kampanii kuponowej", () => {
  it("dokładnie 2 maile (segment), różne kody, przypisanie w metadata, sent po wysyłce", async () => {
    const res = await sendCampaign({ data: { id: CAMPAIGN_ID } });

    expect(res).toMatchObject({ sent: 2, failed: 0, done: true });
    expect(h.sendEmail).toHaveBeenCalledTimes(2);
    const codes = mailedCodes();
    expect(Object.keys(codes).sort()).toEqual(["s1@example.test", "s2@example.test"]);
    expect(new Set(Object.values(codes)).size).toBe(2);
    for (const html of h.sendEmail.mock.calls.map(([m]) => (m as { html: string }).html)) {
      expect(html).not.toContain("{{coupon_code}}");
    }

    // Przypisanie: kod -> subskrybent i kampania newslettera, metadata scalone.
    const assigned = plan.codes.filter((c) => c.metadata.assigned_subscriber_id !== undefined);
    expect(assigned.map((c) => c.metadata.assigned_subscriber_id).sort()).toEqual(["s1", "s2"]);
    for (const row of assigned) {
      expect(row.metadata.assigned_newsletter_campaign_id).toBe(CAMPAIGN_ID);
      expect(codes[`${String(row.metadata.assigned_subscriber_id)}@example.test`]).toBe(row.code);
    }

    // `sent` kampanii kuponowej: klient serwisowy, po ostatnim mailu,
    // zawężony do najemcy i powiązania, nigdy z archiwum.
    const updates = couponCampaignUpdates();
    expect(updates).toHaveLength(1);
    expect(updates[0]!.patch).toEqual({ status: "sent" });
    expect(filterValue(updates[0]!.chain, "eq", "tenant_id")).toBe(TENANT);
    expect(filterValue(updates[0]!.chain, "eq", "newsletter_campaign_id")).toBe(CAMPAIGN_ID);
    expect(filterValue(updates[0]!.chain, "neq", "status")).toBe("archived");
    const lastMail = h.events
      .map((e, i) => (e.startsWith("mail:") ? i : -1))
      .reduce((a, b) => Math.max(a, b));
    const sentMark = h.events.findIndex((e) => e.startsWith("coupon-campaign:"));
    expect(sentMark).toBeGreaterThan(lastMail);
  });

  it("wszystkie wysyłki nieudane -> kampania kuponowa NIE dostaje sent", async () => {
    h.sendEmail.mockResolvedValue({ ok: false, error: "provider_down", status: 503 });

    const res = await sendCampaign({ data: { id: CAMPAIGN_ID } });

    expect(res).toMatchObject({ sent: 0, failed: 2 });
    expect(couponCampaignUpdates()).toHaveLength(0);
  });

  it("za mało kodów -> błąd z liczbami i ZERO maili, bez przypisań", async () => {
    plan.codes = [code("c1", "KOD-AAA1")];

    await expect(sendCampaign({ data: { id: CAMPAIGN_ID } })).rejects.toThrow(
      "COUPON_CODES_INSUFFICIENT:2:1",
    );
    expect(h.sendEmail).not.toHaveBeenCalled();
    expect(plan.codes[0]!.metadata.assigned_subscriber_id).toBeUndefined();
    expect(couponCampaignUpdates()).toHaveLength(0);
    // Kampania newslettera zatrzymana z czytelnym kodem błędu.
    const failedUpdate = db
      .chainsFor(CAMPAIGNS)
      .map((c) => c.argsOf("update")?.[0] as Record<string, unknown> | undefined)
      .find((u) => u?.status === "failed");
    expect(failedUpdate?.last_error).toBe("COUPON_CODES_INSUFFICIENT:2:1");
  });

  it("kody nieaktywne nie wchodzą do puli", async () => {
    plan.codes = [code("c1", "KOD-AAA1"), { ...code("c2", "KOD-BBB2"), active: false }];

    await expect(sendCampaign({ data: { id: CAMPAIGN_ID } })).rejects.toThrow(
      "COUPON_CODES_INSUFFICIENT:2:1",
    );
    expect(h.sendEmail).not.toHaveBeenCalled();
  });

  it("wznowienie: odbiorca z przypisanym kodem dostaje TEN SAM kod, nie drugi", async () => {
    // Poprzedni przebieg przypisał s1 kod KOD-CCC3 i padł przed wysyłką.
    plan.codes = [
      code("c1", "KOD-AAA1"),
      code("c3", "KOD-CCC3", {
        assigned_subscriber_id: "s1",
        assigned_newsletter_campaign_id: CAMPAIGN_ID,
      }),
    ];
    plan.claimed = campaign({ status: "sending" });

    await sendCampaign({ data: { id: CAMPAIGN_ID } });

    expect(mailedCodes()).toEqual({
      "s1@example.test": "KOD-CCC3",
      "s2@example.test": "KOD-AAA1",
    });
    // Jedno nowe przypisanie (s2); kod s1 nie był ruszany.
    expect(h.events.filter((e) => e.startsWith("assign:"))).toEqual(["assign:KOD-AAA1"]);
  });

  it("odbiorcy już wysłani nie zużywają kodów przy kolejnej porcji", async () => {
    plan.logged = [{ email: "s1@example.test", status: "sent" }];
    plan.codes = [code("c1", "KOD-AAA1")];
    plan.claimed = campaign({ status: "sending" });

    const res = await sendCampaign({ data: { id: CAMPAIGN_ID } });

    expect(res).toMatchObject({ sent: 2, done: true });
    expect(h.sendEmail).toHaveBeenCalledTimes(1);
    expect(mailedCodes()).toEqual({ "s2@example.test": "KOD-AAA1" });
  });
});

describe("createCouponNewsletterCampaign", () => {
  it("tworzy SZKIC z szablonem {{coupon_code}}, segmentem i podpina go klientem serwisowym", async () => {
    const res = await createCouponNewsletterCampaign({
      data: { couponCampaignId: COUPON_CAMPAIGN_ID },
    });

    expect(res).toEqual({ newsletterCampaignId: "nowa-kampania" });
    const inserted = db
      .chainsFor(CAMPAIGNS)
      .find((c) => c.has("insert"))
      ?.argsOf("insert")?.[0] as Record<string, unknown> | undefined;
    expect(inserted).toMatchObject({
      tenant_id: TENANT,
      status: "draft",
      editor: "html",
      audience_filter: { segment: "ekonomia" },
      created_by: "user-1",
      subject_pl: "Twój kod rabatowy - Jesień <VIP>",
    });
    expect(String(inserted?.html_pl)).toContain("{{coupon_code}}");
    expect(String(inserted?.html_en)).toContain("{{coupon_code}}");
    // Nazwa trafia do HTML-a escapowana; ważność w obu językach.
    expect(String(inserted?.html_pl)).toContain("Jesień &lt;VIP&gt;");
    expect(String(inserted?.html_pl)).toContain("Kod jest ważny do 31 grudnia 2026");
    expect(String(inserted?.html_en)).toContain("valid until 31 December 2026");

    const link = couponCampaignUpdates()[0];
    expect(link?.patch).toEqual({ newsletter_campaign_id: "nowa-kampania" });
    expect(filterValue(link!.chain, "eq", "tenant_id")).toBe(TENANT);
    expect(filterValue(link!.chain, "is", "newsletter_campaign_id")).toBeNull();
    // NIE ustawia `sent` - to robi dopiero wysyłka.
    expect(JSON.stringify(couponCampaignUpdates().map((u) => u.patch))).not.toContain("sent");
  });

  it("idempotentne: kampania już podpięta zwraca tę samą kampanię newslettera bez zapisu", async () => {
    plan.couponRow = { ...plan.couponRow, newsletter_campaign_id: "istniejaca" };

    await expect(
      createCouponNewsletterCampaign({ data: { couponCampaignId: COUPON_CAMPAIGN_ID } }),
    ).resolves.toEqual({ newsletterCampaignId: "istniejaca" });
    expect(db.chainsFor(CAMPAIGNS).some((c) => c.has("insert"))).toBe(false);
  });

  it("przegrany wyścig: szkic sprzątnięty, zwrócona kampania zwycięzcy", async () => {
    plan.linkWins = false;
    let reads = 0;
    db.setResponse(COUPON_CAMPAIGNS, (chain) => {
      if (chain.has("update")) return ok([]);
      reads += 1;
      return ok(
        reads === 1 ? plan.couponRow : { newsletter_campaign_id: "kampania-drugiej-karty" },
      );
    });

    await expect(
      createCouponNewsletterCampaign({ data: { couponCampaignId: COUPON_CAMPAIGN_ID } }),
    ).resolves.toEqual({ newsletterCampaignId: "kampania-drugiej-karty" });
    const deleted = db.chainsFor(CAMPAIGNS).find((c) => c.has("delete"));
    expect(filterValue(deleted!, "eq", "id")).toBe("nowa-kampania");
    expect(filterValue(deleted!, "eq", "tenant_id")).toBe(TENANT);
  });

  it("tylko z kampanii kuponowej w stanie generated", async () => {
    plan.couponRow = { ...plan.couponRow, status: "draft" };

    await expect(
      createCouponNewsletterCampaign({ data: { couponCampaignId: COUPON_CAMPAIGN_ID } }),
    ).rejects.toThrow("coupon_campaign_not_generated");
    expect(db.chainsFor(CAMPAIGNS).some((c) => c.has("insert"))).toBe(false);
  });

  it("segment spoza list najemcy -> COUPON_SEGMENT_INVALID, bez szkicu", async () => {
    plan.couponRow = { ...plan.couponRow, newsletter_segment: "nie-ma-takiej" };

    await expect(
      createCouponNewsletterCampaign({ data: { couponCampaignId: COUPON_CAMPAIGN_ID } }),
    ).rejects.toThrow("COUPON_SEGMENT_INVALID");
    expect(db.chainsFor(CAMPAIGNS).some((c) => c.has("insert"))).toBe(false);
  });

  it("kampania kuponowa innego najemcy albo nieistniejąca -> campaign_not_found", async () => {
    plan.couponRow = null;

    await expect(
      createCouponNewsletterCampaign({ data: { couponCampaignId: COUPON_CAMPAIGN_ID } }),
    ).rejects.toThrow("campaign_not_found");
    const read = db.chainsFor(COUPON_CAMPAIGNS)[0];
    expect(filterValue(read!, "eq", "tenant_id")).toBe(TENANT);
  });
});

describe("edytor kampanii i wysyłka testowa", () => {
  it("getCampaign zwraca stan puli kodów kampanii kuponowej", async () => {
    plan.codes = [
      code("c1", "KOD-AAA1"),
      code("c2", "KOD-BBB2", { assigned_subscriber_id: "s9" }),
      { ...code("c3", "KOD-CCC3"), active: false },
    ];

    const row = await getCampaign({ data: { id: CAMPAIGN_ID } });

    expect(row?.coupon).toEqual({
      couponCampaignId: COUPON_CAMPAIGN_ID,
      name: "Jesień",
      codesAvailable: 1,
      codesTotal: 3,
      status: "generated",
    });
    expect(row).not.toHaveProperty("coupon_link");
  });

  it("getCampaign: zwykła kampania ma coupon = null", async () => {
    plan.claimed = campaign({ coupon_link: [] });

    expect((await getCampaign({ data: { id: CAMPAIGN_ID } }))?.coupon).toBeNull();
  });

  it("wysyłka testowa podstawia przykładowy kod - tag nigdy nie wychodzi surowy", async () => {
    await sendCampaignTest({ data: { id: CAMPAIGN_ID, toEmail: "redakcja@example.test" } });

    const html = (h.sendEmail.mock.calls[0]![0] as { html: string }).html;
    expect(html).toContain("Kod: PRZYKLAD-KOD");
    expect(html).not.toContain("{{coupon_code}}");
    // Test nie zużywa prawdziwych kodów.
    expect(db.chainsFor(COUPONS)).toHaveLength(0);
  });
});
