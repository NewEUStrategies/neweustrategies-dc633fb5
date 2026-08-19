// Wysyłka kampanii - pieniądze i reputacja domeny w jednej pętli.
//
// Audyt zastał tę powierzchnię na 17,9% linii przy 7,7% GAŁĘZI, czyli
// praktycznie bez pokrycia tam, gdzie mieszkają decyzje. A decyzje są tu
// nieodwracalne: wiadomość raz wysłana nie da się cofnąć, a każda wysłana
// dwa razy to skarga na spam, po której Google obniża reputację CAŁEJ domeny.
//
// Cztery reguły, których złamania nie widać w kodzie, tylko w skrzynkach:
//   1. WZNOWIENIE nie wysyła nikomu drugi raz. Porównanie „już wysłano" idzie
//      po adresie ZNORMALIZOWANYM - adres wchodzi na listę trzema drogami
//      (formularz, import CSV, profil) i tylko część z nich normalizuje
//      wielkość liter. Ta strona porównania jest dokładnie tą, po której idzie
//      sygnał skargi.
//   2. Adresy z aktywną blokadą wypadają ZANIM powstanie choćby jeden request
//      do dostawcy - i zostają w logu jako `suppressed`, żeby panel pokazał,
//      ile wysyłek zaoszczędziła lista.
//   3. Błąd dostawcy w POŁOWIE partii nie może policzyć wysłanych dwa razy
//      ani zatrzymać reszty paczki.
//   4. Mail bez mechanizmu wypisu NIE WYCHODZI (brak origin zatrzymuje
//      kampanię) - to wymóg prawny i warunek pozostania poza czarną listą.
//
// Reguły audiencji (`campaignAudience`) i tokenów trackingu mają własne testy -
// tu sprawdzamy ich UŻYCIE w pętli wysyłki.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ok, fail, supabaseFromStub, type RecordedChain } from "@/test/supabaseChain";
import { setServerFnContext, resetServerFnContext, serverFnMeta } from "@/test/serverFn";

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

import { sendCampaign } from "@/lib/newsletter-campaigns.functions";

const db = supabaseFromStub();
const CAMPAIGNS = "newsletter_campaigns";
const SUBSCRIBERS = "newsletter_subscribers";
const RECIPIENTS = "newsletter_campaign_recipients";
const PROFILES = "profiles";

const TENANT = "tenant-1";
const CAMPAIGN_ID = "11111111-2222-3333-4444-555555555555";

/** Kampania w kształcie wiersza tabeli. */
function campaign(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: CAMPAIGN_ID,
    tenant_id: TENANT,
    status: "draft",
    editor: "html",
    subject_pl: "Temat PL",
    subject_en: "Subject EN",
    html_pl: "<p>Treść PL</p>",
    html_en: "<p>Body EN</p>",
    from_name: "NES",
    from_email: "biuro@example.test",
    reply_to: null,
    audience_filter: {},
    content_doc: null,
    ...overrides,
  };
}

/** Subskrybent w audiencji. */
function subscriber(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "sub-1",
    email: "odbiorca@example.test",
    first_name: "Anna",
    last_name: "Nowak",
    language: "pl",
    unsubscribe_token: "unsub-1",
    ...overrides,
  };
}

interface Plan {
  audience: Record<string, unknown>[];
  logged: Record<string, unknown>[];
  claimed: Record<string, unknown> | null;
  currentStatus: string;
}

let plan: Plan;

/** Zapisy stanu kampanii (kolejno) - postęp, dzierżawa, status końcowy. */
function campaignUpdates(): Record<string, unknown>[] {
  return db
    .chainsFor(CAMPAIGNS)
    .map((c) => c.argsOf("update")?.[0])
    .filter(Boolean) as Record<string, unknown>[];
}

/** Wpisy do logu odbiorców. */
function recipientLogs(): Record<string, unknown>[] {
  return db
    .chainsFor(RECIPIENTS)
    .map((c) => c.argsOf("upsert")?.[0])
    .filter(Boolean) as Record<string, unknown>[];
}

function logsWithStatus(status: string): Record<string, unknown>[] {
  return recipientLogs().filter((r) => r.status === status);
}

const ENV_KEYS = ["PUBLIC_SITE_URL", "SITE_URL", "URL"] as const;
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  vi.clearAllMocks();
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const key of ENV_KEYS) delete process.env[key];
  process.env.PUBLIC_SITE_URL = "https://example.test";

  plan = {
    audience: [subscriber()],
    logged: [],
    claimed: campaign(),
    currentStatus: "draft",
  };

  db.reset();
  db.setResponse(PROFILES, ok({ tenant_id: TENANT }));
  db.setResponse(SUBSCRIBERS, () => ok(plan.audience));
  db.setResponse(RECIPIENTS, (chain: RecordedChain) =>
    chain.has("upsert") ? ok(null) : ok(plan.logged),
  );
  db.setResponse(CAMPAIGNS, (chain: RecordedChain) => {
    // Przejęcie kampanii: UPDATE ... .select().maybeSingle()
    if (chain.has("update") && chain.has("select")) return ok(plan.claimed);
    if (chain.has("update")) return ok(null);
    return ok({ status: plan.currentStatus });
  });

  setServerFnContext({ supabase: { from: db.from, rpc: h.rpc }, userId: "user-1" });

  h.rpc.mockResolvedValue({ data: null, error: null });
  h.sendEmail.mockResolvedValue({ ok: true, messageId: "prov-1", provider: "resend" });
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

describe("obudowa i bramki przed wysyłką", () => {
  it("wysyłka jest za rolą redakcyjną i metodą POST", () => {
    expect(serverFnMeta(sendCampaign)?.middleware).toEqual([{ __mw: "requireStaff" }]);
    expect(serverFnMeta(sendCampaign)?.method).toBe("POST");
  });

  it("przekroczony próg skarg ZATRZYMUJE wysyłkę", async () => {
    h.evaluateSendGate.mockResolvedValue({
      allowed: false,
      errorCode: "reputation_blocked:complaint_rate",
    });

    await expect(sendCampaign({ data: { id: CAMPAIGN_ID } })).rejects.toThrow(
      "reputation_blocked:complaint_rate",
    );
    expect(h.sendEmail).not.toHaveBeenCalled();
  });

  it("świadome potwierdzenie operatora idzie do bramki", async () => {
    await sendCampaign({ data: { id: CAMPAIGN_ID, acknowledgeReputation: true } });

    expect(h.evaluateSendGate).toHaveBeenCalledWith(expect.anything(), TENANT, true);
    // Bramka jest pytana RAZ na wysyłkę, nie raz na odbiorcę.
    expect(h.evaluateSendGate).toHaveBeenCalledTimes(1);
  });

  it("WZNOWIENIE kampanii już w locie omija bramkę reputacji", async () => {
    // Przerwanie w połowie zostawia część listy z wiadomością, a część bez -
    // gorzej niż dokończenie. Poszczególne adresy chroni lista wykluczeń.
    plan.currentStatus = "sending";
    plan.claimed = campaign({ status: "sending" });

    await sendCampaign({ data: { id: CAMPAIGN_ID } });

    expect(h.evaluateSendGate).not.toHaveBeenCalled();
    expect(h.sendEmail).toHaveBeenCalledTimes(1);
  });

  it("kampania, której nie da się przejąć, kończy się jasnym błędem", async () => {
    plan.claimed = null;

    await expect(sendCampaign({ data: { id: CAMPAIGN_ID } })).rejects.toThrow(
      "campaign_not_sendable",
    );
    expect(h.sendEmail).not.toHaveBeenCalled();
  });

  it("brak tenanta u wywołującego zatrzymuje wszystko", async () => {
    db.setResponse(PROFILES, ok(null));

    await expect(sendCampaign({ data: { id: CAMPAIGN_ID } })).rejects.toThrow("no_tenant");
    expect(h.evaluateSendGate).not.toHaveBeenCalled();
  });

  it("odrzuca identyfikator, który nie jest UUID", async () => {
    await expect(sendCampaign({ data: { id: "camp-1" } })).rejects.toThrow();
    expect(h.sendEmail).not.toHaveBeenCalled();
  });
});

describe("wybór odbiorców", () => {
  it("domyślnie wysyła do statusu `subscribed`", async () => {
    await sendCampaign({ data: { id: CAMPAIGN_ID } });

    expect(db.lastChain(SUBSCRIBERS)?.argsOf("in")).toEqual(["status", ["subscribed"]]);
    // Filtr statusu JEST nakładany - bez niego kampania poszłaby też do
    // wypisanych i niepotwierdzonych.
    expect(db.lastChain(SUBSCRIBERS)?.has("in")).toBe(true);
  });

  it("filtr statusów z kampanii nadpisuje domyślny", async () => {
    plan.claimed = campaign({ audience_filter: { statuses: ["subscribed", "pending"] } });

    await sendCampaign({ data: { id: CAMPAIGN_ID } });

    expect(db.lastChain(SUBSCRIBERS)?.argsOf("in")).toEqual(["status", ["subscribed", "pending"]]);
    // Filtr z kampanii ZASTĘPUJE domyślny, nie sumuje się z nim.
    expect(db.lastChain(SUBSCRIBERS)?.calls.filter((c) => c.method === "in")).toHaveLength(1);
  });

  it("filtr języka i źródła zawęża audiencję", async () => {
    plan.claimed = campaign({ audience_filter: { languages: ["pl"], source: "popup" } });

    await sendCampaign({ data: { id: CAMPAIGN_ID } });

    const chain = db.lastChain(SUBSCRIBERS);
    expect(chain?.calls.filter((c) => c.method === "in")).toHaveLength(2);
    expect(chain?.argsOf("eq")).toEqual(["tenant_id", TENANT]);
  });

  it("uszkodzony filtr w bazie daje filtr PUSTY, a nie wyjątek w połowie wysyłki", async () => {
    plan.claimed = campaign({ audience_filter: "to nie jest obiekt" });

    const res = await sendCampaign({ data: { id: CAMPAIGN_ID } });

    expect(res.sent).toBe(1);
    expect(db.lastChain(SUBSCRIBERS)?.argsOf("in")).toEqual(["status", ["subscribed"]]);
  });

  it("audiencja jest przypięta do tenanta", async () => {
    await sendCampaign({ data: { id: CAMPAIGN_ID } });

    expect(db.lastChain(SUBSCRIBERS)?.argsOf("eq")).toEqual(["tenant_id", TENANT]);
    // Bez tego warunku kampania jednego najemcy poszłaby do listy innego.
    expect(db.lastChain(SUBSCRIBERS)?.has("eq")).toBe(true);
  });

  it("błąd odczytu audiencji oznacza kampanię jako nieudaną", async () => {
    db.setResponse(SUBSCRIBERS, fail("audience read failed"));

    await expect(sendCampaign({ data: { id: CAMPAIGN_ID } })).rejects.toThrow(
      "audience read failed",
    );
    expect(campaignUpdates().at(-1)).toMatchObject({ status: "failed" });
  });
});

describe("kampania bez odbiorców", () => {
  it("kończy się jako wysłana, bez ani jednego maila", async () => {
    plan.audience = [];

    const res = await sendCampaign({ data: { id: CAMPAIGN_ID } });

    expect(res).toMatchObject({ sent: 0, failed: 0, done: true, remaining: 0 });
    expect(h.sendEmail).not.toHaveBeenCalled();
  });

  it("zapisuje status końcowy `sent` i zeruje licznik odbiorców", async () => {
    plan.audience = [];

    await sendCampaign({ data: { id: CAMPAIGN_ID } });

    expect(campaignUpdates()[1]).toMatchObject({ recipient_count: 0, sent_count: 0 });
    expect(campaignUpdates().at(-1)).toMatchObject({ status: "sent", lease_until: null });
  });
});

describe("wznowienie bez podwójnej wysyłki", () => {
  it("odbiorca ze statusem `sent` NIE dostaje wiadomości drugi raz", async () => {
    plan.audience = [
      subscriber({ id: "a", email: "pierwszy@example.test" }),
      subscriber({ id: "b", email: "drugi@example.test" }),
    ];
    plan.logged = [{ email: "pierwszy@example.test", status: "sent" }];

    const res = await sendCampaign({ data: { id: CAMPAIGN_ID } });

    expect(h.sendEmail).toHaveBeenCalledTimes(1);
    expect(h.sendEmail.mock.calls[0]?.[0]).toMatchObject({ to: "drugi@example.test" });
    // Licznik startuje od już wysłanych - statystyki po wznowieniu są spójne.
    expect(res.sent).toBe(2);
  });

  it("porównanie „już wysłano” IGNORUJE wielkość liter", async () => {
    // Adres wchodzi na listę trzema drogami i tylko część normalizuje wielkość
    // liter. Gdyby porównanie szło po surowym adresie, wznowiona kampania
    // wysłałaby tej osobie drugą wiadomość.
    plan.audience = [subscriber({ email: "Odbiorca@Example.TEST" })];
    plan.logged = [{ email: "odbiorca@example.test", status: "sent" }];

    const res = await sendCampaign({ data: { id: CAMPAIGN_ID } });

    expect(h.sendEmail).not.toHaveBeenCalled();
    expect(res.sent).toBe(1);
  });

  it("odbiorcy `failed` i `skipped` są PONAWIANI", async () => {
    plan.audience = [
      subscriber({ id: "a", email: "nieudany@example.test" }),
      subscriber({ id: "b", email: "pominiety@example.test" }),
    ];
    plan.logged = [
      { email: "nieudany@example.test", status: "failed" },
      { email: "pominiety@example.test", status: "skipped" },
    ];

    await sendCampaign({ data: { id: CAMPAIGN_ID } });

    expect(h.sendEmail).toHaveBeenCalledTimes(2);
    expect(logsWithStatus("sent")).toHaveLength(2);
  });

  it("mianownik postępu nie liczy tej samej osoby dwa razy", async () => {
    plan.audience = [subscriber({ email: "Odbiorca@Example.TEST" })];
    plan.logged = [{ email: "odbiorca@example.test", status: "sent" }];

    await sendCampaign({ data: { id: CAMPAIGN_ID } });

    expect(campaignUpdates()[1]).toMatchObject({ recipient_count: 1 });
    // Ten sam adres w innej wielkości liter to TA SAMA osoba - dwa wysłałyby
    // maila dwa razy i zawyżyły mianownik postępu.
    expect(h.sendEmail).toHaveBeenCalledTimes(0);
  });

  it("błąd odczytu logu odbiorców zatrzymuje wysyłkę", async () => {
    db.setResponse(RECIPIENTS, (chain: RecordedChain) =>
      chain.has("upsert") ? ok(null) : fail("recipients read failed"),
    );

    await expect(sendCampaign({ data: { id: CAMPAIGN_ID } })).rejects.toThrow(
      "recipients read failed",
    );
    expect(h.sendEmail).not.toHaveBeenCalled();
  });
});

describe("higiena listy - blokady", () => {
  it("adres z blokadą NIE trafia do dostawcy", async () => {
    plan.audience = [
      subscriber({ id: "a", email: "zablokowany@example.test" }),
      subscriber({ id: "b", email: "czysty@example.test" }),
    ];
    h.fetchSuppressedEmails.mockResolvedValue(
      new Map([["zablokowany@example.test", { reason: "hard_bounce" }]]),
    );

    await sendCampaign({ data: { id: CAMPAIGN_ID } });

    expect(h.sendEmail).toHaveBeenCalledTimes(1);
    expect(h.sendEmail.mock.calls[0]?.[0]).toMatchObject({ to: "czysty@example.test" });
  });

  it("pominięcie zostaje w logu z POWODEM - panel pokazuje oszczędność", async () => {
    plan.audience = [subscriber({ email: "zablokowany@example.test" })];
    h.fetchSuppressedEmails.mockResolvedValue(
      new Map([["zablokowany@example.test", { reason: "complaint" }]]),
    );

    await sendCampaign({ data: { id: CAMPAIGN_ID } });

    expect(logsWithStatus("suppressed")[0]).toMatchObject({
      status: "suppressed",
      error: "suppressed:complaint",
    });
    // Pominięty adres NIE dostaje maila - to jest sens listy wykluczeń.
    expect(h.sendEmail).not.toHaveBeenCalled();
  });

  it("pominięcie logujemy RAZ, nie przy każdej porcji", async () => {
    plan.audience = [subscriber({ email: "zablokowany@example.test" })];
    plan.logged = [{ email: "zablokowany@example.test", status: "suppressed" }];
    h.fetchSuppressedEmails.mockResolvedValue(
      new Map([["zablokowany@example.test", { reason: "complaint" }]]),
    );

    await sendCampaign({ data: { id: CAMPAIGN_ID } });

    expect(logsWithStatus("suppressed")).toHaveLength(0);
    expect(h.sendEmail).not.toHaveBeenCalled();
  });

  it("blokady sprawdzamy PRZED pierwszym żądaniem do dostawcy", async () => {
    plan.audience = [subscriber()];

    await sendCampaign({ data: { id: CAMPAIGN_ID } });

    const suppressionOrder = h.fetchSuppressedEmails.mock.invocationCallOrder[0] ?? 0;
    const firstSendOrder = h.sendEmail.mock.invocationCallOrder[0] ?? 0;
    expect(suppressionOrder).toBeGreaterThan(0);
    expect(suppressionOrder).toBeLessThan(firstSendOrder);
  });
});

describe("wysyłka partiami i wznowienie", () => {
  function manySubscribers(count: number): Record<string, unknown>[] {
    return Array.from({ length: count }, (_, i) =>
      subscriber({ id: `sub-${i}`, email: `odbiorca${i}@example.test` }),
    );
  }

  it("audiencja mieszcząca się w porcji kończy kampanię", async () => {
    plan.audience = manySubscribers(5);

    const res = await sendCampaign({ data: { id: CAMPAIGN_ID } });

    expect(res).toMatchObject({ done: true, remaining: 0, processed: 5 });
    expect(campaignUpdates().at(-1)).toMatchObject({ status: "sent" });
  });

  it("każdy odbiorca dostaje DOKŁADNIE jedną wiadomość", async () => {
    plan.audience = manySubscribers(8);

    await sendCampaign({ data: { id: CAMPAIGN_ID } });

    const addresses = h.sendEmail.mock.calls.map((c) => (c[0] as { to: string }).to);
    expect(addresses).toHaveLength(8);
    expect(new Set(addresses).size).toBe(8);
  });

  it("postęp i dzierżawa są odnawiane po paczce", async () => {
    plan.audience = manySubscribers(3);

    await sendCampaign({ data: { id: CAMPAIGN_ID } });

    const withLease = campaignUpdates().filter((u) => typeof u.lease_until === "string");
    expect(withLease.length).toBeGreaterThanOrEqual(1);
    expect(withLease.at(-1)).toMatchObject({ sent_count: 3, failed_count: 0 });
  });

  it("KAŻDY zapis stanu kampanii jest przypięty parą (id, tenant)", async () => {
    await sendCampaign({ data: { id: CAMPAIGN_ID } });

    const updateChains = db.chainsFor(CAMPAIGNS).filter((c) => c.has("update"));
    for (const chain of updateChains) {
      const eqs = chain.calls.filter((c) => c.method === "eq").map((c) => c.args[0]);
      expect(eqs).toContain("id");
      expect(eqs).toContain("tenant_id");
    }
  });
});

describe("błąd dostawcy w połowie partii", () => {
  it("nie zatrzymuje reszty paczki i nie liczy wysłanych dwa razy", async () => {
    plan.audience = [
      subscriber({ id: "a", email: "ok1@example.test" }),
      subscriber({ id: "b", email: "zly@example.test" }),
      subscriber({ id: "c", email: "ok2@example.test" }),
    ];
    h.sendEmail.mockImplementation((input: { to: string }) =>
      input.to === "zly@example.test"
        ? Promise.resolve({ ok: false, error: "mailbox full", status: 550 })
        : Promise.resolve({ ok: true, messageId: "prov-x" }),
    );

    const res = await sendCampaign({ data: { id: CAMPAIGN_ID } });

    expect(res.sent).toBe(2);
    expect(res.failed).toBe(1);
    expect(h.sendEmail).toHaveBeenCalledTimes(3);
  });

  it("nieudany odbiorca ląduje w logu z powodem od dostawcy", async () => {
    h.sendEmail.mockResolvedValue({ ok: false, error: "mailbox full", status: 550 });

    await sendCampaign({ data: { id: CAMPAIGN_ID } });

    expect(logsWithStatus("failed")[0]).toMatchObject({
      status: "failed",
      error: "mailbox full",
      delivery_state: "failed",
    });
    // Nieudany odbiorca nie ląduje jednocześnie w logu jako wysłany.
    expect(logsWithStatus("sent")).toHaveLength(0);
  });

  it("bez treści błędu zapisujemy kod odpowiedzi", async () => {
    h.sendEmail.mockResolvedValue({ ok: false, status: 502 });

    await sendCampaign({ data: { id: CAMPAIGN_ID } });

    expect(logsWithStatus("failed")[0]).toMatchObject({ error: "http_502" });
    // Puste pole powodu zostawiłoby operatora bez śladu, dlaczego nie doszło.
    expect(logsWithStatus("failed")[0]!.error).toBeTruthy();
  });

  it("SAME porażki dają kampanii status `failed`", async () => {
    h.sendEmail.mockResolvedValue({ ok: false, error: "boom" });

    const res = await sendCampaign({ data: { id: CAMPAIGN_ID } });

    expect(res).toMatchObject({ sent: 0, failed: 1 });
    expect(campaignUpdates().at(-1)).toMatchObject({ status: "failed" });
  });

  it("choćby JEDNA udana wysyłka daje status `sent`", async () => {
    plan.audience = [
      subscriber({ id: "a", email: "ok@example.test" }),
      subscriber({ id: "b", email: "zly@example.test" }),
    ];
    h.sendEmail.mockImplementation((input: { to: string }) =>
      input.to === "zly@example.test"
        ? Promise.resolve({ ok: false, error: "boom" })
        : Promise.resolve({ ok: true, messageId: "m" }),
    );

    await sendCampaign({ data: { id: CAMPAIGN_ID } });

    expect(campaignUpdates().at(-1)).toMatchObject({ status: "sent", failed_count: 1 });
    // Nie „failed" - jedna odmowa dostawcy nie unieważnia całej wysyłki.
    expect(campaignUpdates().at(-1)!.status).not.toBe("failed");
  });

  it("identyfikator wiadomości od dostawcy trafia do logu (korelacja odbić)", async () => {
    await sendCampaign({ data: { id: CAMPAIGN_ID } });

    expect(logsWithStatus("sent")[0]).toMatchObject({
      provider_message_id: "prov-1",
      delivery_state: "sent",
    });
    // Bez identyfikatora odbicie z webhooka nie da się przypisać do wysyłki.
    expect(logsWithStatus("sent")[0]!.provider_message_id).toBeTruthy();
  });
});

describe("treść wiadomości", () => {
  it("każdy mail niesie tagi korelacyjne tenanta, kampanii i odbiorcy", async () => {
    await sendCampaign({ data: { id: CAMPAIGN_ID } });

    expect(h.sendEmail.mock.calls[0]?.[0]).toMatchObject({
      tags: { tenant: TENANT, campaign: CAMPAIGN_ID, subscriber: "sub-1" },
    });
    // Wszystkie trzy tagi - brak któregokolwiek urywa ścieżkę korelacji odbicia.
    expect(Object.keys(h.sendEmail.mock.calls[0]![0].tags).sort()).toEqual([
      "campaign",
      "subscriber",
      "tenant",
    ]);
  });

  it("mail niesie adres wypisu w nagłówku RFC 8058", async () => {
    await sendCampaign({ data: { id: CAMPAIGN_ID } });

    const input = h.sendEmail.mock.calls[0]?.[0] as { listUnsubscribeUrl: string };
    expect(input.listUnsubscribeUrl).toContain("/newsletter/unsubscribe?token=unsub-1");
    // Adres absolutny - względny w nagłówku RFC 8058 jest nieużywalny.
    expect(input.listUnsubscribeUrl.startsWith("http")).toBe(true);
  });

  it("nadawca składa się z nazwy i adresu kampanii", async () => {
    await sendCampaign({ data: { id: CAMPAIGN_ID } });

    expect(h.sendEmail.mock.calls[0]?.[0]).toMatchObject({ from: "NES <biuro@example.test>" });
    // Nazwa I adres razem - sam adres w skrzynce odbiorcy wygląda na spam.
    expect(h.sendEmail.mock.calls[0]?.[0].from).toContain("<");
  });

  it("bez adresu nadawcy zostawiamy wybór dostawcy", async () => {
    plan.claimed = campaign({ from_email: null });

    await sendCampaign({ data: { id: CAMPAIGN_ID } });

    expect(h.sendEmail.mock.calls[0]?.[0]).toMatchObject({ from: undefined });
    // `undefined`, a nie sklejka z samą nazwą - „NES <>" byłoby odrzucone.
    expect(h.sendEmail.mock.calls[0]?.[0].from).toBeUndefined();
  });

  it("odbiorca anglojęzyczny dostaje wersję angielską", async () => {
    plan.audience = [subscriber({ language: "en" })];

    await sendCampaign({ data: { id: CAMPAIGN_ID } });

    expect(h.sendEmail.mock.calls[0]?.[0]).toMatchObject({ subject: "Subject EN" });
    // Bez prefiksu [TEST] - to prawdziwa wysyłka, nie próba.
    expect(h.sendEmail.mock.calls[0]?.[0].subject).not.toContain("[TEST]");
  });

  it("brak treści w JĘZYKU odbiorcy pomija go z jasnym powodem", async () => {
    plan.claimed = campaign({ html_en: null, subject_en: null });
    plan.audience = [subscriber({ language: "en" })];

    const res = await sendCampaign({ data: { id: CAMPAIGN_ID } });

    expect(h.sendEmail).not.toHaveBeenCalled();
    expect(logsWithStatus("skipped")[0]).toMatchObject({
      error: "missing_content_for_language",
    });
    expect(res.sent).toBe(0);
  });

  it("BRAK adresu witryny zatrzymuje kampanię - mail bez wypisu nie wychodzi", async () => {
    for (const key of ENV_KEYS) delete process.env[key];

    await expect(sendCampaign({ data: { id: CAMPAIGN_ID } })).rejects.toThrow(
      "missing_site_origin",
    );
    expect(h.sendEmail).not.toHaveBeenCalled();
    expect(campaignUpdates().at(-1)).toMatchObject({ status: "failed" });
  });
});

describe("kreator treści (editor=doc)", () => {
  it("uszkodzony dokument zatrzymuje kampanię przed wysyłką", async () => {
    plan.claimed = campaign({ editor: "doc", content_doc: "to nie dokument" });

    await expect(sendCampaign({ data: { id: CAMPAIGN_ID } })).rejects.toThrow(
      "invalid_content_doc",
    );
    expect(h.sendEmail).not.toHaveBeenCalled();
  });

  it("nieudana kampania zapisuje POWÓD, nie tylko status", async () => {
    plan.claimed = campaign({ editor: "doc", content_doc: "to nie dokument" });

    await expect(sendCampaign({ data: { id: CAMPAIGN_ID } })).rejects.toThrow();

    expect(campaignUpdates().at(-1)).toMatchObject({
      status: "failed",
      last_error: "invalid_content_doc",
    });
  });
});
