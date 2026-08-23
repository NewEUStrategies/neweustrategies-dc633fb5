// Kampanie newslettera - DOBICIE gałęzi, których nie dotykają trzy istniejące
// pliki (`newsletterCampaignCrud`, `newsletterCampaignSend`,
// `newsletterCampaignTick`).
//
// Ten plik CELOWO nie powtarza tego, co tam jest zielone. Zmierzone luki
// prowadziły do czterech decyzji o realnej konsekwencji, a każda z nich kończy
// się wysłaną - czyli nieodwracalną - wiadomością:
//
//  1. SEGMENT CZŁONKOWSKI (`min_tier_rank`). Przecięcie listy subskrybentów
//     z warstwami członkostwa idzie po e-mailu i po RPC. Pomyłka w tym miejscu
//     wysyła treść zarezerwowaną dla członków do CAŁEJ listy - albo, w drugą
//     stronę, milcząco ucina kampanię do zera odbiorców.
//  2. KREATOR TREŚCI (`editor: "doc"`) W CHWILI WYSYŁKI. Dokument renderuje się
//     dopiero przy wysyłce, nie przy zapisie. Pusty render przepuszczony dalej
//     zostawia kampanię ze statusem „wysłano" i pustymi skrzynkami odbiorców.
//  3. PERSONALIZACJA I TRACKING. `{{firstName}}` wchodzi do HTML-a maila - bez
//     escapowania imię z pola formularza jest wektorem wstrzyknięcia znacznika.
//     Każdy link w treści jest podpisywany osobno, żeby przekierowanie
//     kliknięcia nie stało się otwartym redirectem.
//  4. PORCJOWANIE. Jedno wywołanie wysyła najwyżej MAX_EMAILS_PER_INVOCATION
//     e-maili paczkami po 20, z przerwą między paczkami (limit dostawcy).
//     Brak przerwy = odrzucone paczki i kampania w połowie.
//
// CZEGO TEN PLIK NIE DOWODZI: AUTORYZACJI. Atrapa `createServerFn` nie
// uruchamia middleware - deklaracje bramek pilnuje `newsletterCampaignCrud`
// i `check:authz-snapshot`.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ok, fail, supabaseFromStub, type RecordedChain } from "@/test/supabaseChain";
import { setServerFnContext, resetServerFnContext } from "@/test/serverFn";

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
  supabaseAdmin: { from: (table: string) => db.from(table), rpc: h.rpc },
}));
vi.mock("@/lib/email/provider.server", () => ({ sendEmail: h.sendEmail }));
vi.mock("@/lib/email/suppression.server", () => ({
  fetchSuppressedEmails: h.fetchSuppressedEmails,
}));
vi.mock("@/lib/email/reputationGate.server", () => ({ evaluateSendGate: h.evaluateSendGate }));

import {
  countCampaignAudience,
  processDueCampaigns,
  resolveCampaignDocPosts,
  searchCampaignPosts,
  sendCampaign,
  sendCampaignTest,
  tickNewsletterCampaigns,
  upsertCampaign,
} from "@/lib/newsletter-campaigns.functions";

const db = supabaseFromStub();
const CAMPAIGNS = "newsletter_campaigns";
const SUBSCRIBERS = "newsletter_subscribers";
const RECIPIENTS = "newsletter_campaign_recipients";
const PROFILES = "profiles";
const POSTS = "posts";

const TENANT = "tenant-1";
const CAMPAIGN_ID = "11111111-2222-3333-4444-555555555555";
const OTHER_ID = "99999999-8888-7777-6666-555555555555";
/** Stała data bazowa - dzierżawy i znaczniki czasu mają być powtarzalne. */
const NOW = new Date("2026-08-22T10:00:00.000Z");

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

/** Dokument kreatora z jednym nagłówkiem - renderuje się w obu językach. */
function docZNaglowkiem(pl = "Wydanie sierpniowe", en = "August issue"): Record<string, unknown> {
  return {
    version: 1,
    blocks: [{ id: "b1", type: "heading", level: 2, align: "left", text: { pl, en } }],
    style: {},
  };
}

interface Plan {
  audience: Record<string, unknown>[];
  logged: Record<string, unknown>[];
  claimed: Record<string, unknown> | null;
  claimError: string | null;
  currentStatus: string;
  campaignRow: Record<string, unknown> | null;
  due: Record<string, unknown>[] | null;
  continuing: Record<string, unknown>[] | null;
  posts: Record<string, unknown>[] | null;
  postsError: string | null;
}
let plan: Plan;

/** Ładunki wysłane do dostawcy poczty. */
function wyslane(): Record<string, unknown>[] {
  return h.sendEmail.mock.calls.map((call) => call[0] as Record<string, unknown>);
}

/** Wpisy do logu odbiorców. */
function logi(): Record<string, unknown>[] {
  return db
    .chainsFor(RECIPIENTS)
    .map((chain) => chain.argsOf("upsert")?.[0])
    .filter((row): row is Record<string, unknown> => Boolean(row));
}

/** Zapisy stanu kampanii, w kolejności. */
function zapisyKampanii(): Record<string, unknown>[] {
  return db
    .chainsFor(CAMPAIGNS)
    .map((chain) => chain.argsOf("update")?.[0])
    .filter((row): row is Record<string, unknown> => Boolean(row));
}

const ENV_KEYS = ["PUBLIC_SITE_URL", "SITE_URL", "URL"] as const;
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
  process.env.PUBLIC_SITE_URL = "https://example.test";

  plan = {
    audience: [subscriber()],
    logged: [],
    claimed: campaign(),
    claimError: null,
    currentStatus: "draft",
    campaignRow: campaign(),
    due: [],
    continuing: [],
    posts: [],
    postsError: null,
  };

  db.reset();
  db.setResponse(PROFILES, ok({ tenant_id: TENANT }));
  db.setResponse(SUBSCRIBERS, () => ok(plan.audience));
  db.setResponse(RECIPIENTS, (chain: RecordedChain) =>
    chain.has("upsert") ? ok(null) : ok(plan.logged),
  );
  db.setResponse(POSTS, () => (plan.postsError ? fail(plan.postsError) : ok(plan.posts)));
  db.setResponse(CAMPAIGNS, (chain: RecordedChain) => {
    // Przejęcie kampanii: UPDATE ... .select().maybeSingle()
    if (chain.has("update") && chain.has("select")) {
      return plan.claimError ? fail(plan.claimError) : ok(plan.claimed);
    }
    if (chain.has("update")) return ok(null);
    const kolumny = String(chain.argsOf("select")?.[0] ?? "");
    if (kolumny === "status") return ok({ status: plan.currentStatus });
    if (kolumny.includes("tenant_id")) {
      // Tick czyta dwie listy: najpierw zaległe (`scheduled`), potem kontynuacje.
      const status = chain.calls.find((c) => c.method === "eq" && c.args[0] === "status")?.args[1];
      return ok(status === "scheduled" ? plan.due : plan.continuing);
    }
    return ok(plan.campaignRow);
  });

  setServerFnContext({ supabase: { from: db.from, rpc: h.rpc }, userId: "user-1" });

  h.rpc.mockResolvedValue({ data: [], error: null });
  h.sendEmail.mockResolvedValue({ ok: true, messageId: "prov-1", provider: "resend" });
  h.fetchSuppressedEmails.mockResolvedValue(new Map());
  h.evaluateSendGate.mockResolvedValue({ allowed: true, errorCode: null });
});

afterEach(() => {
  vi.useRealTimers();
  resetServerFnContext();
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

// ---------------------------------------------------------------------------
// SEGMENT CZŁONKOWSKI
// ---------------------------------------------------------------------------

describe("segment członkowski - treść dla członków nie może wyjść do całej listy", () => {
  it("licznik pokazuje CZĘŚĆ WSPÓLNĄ listy i warstwy, a nie całą listę", async () => {
    plan.audience = [
      { email: "czlonek@example.test" },
      { email: "Gosc@example.test" },
      { email: "inny@example.test" },
    ];
    h.rpc.mockResolvedValue({
      data: [{ email: "CZLONEK@example.test" }, { email: "ktos-spoza-listy@example.test" }],
      error: null,
    });

    const res = await countCampaignAudience({ data: { min_tier_rank: 20 } });

    // Porównanie idzie po adresie znormalizowanym - inaczej ta sama osoba
    // wypadłaby z segmentu przez jedną wielką literę w imporcie.
    expect(res).toEqual({ count: 1 });
    expect(h.rpc).toHaveBeenCalledWith("newsletter_min_tier_emails", {
      p_tenant: TENANT,
      p_min: 20,
    });
  });

  it("licznik segmentu respektuje pozostałe zawężenia (język, źródło, status)", async () => {
    plan.audience = [];
    await countCampaignAudience({
      data: {
        min_tier_rank: 10,
        languages: ["en"],
        source: "formularz-stopka",
        statuses: ["pending"],
      },
    });

    const chain = db.lastChain(SUBSCRIBERS);
    expect(chain?.argsOf("in")).toEqual(["status", ["pending"]]);
    expect(chain?.calls.filter((c) => c.method === "in").at(-1)?.args).toEqual([
      "language",
      ["en"],
    ]);
    expect(chain?.calls.find((c) => c.method === "eq" && c.args[0] === "source")?.args).toEqual([
      "source",
      "formularz-stopka",
    ]);
  });

  it("awaria odczytu listy przy segmencie zatrzymuje licznik, zamiast pokazać zero", async () => {
    // Zero odbiorców na ekranie to informacja „nie masz do kogo pisać".
    // Awaria odczytu to informacja „nie wiem" - i tylko druga jest prawdziwa.
    db.setResponse(SUBSCRIBERS, fail("subscribers unreachable"));

    await expect(countCampaignAudience({ data: { min_tier_rank: 5 } })).rejects.toThrow(
      "subscribers unreachable",
    );
  });

  it("awaria RPC warstw zatrzymuje licznik - inaczej segment „schodziłby” do zera", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "tier rpc down" } });

    await expect(countCampaignAudience({ data: { min_tier_rank: 5 } })).rejects.toThrow(
      "tier rpc down",
    );
  });

  it("wiersz warstwy bez adresu nie wchodzi do segmentu", async () => {
    // Konto bez e-maila nie ma jak dostać newslettera; wpuszczone do zbioru
    // dawałoby pusty adres w porównaniu i fałszywe trafienia.
    plan.audience = [{ email: "czlonek@example.test" }, { email: "" }];
    h.rpc.mockResolvedValue({
      data: [{ email: null }, { email: "czlonek@example.test" }],
      error: null,
    });

    expect(await countCampaignAudience({ data: { min_tier_rank: 1 } })).toEqual({ count: 1 });
  });

  it("puste odpowiedzi z bazy i z RPC dają segment pusty, a nie wyjątek", async () => {
    // PostgREST i RPC oddają `data: null` zamiast pustej tablicy. Panel ma
    // wtedy pokazać zero odbiorców, a nie wywalić ekran ustawień kampanii.
    db.setResponse(SUBSCRIBERS, ok(null));
    h.rpc.mockResolvedValue({ data: null, error: null });

    expect(await countCampaignAudience({ data: { min_tier_rank: 40 } })).toEqual({ count: 0 });
  });

  it("WYSYŁKA respektuje segment - poza warstwą nikt nie dostaje wiadomości", async () => {
    plan.claimed = campaign({ audience_filter: { min_tier_rank: 30 } });
    plan.audience = [
      subscriber({ id: "sub-1", email: "czlonek@example.test" }),
      subscriber({ id: "sub-2", email: "gosc@example.test" }),
    ];
    h.rpc.mockResolvedValue({ data: [{ email: "czlonek@example.test" }], error: null });

    await sendCampaign({ data: { id: CAMPAIGN_ID } });

    expect(wyslane().map((mail) => mail.to)).toEqual(["czlonek@example.test"]);
  });
});

// ---------------------------------------------------------------------------
// WYSYŁKA TESTOWA Z KREATORA
// ---------------------------------------------------------------------------

describe("wysyłka testowa - podgląd musi być tym samym, co pójdzie do ludzi", () => {
  it("kampania z kreatora renderuje się do treści testu, z prefiksem [TEST]", async () => {
    plan.campaignRow = campaign({ editor: "doc", content_doc: docZNaglowkiem() });

    await sendCampaignTest({
      data: { id: CAMPAIGN_ID, toEmail: "redakcja@example.test", language: "pl" },
    });

    const mail = wyslane()[0];
    expect(mail.subject).toBe("[TEST] Temat PL");
    expect(String(mail.html)).toContain("Wydanie sierpniowe");
    // Test nie jest trackowany i nie niesie stopki wypisu - to nie jest wysyłka
    // do subskrybenta, tylko podgląd dla redakcji.
    expect(String(mail.html)).not.toContain("nl-open");
  });

  it("uszkodzony dokument NIE wychodzi jako pusty mail", async () => {
    plan.campaignRow = campaign({ editor: "doc", content_doc: { wersja: "inna" } });

    await expect(
      sendCampaignTest({ data: { id: CAMPAIGN_ID, toEmail: "redakcja@example.test" } }),
    ).rejects.toThrow("invalid_content_doc");
    expect(h.sendEmail).not.toHaveBeenCalled();
  });

  it("dokument pusty w wybranym języku kończy się czytelnym błędem, nie „wysłano”", async () => {
    plan.campaignRow = campaign({
      editor: "doc",
      content_doc: { version: 1, blocks: [], style: {} },
    });

    await expect(
      sendCampaignTest({
        data: { id: CAMPAIGN_ID, toEmail: "redakcja@example.test", language: "en" },
      }),
    ).rejects.toThrow("missing_content_for_language");
    expect(h.sendEmail).not.toHaveBeenCalled();
  });

  it("kampania bez nazwy nadawcy wychodzi z samego adresu, a nie z „undefined <…>”", async () => {
    plan.campaignRow = campaign({ from_name: null });

    await sendCampaignTest({ data: { id: CAMPAIGN_ID, toEmail: "redakcja@example.test" } });

    expect(wyslane()[0].from).toBe("biuro@example.test");
  });

  it("kampania bez adresu nadawcy oddaje decyzję dostawcy (domyślny nadawca)", async () => {
    plan.campaignRow = campaign({ from_email: null });

    await sendCampaignTest({ data: { id: CAMPAIGN_ID, toEmail: "redakcja@example.test" } });

    expect(wyslane()[0].from).toBeUndefined();
  });

  it("kampania nieistniejąca w tym najemcy nie wysyła niczego", async () => {
    plan.campaignRow = null;

    await expect(
      sendCampaignTest({ data: { id: OTHER_ID, toEmail: "redakcja@example.test" } }),
    ).rejects.toThrow("not_found");
    expect(h.sendEmail).not.toHaveBeenCalled();
  });

  it("odmowa dostawcy bez komunikatu nadal jest błędem, a nie cichym sukcesem", async () => {
    h.sendEmail.mockResolvedValue({ ok: false });

    await expect(
      sendCampaignTest({ data: { id: CAMPAIGN_ID, toEmail: "redakcja@example.test" } }),
    ).rejects.toThrow("send_failed");
  });
});

// ---------------------------------------------------------------------------
// KREATOR TREŚCI W CHWILI WYSYŁKI
// ---------------------------------------------------------------------------

describe("kreator treści w wysyłce - dokument renderuje się dopiero teraz", () => {
  it("odbiorca PL i EN dostają render w swoim języku z jednego dokumentu", async () => {
    plan.claimed = campaign({ editor: "doc", content_doc: docZNaglowkiem() });
    plan.audience = [
      subscriber({ id: "sub-1", email: "pl@example.test", language: "pl" }),
      subscriber({ id: "sub-2", email: "en@example.test", language: "en" }),
    ];

    await sendCampaign({ data: { id: CAMPAIGN_ID } });

    const wg = new Map(wyslane().map((mail) => [mail.to, String(mail.html)]));
    expect(wg.get("pl@example.test")).toContain("Wydanie sierpniowe");
    expect(wg.get("en@example.test")).toContain("August issue");
  });

  it("pusta lista odbiorców zamyka kampanię bez ani jednego maila", async () => {
    // Zarówno audiencja, jak i log odbiorców wracają z bazy jako `null`, gdy
    // nic nie pasuje. Czytanie tego jako awarii zostawiłoby kampanię w
    // `sending`, którą tick wznawiałby w nieskończoność.
    db.setResponse(SUBSCRIBERS, ok(null));
    db.setResponse(RECIPIENTS, (chain: RecordedChain) =>
      chain.has("upsert") ? ok(null) : ok(null),
    );

    const res = await sendCampaign({ data: { id: CAMPAIGN_ID } });

    expect(res).toMatchObject({ sent: 0, failed: 0, done: true, remaining: 0 });
    expect(h.sendEmail).not.toHaveBeenCalled();
    expect(zapisyKampanii().at(-1)).toMatchObject({ status: "sent" });
  });

  it("uszkodzony dokument ZATRZYMUJE kampanię i zapisuje powód", async () => {
    plan.claimed = campaign({ editor: "doc", content_doc: "to nie jest dokument" });

    await expect(sendCampaign({ data: { id: CAMPAIGN_ID } })).rejects.toThrow(
      "invalid_content_doc",
    );
    expect(h.sendEmail).not.toHaveBeenCalled();
    expect(zapisyKampanii().at(-1)).toMatchObject({
      status: "failed",
      last_error: "invalid_content_doc",
    });
  });

  it("dokument pusty w OBU językach nie kończy kampanii jako „wysłana”", async () => {
    // Inaczej kampania zamyka się ze statusem `sent` i zerem maili, a redakcja
    // dowiaduje się o tym z pytania czytelników.
    plan.claimed = campaign({
      editor: "doc",
      content_doc: { version: 1, blocks: [], style: {} },
    });

    await expect(sendCampaign({ data: { id: CAMPAIGN_ID } })).rejects.toThrow("empty_content_doc");
    expect(zapisyKampanii().at(-1)).toMatchObject({ status: "failed" });
  });

  it("brak tematu w języku odbiorcy pomija JEGO, nie całą kampanię", async () => {
    plan.claimed = campaign({ subject_en: "" });
    plan.audience = [
      subscriber({ id: "sub-1", email: "pl@example.test", language: "pl" }),
      subscriber({ id: "sub-2", email: "en@example.test", language: "en" }),
    ];

    await sendCampaign({ data: { id: CAMPAIGN_ID } });

    expect(wyslane().map((mail) => mail.to)).toEqual(["pl@example.test"]);
    expect(logi().find((row) => row.email === "en@example.test")).toMatchObject({
      status: "skipped",
      error: "missing_content_for_language",
    });
  });
});

// ---------------------------------------------------------------------------
// PERSONALIZACJA, TRACKING, ODPOWIEDŹ DOSTAWCY
// ---------------------------------------------------------------------------

describe("personalizacja i tracking - treść maila powstaje z danych osoby", () => {
  it("imię z formularza jest ESCAPOWANE - pole tekstowe nie wstrzykuje znacznika", async () => {
    // Imię wpisuje sam subskrybent w publicznym formularzu. Bez escapowania
    // `<img onerror=…>` wjeżdża do HTML-a maila każdego odbiorcy.
    plan.claimed = campaign({ html_pl: "<p>Cześć {{firstName}}, {{email}}</p>" });
    plan.audience = [
      subscriber({ first_name: '<img src=x onerror="alert(1)">', email: "a&b@example.test" }),
    ];

    await sendCampaign({ data: { id: CAMPAIGN_ID } });

    const html = String(wyslane()[0].html);
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("a&amp;b@example.test");
  });

  it("każdy link w treści jedzie przez PODPISANE przekierowanie", async () => {
    // Bez podpisu per-link adres przekierowania da się podmienić w URL-u -
    // czyli mail z domeny nadawcy staje się otwartym redirectem.
    plan.claimed = campaign({
      html_pl: '<p><a href="https://nes.example.test/analiza">Czytaj</a></p>',
    });

    await sendCampaign({ data: { id: CAMPAIGN_ID } });

    const html = String(wyslane()[0].html);
    expect(html).toContain("/api/public/nl-click");
    // `k=` to podpis PER LINK (osobny od tokenu trackingu `s=`): tylko adresy
    // podpisane w tej wysyłce mogą być celem przekierowania.
    expect(html).toMatch(/[?&;]k=[0-9a-f]{8,}/);
  });

  it("subskrybent bez tokenu wypisu nie dostaje stopki z pustym odnośnikiem", async () => {
    plan.audience = [subscriber({ unsubscribe_token: null })];

    await sendCampaign({ data: { id: CAMPAIGN_ID } });

    expect(wyslane()[0].listUnsubscribeUrl).toBeNull();
    expect(String(wyslane()[0].html)).not.toContain("/newsletter/unsubscribe");
  });

  it("odpowiedź dostawcy bez identyfikatora nie psuje logu korelacji", async () => {
    h.sendEmail.mockResolvedValue({ ok: true });

    await sendCampaign({ data: { id: CAMPAIGN_ID } });

    expect(logi()[0]).toMatchObject({ status: "sent", provider_message_id: null });
  });

  it.each([
    ["sam kod HTTP", { ok: false, status: 429 }, "http_429"],
    ["ani kodu, ani komunikatu", { ok: false }, "http_unknown"],
  ])(
    "odrzucenie przez dostawcę (%s) trafia do logu z powodem",
    async (_nazwa, odpowiedz, oczekiwany) => {
      // Log odbiorców jest jedynym miejscem, z którego da się odtworzyć, KTO nie
      // dostał wiadomości i dlaczego - bez tego wznowienie leci na ślepo.
      h.sendEmail.mockResolvedValue(odpowiedz);

      await sendCampaign({ data: { id: CAMPAIGN_ID } });

      expect(logi()[0]).toMatchObject({ status: "failed", error: oczekiwany });
    },
  );

  it("adres z listy wykluczeń bez podanego powodu trafia do logu jako `unknown`", async () => {
    // Wpis w logu jest dowodem, że wysyłki NIE BYŁO świadomie - a nie że się
    // nie udała.
    h.fetchSuppressedEmails.mockResolvedValue(new Map([["zablokowany@example.test", {}]]));
    plan.audience = [
      subscriber({ id: "sub-1", email: "zablokowany@example.test", language: "en" }),
    ];

    await sendCampaign({ data: { id: CAMPAIGN_ID } });

    expect(logi()[0]).toMatchObject({
      status: "suppressed",
      error: "suppressed:unknown",
      language: "en",
    });
    expect(h.sendEmail).not.toHaveBeenCalled();
  });

  it("awaria spoza klasy Error też zamyka kampanię statusem `failed`", async () => {
    // Odrzucenie napisem (albo obiektem bez `message`) zostawiłoby kampanię
    // w `sending` na zawsze - a tick wznawiałby ją w kółko.
    h.sendEmail.mockRejectedValue("dostawca zerwał połączenie");

    await expect(sendCampaign({ data: { id: CAMPAIGN_ID } })).rejects.toThrow(
      "dostawca zerwał połączenie",
    );
    expect(zapisyKampanii().at(-1)).toMatchObject({
      status: "failed",
      last_error: "dostawca zerwał połączenie",
    });
  });
});

// ---------------------------------------------------------------------------
// PORCJOWANIE
// ---------------------------------------------------------------------------

describe("porcjowanie paczek - limit dostawcy jest twardy", () => {
  it("lista dłuższa niż paczka idzie w DWÓCH paczkach z przerwą między nimi", async () => {
    // Bez przerwy dostawca odrzuca drugą paczkę, a kampania kończy się
    // „wysłana" z połową listy bez wiadomości.
    plan.audience = Array.from({ length: 21 }, (_, i) =>
      subscriber({ id: `sub-${i}`, email: `odbiorca${i}@example.test` }),
    );

    const bieg = sendCampaign({ data: { id: CAMPAIGN_ID } });
    // Przerwa jest realnym opóźnieniem - bez przesunięcia zegara wysyłka
    // stanęłaby na dwudziestym pierwszym adresie.
    await vi.advanceTimersByTimeAsync(5_000);
    const res = await bieg;

    expect(res.sent).toBe(21);
    expect(h.sendEmail).toHaveBeenCalledTimes(21);
    // Postęp zapisuje się PO KAŻDEJ paczce - zamknięta karta nie kasuje pracy.
    const postepy = zapisyKampanii().filter((row) => "lease_until" in row && row.lease_until);
    expect(postepy.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// TICK Z PANELU
// ---------------------------------------------------------------------------

describe("tick z panelu - zaległe kampanie bez człowieka przy klawiaturze", () => {
  it("przycisk „wyślij zaległe” działa WYŁĄCZNIE w granicach swojego najemcy", async () => {
    // Ta sama pętla biegnie cross-tenant z crona. Zgubione zawężenie oznacza,
    // że admin jednego serwisu odpala kampanie innego.
    plan.due = [{ id: CAMPAIGN_ID, tenant_id: TENANT }];
    plan.claimed = campaign({ status: "sending" });

    const res = await processDueCampaigns();

    expect(res).toMatchObject({ fired: 1, continued: 0 });
    const listy = db
      .chainsFor(CAMPAIGNS)
      .filter(
        (chain) =>
          !chain.has("update") && String(chain.argsOf("select")?.[0] ?? "").includes("tenant_id"),
      );
    expect(listy.length).toBeGreaterThan(0);
    for (const chain of listy) {
      expect(chain.calls.some((c) => c.method === "eq" && c.args[0] === "tenant_id")).toBe(true);
    }
  });

  it("brak zaległych i brak kontynuacji to poprawny wynik zerowy, nie awaria", async () => {
    // PostgREST oddaje `data: null`, gdy nic nie pasuje - czytanie tego jako
    // błędu zapalałoby operatorowi czerwony toast przy każdym wejściu na listę.
    plan.due = null;
    plan.continuing = null;

    expect(await processDueCampaigns()).toEqual({ fired: 0, continued: 0, sent: 0 });
    expect(h.sendEmail).not.toHaveBeenCalled();
  });

  it("wyczerpany budżet PRZERYWA listę kontynuacji zamiast przekroczyć limit", async () => {
    // Budżet jest wspólny dla całego ticku; przekroczenie go oznacza odrzucone
    // paczki u dostawcy dla WSZYSTKICH kampanii w tej turze.
    plan.continuing = [
      { id: CAMPAIGN_ID, tenant_id: TENANT },
      { id: OTHER_ID, tenant_id: TENANT },
    ];
    plan.claimed = campaign({ status: "sending" });

    const res = await tickNewsletterCampaigns({ from: db.from, rpc: h.rpc } as never, {
      maxEmails: 1,
    });

    expect(res.continued).toBe(1);
    expect(h.sendEmail).toHaveBeenCalledTimes(1);
  });

  it("awaria przejęcia kampanii jest zgłaszana, a nie brana za „nie ma czego wysyłać”", async () => {
    plan.claimError = "claim failed";

    await expect(sendCampaign({ data: { id: CAMPAIGN_ID } })).rejects.toThrow("claim failed");
    expect(h.sendEmail).not.toHaveBeenCalled();
  });

  it("bramka reputacji bez podanego kodu nadal ZATRZYMUJE wysyłkę", async () => {
    h.evaluateSendGate.mockResolvedValue({ allowed: false, errorCode: null });

    await expect(sendCampaign({ data: { id: CAMPAIGN_ID } })).rejects.toThrow("reputation_blocked");
    expect(h.sendEmail).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// ZAPIS KAMPANII - GAŁĄŹ BEZ WIERSZA
// ---------------------------------------------------------------------------

describe("zapis nowej kampanii", () => {
  it("baza, która nie oddała wiersza, nie udaje udanego zapisu", async () => {
    // Bez tego panel przechodzi do edytora kampanii o identyfikatorze
    // `undefined` i redakcja pisze treść, która nigdzie się nie zapisuje.
    db.setResponse(CAMPAIGNS, ok(null));

    await expect(
      upsertCampaign({
        data: {
          name: "Wrześniowy przegląd",
          subject_pl: "Temat",
          subject_en: "Subject",
          html_pl: "<p>PL</p>",
          html_en: "<p>EN</p>",
          editor: "html",
          audience_filter: {},
        },
      }),
    ).rejects.toThrow("insert_failed");
  });
});

// ---------------------------------------------------------------------------
// PODGLĄD KREATORA
// ---------------------------------------------------------------------------

describe("podgląd kreatora - te same dane, którymi pójdzie wysyłka", () => {
  it("dokument z blokiem wpisów dostaje wiersze do podglądu", async () => {
    plan.posts = [
      {
        id: "post-1",
        slug: "analiza-energetyczna",
        title_pl: "Analiza energetyczna",
        title_en: "Energy analysis",
        excerpt_pl: null,
        excerpt_en: null,
        cover_image_url: null,
        published_at: "2026-08-01T08:00:00.000Z",
      },
    ];

    const res = await resolveCampaignDocPosts({
      data: {
        doc: {
          version: 1,
          blocks: [{ id: "b1", type: "post-list", mode: "latest", limit: 3 }],
          style: {},
        },
      },
    });

    expect(JSON.parse(res.json)).toHaveProperty("b1");
  });

  it("dokument, którego parser nie rozumie, daje pusty podgląd zamiast wyjątku", async () => {
    expect(await resolveCampaignDocPosts({ data: { doc: "nie-dokument" } })).toEqual({
      json: "{}",
    });
  });

  it("podgląd NIE jest tańszą drogą na wpchnięcie ogromnego ładunku", async () => {
    // Ten sam limit, co przy zapisie - inaczej podgląd staje się wektorem DoS
    // na endpoint, który i tak parsuje cały dokument.
    const wielkiDokument = {
      version: 1,
      blocks: [{ id: "b1", type: "paragraph", html: { pl: "x".repeat(300_001), en: "" } }],
      style: {},
    };

    await expect(resolveCampaignDocPosts({ data: { doc: wielkiDokument } })).rejects.toThrow(
      "doc_too_large",
    );
  });

  it("brak dokumentu w ładunku czyta się jako pusty podgląd", async () => {
    expect(await resolveCampaignDocPosts({ data: { doc: null } })).toEqual({ json: "{}" });
  });
});

describe("wyszukiwarka wpisów do bloku „wybrane wpisy”", () => {
  it("bez frazy podpowiada najnowsze OPUBLIKOWANE wpisy tego najemcy", async () => {
    plan.posts = [{ id: "post-1", slug: "a", title_pl: "A", title_en: "A", published_at: null }];

    const res = await searchCampaignPosts({ data: { search: "" } });

    expect(JSON.parse(res.json)).toHaveLength(1);
    const chain = db.lastChain(POSTS);
    expect(chain?.calls.find((c) => c.method === "eq" && c.args[0] === "status")?.args).toEqual([
      "status",
      "published",
    ]);
    expect(chain?.argsOf("is")).toEqual(["deleted_at", null]);
    expect(chain?.argsOf("limit")).toEqual([10]);
    // Bez frazy nie ma filtra tekstowego - inaczej pusta droplista przy starcie.
    expect(chain?.has("or")).toBe(false);
  });

  it("fraza jest CZYSZCZONA ze znaków, którymi da się rozbić filtr PostgREST", async () => {
    await searchCampaignPosts({ data: { search: 'Energia,"(%_)\\' } });

    const filtr = String(db.lastChain(POSTS)?.argsOf("or")?.[0] ?? "");
    expect(filtr).toContain("title_pl.ilike.%energia%");
    expect(filtr).toContain("title_en.ilike.");
    expect(filtr).toContain("slug.ilike.");
    for (const znak of ['"', "(", ")", "%_", "\\"]) {
      expect(filtr.split("energia").join("")).not.toContain(znak);
    }
  });

  it("awaria wyszukiwarki jest zgłaszana, a nie podawana jako „brak wyników”", async () => {
    plan.postsError = "posts unreachable";

    await expect(searchCampaignPosts({ data: { search: "energia" } })).rejects.toThrow(
      "posts unreachable",
    );
  });

  it("brak wyników to pusta lista, nie `null` w odpowiedzi", async () => {
    plan.posts = null;

    expect(await searchCampaignPosts({ data: {} })).toEqual({ json: "[]" });
  });
});
