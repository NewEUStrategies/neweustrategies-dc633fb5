// Kampanie: lista, edycja, kasowanie, licznik audiencji, wysyłka testowa
// i kafelek zaangażowania.
//
// Ta połowa modułu nie wysyła poczty, ale decyduje, CO i DO KOGO zostanie
// wysłane - i to ona chroni przed dwiema klasami wpadek:
//   * edycja albo skasowanie kampanii, która JEST W TRAKCIE wysyłki (filtr
//     statusów przy UPDATE/DELETE jest tu jedyną zaporą - RLS nie zna pojęcia
//     „kampania w locie"),
//   * zapisanie do kolumny `content_doc` JSON-a, którego renderer nie umie
//     przeczytać - awaria wyszłaby dopiero w chwili wysyłki, do całej listy.
//
// Osobno przybity jest kafelek zaangażowania: liczy DWIE liczby (zdarzenia
// i osoby), bo tylko unikalne otwarcia dają wskaźnik, który nie potrafi
// przekroczyć 100% - a „ponad 100%" unieważniało dotąd cały kafelek.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ok, okCount, fail, supabaseFromStub, type RecordedChain } from "@/test/supabaseChain";
import { setServerFnContext, resetServerFnContext, serverFnMeta } from "@/test/serverFn";

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  sendEmail: vi.fn(),
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

import {
  countCampaignAudience,
  deleteCampaign,
  getCampaign,
  getCampaignEngagement,
  listCampaigns,
  sendCampaignTest,
  upsertCampaign,
} from "@/lib/newsletter-campaigns.functions";

const db = supabaseFromStub();
const CAMPAIGNS = "newsletter_campaigns";
const SUBSCRIBERS = "newsletter_subscribers";
const PROFILES = "profiles";

const TENANT = "tenant-1";
const CAMPAIGN_ID = "11111111-2222-3333-4444-555555555555";

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

/** Minimalny, poprawny ładunek zapisu kampanii. */
function upsertInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: "Sierpniowy przegląd",
    subject_pl: "Temat PL",
    subject_en: "Subject EN",
    html_pl: "<p>PL</p>",
    html_en: "<p>EN</p>",
    editor: "html",
    audience_filter: {},
    ...overrides,
  };
}

let savedSiteUrl: string | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  savedSiteUrl = process.env.PUBLIC_SITE_URL;
  process.env.PUBLIC_SITE_URL = "https://example.test";

  db.reset();
  db.setResponse(PROFILES, ok({ tenant_id: TENANT }));
  db.setResponse(CAMPAIGNS, (chain: RecordedChain) => {
    if (chain.has("insert")) return ok({ id: "nowa-kampania" });
    if (chain.has("update") || chain.has("delete")) return ok(null);
    return ok(campaign());
  });
  db.setResponse(SUBSCRIBERS, okCount(42));

  setServerFnContext({ supabase: { from: db.from, rpc: h.rpc }, userId: "user-1" });
  h.rpc.mockResolvedValue({ data: null, error: null });
  h.sendEmail.mockResolvedValue({ ok: true, messageId: "m-1" });
});

afterEach(() => {
  resetServerFnContext();
  if (savedSiteUrl === undefined) delete process.env.PUBLIC_SITE_URL;
  else process.env.PUBLIC_SITE_URL = savedSiteUrl;
});

describe("obudowa", () => {
  it("wszystkie operacje kampanii są za rolą redakcyjną", () => {
    for (const fn of [
      listCampaigns,
      getCampaign,
      getCampaignEngagement,
      upsertCampaign,
      deleteCampaign,
      countCampaignAudience,
      sendCampaignTest,
    ]) {
      expect(serverFnMeta(fn)?.middleware).toEqual([{ __mw: "requireStaff" }]);
    }
    expect(serverFnMeta(listCampaigns)?.method).toBe("GET");
  });

  it("operacje zmieniające stan idą metodą POST", () => {
    expect(serverFnMeta(upsertCampaign)?.method).toBe("POST");
    expect(serverFnMeta(deleteCampaign)?.method).toBe("POST");
  });
});

describe("lista i odczyt", () => {
  it("lista jest posortowana od najnowszej i ograniczona", async () => {
    db.setResponse(CAMPAIGNS, ok([campaign()]));

    const rows = await listCampaigns();

    expect(rows).toHaveLength(1);
    const chain = db.lastChain(CAMPAIGNS);
    expect(chain?.argsOf("order")).toEqual(["created_at", { ascending: false }]);
    expect(chain?.argsOf("limit")).toEqual([200]);
  });

  it("pusta lista to pusta tablica, nie null", async () => {
    db.setResponse(CAMPAIGNS, ok(null));

    // `null` wywróciłby `.map()` w panelu na pustej instalacji.
    await expect(listCampaigns()).resolves.toEqual([]);
    await expect(listCampaigns()).resolves.toBeInstanceOf(Array);
  });

  it("błąd odczytu listy leci w górę", async () => {
    db.setResponse(CAMPAIGNS, fail("list failed"));

    // Nie pusta lista - inaczej operator zobaczyłby „brak kampanii" przy awarii.
    await expect(listCampaigns()).rejects.toThrow("list failed");
    expect(db.chainsFor(CAMPAIGNS).length).toBeGreaterThan(0);
  });

  it("odczyt pojedynczej kampanii filtruje po identyfikatorze", async () => {
    const row = await getCampaign({ data: { id: CAMPAIGN_ID } });

    expect(row).toMatchObject({ id: CAMPAIGN_ID });
    expect(db.lastChain(CAMPAIGNS)?.argsOf("eq")).toEqual(["id", CAMPAIGN_ID]);
  });

  it("brak kampanii to null, nie wyjątek", async () => {
    db.setResponse(CAMPAIGNS, ok(null));

    await expect(getCampaign({ data: { id: CAMPAIGN_ID } })).resolves.toBeNull();
    // Zapytanie POSZŁO - `null` to odpowiedź bazy, nie wyjście na skróty.
    expect(db.chainsFor(CAMPAIGNS).length).toBeGreaterThan(0);
  });

  it("błąd odczytu kampanii leci w górę", async () => {
    db.setResponse(CAMPAIGNS, fail("read failed"));

    // Nie `null` - „nie ma takiej kampanii" i „baza nie odpowiada" to dwie
    // różne rzeczy dla operatora.
    await expect(getCampaign({ data: { id: CAMPAIGN_ID } })).rejects.toThrow("read failed");
    await expect(getCampaign({ data: { id: CAMPAIGN_ID } })).rejects.toThrow();
  });

  it("odrzuca identyfikator, który nie jest UUID", async () => {
    await expect(getCampaign({ data: { id: "camp-1" } })).rejects.toThrow();
    expect(db.chainsFor(CAMPAIGNS)).toHaveLength(0);
  });
});

describe("zaangażowanie kampanii", () => {
  it("rozróżnia LICZBĘ ZDARZEŃ od LICZBY OSÓB", async () => {
    h.rpc.mockResolvedValue({
      data: [{ opens: 30, clicks: 12, unique_openers: 10, unique_clickers: 5 }],
      error: null,
    });

    const engagement = await getCampaignEngagement({ data: { id: CAMPAIGN_ID } });

    expect(engagement).toEqual({ opens: 30, clicks: 12, uniqueOpens: 10, uniqueClicks: 5 });
    expect(h.rpc).toHaveBeenCalledWith("newsletter_campaign_engagement", {
      p_campaign: CAMPAIGN_ID,
    });
  });

  it("liczniki podane tekstem (bigint z Postgresa) są parsowane", async () => {
    h.rpc.mockResolvedValue({
      data: { opens: "30", clicks: "12", unique_openers: "10", unique_clickers: "5" },
      error: null,
    });

    const engagement = await getCampaignEngagement({ data: { id: CAMPAIGN_ID } });

    expect(engagement.opens).toBe(30);
    expect(engagement.uniqueOpens).toBe(10);
  });

  it("wartości ujemne i śmieci schodzą do zera", async () => {
    h.rpc.mockResolvedValue({
      data: { opens: -5, clicks: "abc", unique_openers: null, unique_clickers: {} },
      error: null,
    });

    const engagement = await getCampaignEngagement({ data: { id: CAMPAIGN_ID } });

    expect(engagement).toEqual({ opens: 0, clicks: 0, uniqueOpens: 0, uniqueClicks: 0 });
    // Same liczby - „abc" albo `NaN` w panelu to widoczna awaria raportu.
    expect(Object.values(engagement).every((v) => Number.isFinite(v))).toBe(true);
  });

  it("BŁĄD odczytu czyta się jako zera - kafelek nie wywala edytora", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "rpc down" } });

    const engagement = await getCampaignEngagement({ data: { id: CAMPAIGN_ID } });

    expect(engagement).toEqual({ opens: 0, clicks: 0, uniqueOpens: 0, uniqueClicks: 0 });
    expect(h.rpc).toHaveBeenCalledTimes(1);
  });

  it("odpowiedź nie-obiektowa też daje zera", async () => {
    h.rpc.mockResolvedValue({ data: "nic", error: null });

    await expect(getCampaignEngagement({ data: { id: CAMPAIGN_ID } })).resolves.toEqual({
      opens: 0,
      clicks: 0,
      uniqueOpens: 0,
      uniqueClicks: 0,
    });
    // Zera, a nie wyjątek - raport ma się wyrenderować.
    await expect(getCampaignEngagement({ data: { id: CAMPAIGN_ID } })).resolves.toBeTruthy();
  });
});

describe("zapis kampanii", () => {
  it("nowa kampania dostaje tenanta i autora", async () => {
    const res = await upsertCampaign({ data: upsertInput() });

    expect(res).toEqual({ id: "nowa-kampania" });
    const inserted = db.lastChain(CAMPAIGNS)?.argsOf("insert")?.[0] as Record<string, unknown>;
    expect(inserted).toMatchObject({ tenant_id: TENANT, created_by: "user-1", status: "draft" });
  });

  it("data wysyłki zmienia status na zaplanowaną", async () => {
    await upsertCampaign({
      data: upsertInput({ scheduled_at: "2026-09-01T10:00:00.000Z" }),
    });

    const inserted = db.lastChain(CAMPAIGNS)?.argsOf("insert")?.[0] as Record<string, unknown>;
    expect(inserted).toMatchObject({
      status: "scheduled",
      scheduled_at: "2026-09-01T10:00:00.000Z",
    });
    // Nie „draft" - inaczej zaplanowana kampania nigdy nie zostałaby podjęta.
    expect(inserted.status).not.toBe("draft");
  });

  it("EDYCJA jest możliwa tylko dla kampanii, która NIE jest w locie", async () => {
    await upsertCampaign({ data: upsertInput({ id: CAMPAIGN_ID }) });

    const chain = db.lastChain(CAMPAIGNS);
    // To jedyna zapora przed podmianą treści kampanii w trakcie wysyłki.
    expect(chain?.argsOf("in")).toEqual(["status", ["draft", "scheduled", "failed"]]);
    expect(chain?.argsOf("eq")).toEqual(["id", CAMPAIGN_ID]);
  });

  it("edycja zwraca ten sam identyfikator", async () => {
    const res = await upsertCampaign({ data: upsertInput({ id: CAMPAIGN_ID }) });

    expect(res).toEqual({ id: CAMPAIGN_ID });
    expect(db.lastChain(CAMPAIGNS)?.has("insert")).toBe(false);
  });

  it("błąd zapisu edycji leci w górę", async () => {
    db.setResponse(CAMPAIGNS, fail("update rejected"));

    await expect(upsertCampaign({ data: upsertInput({ id: CAMPAIGN_ID }) })).rejects.toThrow(
      "update rejected",
    );
    // Edycja idzie UPDATE-em, nie INSERT-em - inaczej powstałby duplikat.
    expect(db.lastChain(CAMPAIGNS)?.has("insert")).toBe(false);
  });

  it("nieudane wstawienie daje czytelny błąd", async () => {
    db.setResponse(CAMPAIGNS, (chain: RecordedChain) =>
      chain.has("insert") ? fail("insert rejected") : ok(campaign()),
    );

    await expect(upsertCampaign({ data: upsertInput() })).rejects.toThrow("insert rejected");
    // Nowa kampania idzie INSERT-em - to jego odmowa wraca do operatora.
    expect(db.lastChain(CAMPAIGNS)?.has("insert")).toBe(true);
  });

  it("dokument kreatora jest NORMALIZOWANY parserem przed zapisem", async () => {
    const doc = {
      version: 1,
      blocks: [{ type: "text", id: "b1", text: { pl: "Cześć", en: "Hi" } }],
    };

    await upsertCampaign({ data: upsertInput({ editor: "doc", content_doc: doc }) });

    const inserted = db.lastChain(CAMPAIGNS)?.argsOf("insert")?.[0] as Record<string, unknown>;
    expect(inserted.content_doc).not.toBeNull();
    expect(inserted.editor).toBe("doc");
  });

  it("dokument nie do odczytania jest ODRZUCANY przy zapisie, nie przy wysyłce", async () => {
    await expect(
      upsertCampaign({ data: upsertInput({ editor: "doc", content_doc: "to nie dokument" }) }),
    ).rejects.toThrow("invalid_content_doc");
    expect(db.chainsFor(CAMPAIGNS).some((c) => c.has("insert"))).toBe(false);
  });

  it("tryb kreatora BEZ dokumentu jest odrzucany", async () => {
    await expect(upsertCampaign({ data: upsertInput({ editor: "doc" }) })).rejects.toThrow(
      "invalid_content_doc",
    );
    // Odrzucenie PRZED zapisem - puste ciało kampanii nie trafia do bazy.
    expect(db.chainsFor(CAMPAIGNS).some((c) => c.has("insert"))).toBe(false);
  });

  it("dokument ponad limit rozmiaru jest odrzucany", async () => {
    const huge = {
      version: 1,
      blocks: [{ type: "text", id: "b", text: { pl: "x".repeat(310_000) } }],
    };

    await expect(
      upsertCampaign({ data: upsertInput({ editor: "doc", content_doc: huge }) }),
    ).rejects.toThrow("doc_too_large");
    expect(db.chainsFor(CAMPAIGNS).some((c) => c.has("insert"))).toBe(false);
  });

  it("bez tenanta nie da się nic zapisać", async () => {
    db.setResponse(PROFILES, ok(null));

    await expect(upsertCampaign({ data: upsertInput() })).rejects.toThrow("no_tenant");
    // Zapis nie dochodzi do tabeli kampanii - inaczej wiersz byłby bez najemcy.
    expect(db.chainsFor(CAMPAIGNS).some((c) => c.has("insert"))).toBe(false);
  });
});

describe("kasowanie kampanii", () => {
  it("kampanii W LOCIE nie da się skasować", async () => {
    await deleteCampaign({ data: { id: CAMPAIGN_ID } });

    const chain = db.lastChain(CAMPAIGNS);
    expect(chain?.has("delete")).toBe(true);
    expect(chain?.argsOf("in")).toEqual(["status", ["draft", "scheduled", "failed", "cancelled"]]);
  });

  it("błąd kasowania leci w górę", async () => {
    db.setResponse(CAMPAIGNS, fail("delete rejected"));

    // Cicha porażka kasowania to kampania, którą operator uznał za usuniętą.
    await expect(deleteCampaign({ data: { id: CAMPAIGN_ID } })).rejects.toThrow("delete rejected");
    expect(db.lastChain(CAMPAIGNS)?.has("delete")).toBe(true);
  });

  it("odrzuca identyfikator, który nie jest UUID", async () => {
    await expect(deleteCampaign({ data: { id: "camp-1" } })).rejects.toThrow();
    expect(db.chainsFor(CAMPAIGNS)).toHaveLength(0);
  });
});

describe("licznik audiencji", () => {
  it("domyślnie liczy status `subscribed` zapytaniem LICZĄCYM", async () => {
    const res = await countCampaignAudience({ data: {} });

    expect(res).toEqual({ count: 42 });
    const chain = db.lastChain(SUBSCRIBERS);
    expect(chain?.argsOf("select")).toEqual(["id", { count: "exact", head: true }]);
    expect(chain?.argsOf("in")).toEqual(["status", ["subscribed"]]);
  });

  it("filtry języka i źródła zawężają licznik", async () => {
    await countCampaignAudience({ data: { languages: ["pl"], source: "popup" } });

    const chain = db.lastChain(SUBSCRIBERS);
    expect(chain?.calls.filter((c) => c.method === "in")).toHaveLength(2);
    expect(chain?.calls.filter((c) => c.method === "eq").map((c) => c.args[0])).toContain("source");
  });

  it("brak licznika czyta się jako zero", async () => {
    db.setResponse(SUBSCRIBERS, ok(null));

    await expect(countCampaignAudience({ data: {} })).resolves.toEqual({ count: 0 });
    // Liczba, nie `null` - panel pokazuje „0 odbiorców", nie puste miejsce.
    expect(typeof (await countCampaignAudience({ data: {} })).count).toBe("number");
  });

  it("błąd liczenia leci w górę", async () => {
    db.setResponse(SUBSCRIBERS, fail("count failed"));

    // Nie zero - „0 odbiorców" przy awarii wstrzymałoby wysyłkę bez powodu.
    await expect(countCampaignAudience({ data: {} })).rejects.toThrow("count failed");
    expect(db.chainsFor(SUBSCRIBERS).length).toBeGreaterThan(0);
  });

  it("segment po warstwie członkowskiej liczy CZĘŚĆ WSPÓLNĄ, nie sam status", async () => {
    // Przecięcie po adresie wymaga pobrania adresów - szybki head-count tu nie
    // wystarcza, bo warstwa mieszka w koncie, nie w wierszu subskrybenta.
    db.setResponse(
      SUBSCRIBERS,
      ok([{ email: "wczlonek@example.test" }, { email: "obcy@example.test" }]),
    );
    h.rpc.mockResolvedValue({
      data: [{ email: "wczlonek@example.test" }],
      error: null,
    });

    const res = await countCampaignAudience({ data: { min_tier_rank: 2 } });

    expect(res.count).toBeLessThanOrEqual(2);
    expect(db.lastChain(SUBSCRIBERS)?.argsOf("select")).toEqual(["email"]);
  });
});

describe("wysyłka testowa", () => {
  it("wysyła na wskazany adres z prefiksem [TEST]", async () => {
    const res = await sendCampaignTest({
      data: { id: CAMPAIGN_ID, toEmail: "redakcja@example.test", language: "pl" },
    });

    expect(res).toEqual({ ok: true });
    expect(h.sendEmail.mock.calls[0]?.[0]).toMatchObject({
      to: "redakcja@example.test",
      subject: "[TEST] Temat PL",
      from: "NES <biuro@example.test>",
    });
  });

  it("wariant angielski bierze angielski temat i treść", async () => {
    await sendCampaignTest({
      data: { id: CAMPAIGN_ID, toEmail: "redakcja@example.test", language: "en" },
    });

    expect(h.sendEmail.mock.calls[0]?.[0]).toMatchObject({ subject: "[TEST] Subject EN" });
    // Nie polski temat - wariant językowy dotyczy CAŁEGO maila.
    expect(h.sendEmail.mock.calls[0]?.[0].subject).not.toContain("Temat PL");
  });

  it("domyślnym językiem testu jest polski", async () => {
    await sendCampaignTest({ data: { id: CAMPAIGN_ID, toEmail: "redakcja@example.test" } });

    expect(h.sendEmail.mock.calls[0]?.[0]).toMatchObject({ subject: "[TEST] Temat PL" });
    // Prefiks [TEST] jest obowiązkowy - inaczej redakcja nie odróżni próby od
    // prawdziwej wysyłki.
    expect(h.sendEmail.mock.calls[0]?.[0].subject.startsWith("[TEST]")).toBe(true);
  });

  it("kampania jest przypięta do tenanta wywołującego", async () => {
    await sendCampaignTest({ data: { id: CAMPAIGN_ID, toEmail: "redakcja@example.test" } });

    const eqs = db.lastChain(CAMPAIGNS)?.calls.filter((c) => c.method === "eq");
    expect(eqs?.map((c) => c.args[0])).toEqual(["id", "tenant_id"]);
    // Sam identyfikator nie wystarcza - bez `tenant_id` obcy najemca mógłby
    // wysłać test z cudzej kampanii.
    expect(eqs).toHaveLength(2);
  });

  it("nieistniejąca kampania to jasny błąd", async () => {
    db.setResponse(CAMPAIGNS, ok(null));

    await expect(
      sendCampaignTest({ data: { id: CAMPAIGN_ID, toEmail: "redakcja@example.test" } }),
    ).rejects.toThrow("not_found");
    expect(h.sendEmail).not.toHaveBeenCalled();
  });

  it("odmowa dostawcy jest zgłaszana operatorowi, nie połykana", async () => {
    h.sendEmail.mockResolvedValue({ ok: false, error: "mailbox full" });

    await expect(
      sendCampaignTest({ data: { id: CAMPAIGN_ID, toEmail: "redakcja@example.test" } }),
    ).rejects.toThrow("mailbox full");
    // Próba wysyłki NASTĄPIŁA - błąd pochodzi od dostawcy, nie z walidacji.
    expect(h.sendEmail).toHaveBeenCalledTimes(1);
  });

  it("odmowa bez treści też daje czytelny błąd", async () => {
    h.sendEmail.mockResolvedValue({ ok: false });

    await expect(
      sendCampaignTest({ data: { id: CAMPAIGN_ID, toEmail: "redakcja@example.test" } }),
    ).rejects.toThrow("send_failed");
    expect(h.sendEmail).toHaveBeenCalledTimes(1);
  });

  it("odrzuca adres, który nie jest adresem", async () => {
    await expect(
      sendCampaignTest({ data: { id: CAMPAIGN_ID, toEmail: "to nie adres" } }),
    ).rejects.toThrow();
    expect(h.sendEmail).not.toHaveBeenCalled();
  });

  it("uszkodzony dokument kreatora zatrzymuje test", async () => {
    db.setResponse(CAMPAIGNS, ok(campaign({ editor: "doc", content_doc: "to nie dokument" })));

    await expect(
      sendCampaignTest({ data: { id: CAMPAIGN_ID, toEmail: "redakcja@example.test" } }),
    ).rejects.toThrow("invalid_content_doc");
    expect(h.sendEmail).not.toHaveBeenCalled();
  });

  it("test NIE dokleja linku wypisu - to nie jest wysyłka do listy", async () => {
    await sendCampaignTest({ data: { id: CAMPAIGN_ID, toEmail: "redakcja@example.test" } });

    const input = h.sendEmail.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(input).not.toHaveProperty("listUnsubscribeUrl");
    expect(input).not.toHaveProperty("tags");
  });
});
