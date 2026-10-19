// Audiencja kampanii newslettera: lista mailingowa (`segment`) w liczeniu
// i w wysyłce, fail-open zwykłej kampanii vs fail-closed kuponowej (P04).
//
// Dawniej `segment` nie istniał w schemacie filtra - zod go odrzucał bez
// słowa, więc „kampania do listy Ekonomia" szła do wszystkich (R-25). Teraz
// ten sam predykat (`readPreferences(meta).mailingLists`) stoi za podglądem
// „do ilu osób pójdzie" i za faktyczną wysyłką - rozjazd między nimi byłby
// tym samym defektem w innym miejscu.
//
// Zwykła kampania z uszkodzonym filtrem degraduje się do filtra pustego
// (zachowanie sprzed S1, przypięte w `newsletterCampaignSend.test.ts`);
// kampania KUPONOWA w tej samej sytuacji nie wysyła NIC.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ok, supabaseFromStub, type RecordedChain } from "@/test/supabaseChain";
import { resetServerFnContext, setServerFnContext } from "@/test/serverFn";

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

import {
  countCampaignAudience,
  readAudienceFilter,
  sendCampaign,
  upsertCampaign,
} from "@/lib/newsletter-campaigns.functions";

const db = supabaseFromStub();
const CAMPAIGNS = "newsletter_campaigns";
const SUBSCRIBERS = "newsletter_subscribers";
const RECIPIENTS = "newsletter_campaign_recipients";
const COUPONS = "b2b_coupons";
const SETTINGS = "newsletter_settings";
const PROFILES = "profiles";

const TENANT = "tenant-1";
const CAMPAIGN_ID = "11111111-2222-3333-4444-555555555555";

let claimed: Record<string, unknown>;

function campaign(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: CAMPAIGN_ID,
    tenant_id: TENANT,
    status: "draft",
    editor: "html",
    subject_pl: "Temat",
    subject_en: "Subject",
    html_pl: "<p>Treść</p>",
    html_en: "<p>Body</p>",
    from_name: "NES",
    from_email: "biuro@example.test",
    reply_to: null,
    audience_filter: {},
    content_doc: null,
    ...overrides,
  };
}

function couponLink(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "99999999-8888-7777-6666-555555555555",
    tenant_id: TENANT,
    name: "Jesień",
    status: "generated",
    newsletter_segment: "ekonomia",
    ...overrides,
  };
}

// Trzy drogi zapisu listy w `meta`: nowa (napis „a,b"), z białymi znakami
// i stara jednoliczbowa (`mailing_list`) - `readPreferences` czyta wszystkie.
const AUDIENCE = [
  {
    id: "s1",
    email: "s1@example.test",
    first_name: null,
    last_name: null,
    language: "pl",
    unsubscribe_token: "u1",
    meta: { mailing_lists: "ekonomia" },
  },
  {
    id: "s2",
    email: "s2@example.test",
    first_name: null,
    last_name: null,
    language: "pl",
    unsubscribe_token: "u2",
    meta: { mailing_lists: "kultura, ekonomia" },
  },
  {
    id: "s3",
    email: "s3@example.test",
    first_name: null,
    last_name: null,
    language: "pl",
    unsubscribe_token: "u3",
    meta: { mailing_list: "ekonomia" },
  },
  {
    id: "s4",
    email: "s4@example.test",
    first_name: null,
    last_name: null,
    language: "pl",
    unsubscribe_token: "u4",
    meta: { mailing_lists: "kultura" },
  },
  {
    id: "s5",
    email: "s5@example.test",
    first_name: null,
    last_name: null,
    language: "pl",
    unsubscribe_token: "u5",
    meta: null,
  },
];

function mailedTo(): string[] {
  return h.sendEmail.mock.calls.map(([m]) => (m as { to: string }).to).sort();
}

const ENV_KEYS = ["PUBLIC_SITE_URL", "SITE_URL", "URL"] as const;
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  vi.clearAllMocks();
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const key of ENV_KEYS) delete process.env[key];
  process.env.PUBLIC_SITE_URL = "https://example.test";
  claimed = campaign();

  db.reset();
  db.setResponse(PROFILES, ok({ tenant_id: TENANT }));
  db.setResponse(SUBSCRIBERS, () => ok(AUDIENCE));
  db.setResponse(RECIPIENTS, (chain: RecordedChain) => (chain.has("upsert") ? ok(null) : ok([])));
  db.setResponse(SETTINGS, () =>
    ok({
      popup_mailing_lists: [
        { id: "ekonomia", label_pl: "Ekonomia", label_en: "Economy" },
        { id: "kultura", label_pl: "Kultura", label_en: "Culture" },
      ],
    }),
  );
  db.setResponse(COUPONS, () => ({ data: [], error: null, count: 0 }));
  db.setResponse(CAMPAIGNS, (chain: RecordedChain) => {
    if (chain.has("update") && chain.has("select")) return ok(claimed);
    if (chain.has("update")) return ok(null);
    if (chain.has("insert")) return ok({ id: "nowa" });
    return ok({ status: "draft" });
  });

  setServerFnContext({ supabase: { from: db.from, rpc: h.rpc }, userId: "user-1" });
  h.rpc.mockResolvedValue({ data: [], error: null });
  h.sendEmail.mockResolvedValue({ ok: true, messageId: "m" });
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

describe("schemat filtra: segment", () => {
  it("segment jest częścią filtra (nie znika przy parsowaniu) i jest przycinany", () => {
    expect(readAudienceFilter({ segment: "  ekonomia " })).toEqual({ segment: "ekonomia" });
  });

  it("pusty albo za długi segment unieważnia filtr (odczyt degraduje do pustego)", () => {
    expect(readAudienceFilter({ segment: "   " })).toEqual({});
    expect(readAudienceFilter({ segment: "x".repeat(121) })).toEqual({});
  });

  it("zapis kampanii zachowuje segment w audience_filter", async () => {
    await upsertCampaign({
      data: {
        name: "Do listy",
        subject_pl: "T",
        subject_en: "S",
        html_pl: "<p>a</p>",
        html_en: "<p>b</p>",
        editor: "html",
        audience_filter: { segment: "ekonomia" },
      },
    });
    const inserted = db.lastChain(CAMPAIGNS)?.argsOf("insert")?.[0] as Record<string, unknown>;
    expect(inserted.audience_filter).toEqual({ segment: "ekonomia" });
  });

  it("licznik odrzuca segment dłuższy niż 120 znaków", async () => {
    await expect(countCampaignAudience({ data: { segment: "x".repeat(121) } })).rejects.toThrow();
    expect(db.chainsFor(SUBSCRIBERS)).toHaveLength(0);
  });
});

describe("liczenie audiencji z segmentem", () => {
  it("liczy subskrybentów listy - nowy zapis, białe znaki i stary klucz jednoliczbowy", async () => {
    await expect(countCampaignAudience({ data: { segment: "ekonomia" } })).resolves.toEqual({
      count: 3,
    });
    const chain = db.lastChain(SUBSCRIBERS);
    expect(chain?.argsOf("select")).toEqual(["email, meta"]);
    expect(chain?.argsOf("eq")).toEqual(["tenant_id", TENANT]);
    expect(chain?.argsOf("in")).toEqual(["status", ["subscribed"]]);
  });

  it("segment + ranga warstwy = część wspólna obu warunków", async () => {
    h.rpc.mockResolvedValue({
      data: [{ email: "S2@example.test" }, { email: "s4@example.test" }],
      error: null,
    });

    await expect(
      countCampaignAudience({ data: { segment: "ekonomia", min_tier_rank: 10 } }),
    ).resolves.toEqual({ count: 1 });
  });

  it("bez segmentu licznik zostaje zapytaniem liczącym (bez pobierania wierszy)", async () => {
    db.setResponse(SUBSCRIBERS, () => ({ data: null, error: null, count: 5 }));

    await expect(countCampaignAudience({ data: {} })).resolves.toEqual({ count: 5 });
    expect(db.lastChain(SUBSCRIBERS)?.argsOf("select")).toEqual([
      "id",
      { count: "exact", head: true },
    ]);
  });
});

describe("wysyłka zwykłej kampanii z segmentem (fail-open filtra)", () => {
  it("wysyła WYŁĄCZNIE do subskrybentów listy - ten sam predykat co licznik", async () => {
    claimed = campaign({ audience_filter: { segment: "ekonomia" } });

    await sendCampaign({ data: { id: CAMPAIGN_ID } });

    expect(mailedTo()).toEqual(["s1@example.test", "s2@example.test", "s3@example.test"]);
    expect(String(db.lastChain(SUBSCRIBERS)?.argsOf("select")?.[0])).toContain("meta");
  });

  it("zwykła kampania z nieznaną listą nie wywraca się - nikt jej nie wybrał, więc 0 maili", async () => {
    claimed = campaign({ audience_filter: { segment: "archiwum" } });

    await expect(sendCampaign({ data: { id: CAMPAIGN_ID } })).resolves.toMatchObject({ sent: 0 });
    expect(h.sendEmail).not.toHaveBeenCalled();
  });

  it("zwykła kampania z uszkodzonym filtrem: fail-open do pustego filtra (bez zmian)", async () => {
    claimed = campaign({ audience_filter: { segment: 42 } });

    await sendCampaign({ data: { id: CAMPAIGN_ID } });

    expect(h.sendEmail).toHaveBeenCalledTimes(AUDIENCE.length);
  });

  it("zwykła kampania z tagiem {{coupon_code}} jest zatrzymana - tag nie wychodzi surowy", async () => {
    claimed = campaign({ html_pl: "<p>Kod: {{coupon_code}}</p>" });

    await expect(sendCampaign({ data: { id: CAMPAIGN_ID } })).rejects.toThrow(
      "COUPON_CAMPAIGN_NOT_LINKED",
    );
    expect(h.sendEmail).not.toHaveBeenCalled();
  });
});

describe("wysyłka kampanii kuponowej (fail-closed filtra)", () => {
  const COUPON_HTML = { html_pl: "<p>{{coupon_code}}</p>", html_en: "<p>{{coupon_code}}</p>" };

  it.each([
    ["uszkodzony filtr", { segment: 42 }, [couponLink()]],
    [
      "lista spoza list najemcy",
      { segment: "archiwum" },
      [couponLink({ newsletter_segment: "archiwum" })],
    ],
    ["segment inny niż na kampanii kuponowej", { segment: "kultura" }, [couponLink()]],
    ["brak segmentu, choć kampania kuponowa go ma", {}, [couponLink()]],
    [
      "powiązanie z kampanią kuponową innego najemcy",
      { segment: "ekonomia" },
      [couponLink({ tenant_id: "tenant-2" })],
    ],
  ])("%s -> COUPON_SEGMENT_INVALID i zero maili", async (_name, filter, link) => {
    claimed = campaign({ ...COUPON_HTML, audience_filter: filter, coupon_link: link });

    await expect(sendCampaign({ data: { id: CAMPAIGN_ID } })).rejects.toThrow(
      "COUPON_SEGMENT_INVALID",
    );
    expect(h.sendEmail).not.toHaveBeenCalled();
    expect(db.chainsFor(SUBSCRIBERS)).toHaveLength(0);
  });

  it("dwie kampanie kuponowe pod jedną kampanią newslettera -> COUPON_CAMPAIGN_AMBIGUOUS", async () => {
    claimed = campaign({
      ...COUPON_HTML,
      audience_filter: { segment: "ekonomia" },
      coupon_link: [couponLink(), couponLink({ id: "inna-kampania-kuponowa" })],
    });

    await expect(sendCampaign({ data: { id: CAMPAIGN_ID } })).rejects.toThrow(
      "COUPON_CAMPAIGN_AMBIGUOUS",
    );
    expect(h.sendEmail).not.toHaveBeenCalled();
  });

  it("kampania kuponowa bez segmentu na obu końcach idzie do całej listy (świadoma konfiguracja)", async () => {
    claimed = campaign({
      ...COUPON_HTML,
      audience_filter: {},
      coupon_link: [couponLink({ newsletter_segment: null })],
    });

    // Pula pusta -> błąd kodów, ale PO poprawnej walidacji segmentu.
    await expect(sendCampaign({ data: { id: CAMPAIGN_ID } })).rejects.toThrow(
      `COUPON_CODES_INSUFFICIENT:${AUDIENCE.length}:0`,
    );
  });

  it("poprawny segment kuponowy przechodzi walidację i filtruje odbiorców", async () => {
    claimed = campaign({
      ...COUPON_HTML,
      audience_filter: { segment: "ekonomia" },
      coupon_link: [couponLink()],
    });

    // 3 odbiorców listy, 0 kodów: komunikat niesie liczność SEGMENTU, nie listy.
    await expect(sendCampaign({ data: { id: CAMPAIGN_ID } })).rejects.toThrow(
      "COUPON_CODES_INSUFFICIENT:3:0",
    );
  });
});
