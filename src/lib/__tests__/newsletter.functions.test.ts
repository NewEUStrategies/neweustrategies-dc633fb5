// Zapis do newslettera + double opt-in - ścieżka RODO i lejka naraz.
//
// Endpoint jest PUBLICZNY i nieuwierzytelniony, a jego skutkiem jest wysłanie
// maila na adres podany przez wywołującego. To czyni z niego jednocześnie:
// bramę zgody marketingowej, kanał do bombardowania cudzej skrzynki i sposób
// na spalenie limitu dostawcy. Dlatego testy pilnują tu nie „czy się zapisze",
// tylko KIEDY NIE WOLNO zapisać:
//   * adres na TRWAŁEJ liście wykluczeń nie dostaje ani maila, ani wiersza
//     `pending` - inaczej formularz na stronie byłby obejściem całej higieny
//     listy i kanałem do odbudowy złej reputacji domeny,
//   * limity są dwa (na IP i na ODBIORCĘ), bo sam limit na IP obchodzi się
//     rotacją adresu,
//   * potwierdzony subskrybent nigdy nie jest resetowany do `pending`,
//   * polityka pól tenanta jest nadrzędna wobec deklaracji widgetu.
//
// Reguł potwierdzania tokenu (wygasły / użyty dwa razy / adres wypisany) tu
// NIE powtarzamy - mają własny test w routes/-api.public.newsletter.confirm.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ok, fail, supabaseFromStub } from "@/test/supabaseChain";
import { setServerFnContext, resetServerFnContext } from "@/test/serverFn";

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  resolveTenantIdForHost: vi.fn(),
  currentTenantHost: vi.fn(),
  fetchSuppressedEmails: vi.fn(),
  rateLimit: vi.fn(),
  sendTxEmail: vi.fn(),
  getRequest: vi.fn(),
}));

vi.mock("@tanstack/react-start", async () =>
  (await import("@/test/serverFn")).serverFnModuleMock(),
);
vi.mock("@tanstack/react-start/server", () => ({ getRequest: h.getRequest }));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: (t: string) => db.from(t), rpc: h.rpc },
}));
vi.mock("@/lib/server/tenant.server", () => ({
  resolveTenantIdForHost: h.resolveTenantIdForHost,
}));
vi.mock("@/lib/http/requestHost", () => ({ currentTenantHost: h.currentTenantHost }));
vi.mock("@/lib/email/suppression.server", () => ({
  fetchSuppressedEmails: h.fetchSuppressedEmails,
}));
vi.mock("@/lib/server/rate-limit.server", () => ({ rateLimit: h.rateLimit }));
vi.mock("@/lib/email/transactional.server", () => ({ sendTxEmail: h.sendTxEmail }));

import { subscribeToNewsletter } from "@/lib/newsletter.functions";

const db = supabaseFromStub();
const SETTINGS = "newsletter_settings";
const SUBSCRIBERS = "newsletter_subscribers";

const TENANT = "tenant-1";

/** Poprawne zgłoszenie z formularza - test dokłada tylko to, co bada. */
function input(overrides: Record<string, unknown> = {}) {
  return { email: "nowy@example.test", language: "pl", ...overrides };
}

/** Ustawienia newslettera tenanta. */
function settings(overrides: Record<string, unknown> = {}) {
  return {
    tenant_id: TENANT,
    enabled: true,
    double_opt_in: true,
    sender_name: null,
    sender_email: null,
    ...overrides,
  };
}

/**
 * Domyślny plan odpowiedzi bazy: ustawienia tenanta, brak istniejącego
 * subskrybenta, upsert się udaje, token wypisu wraca z triggera.
 */
function defaultDb(): void {
  db.setResponse(SETTINGS, ok(settings()));
  db.setResponse(SUBSCRIBERS, (chain) => {
    if (chain.has("upsert")) return ok(null);
    if (chain.argsOf("select")?.[0] === "unsubscribe_token") {
      return ok({ unsubscribe_token: "unsub-tok" });
    }
    return ok(null);
  });
}

let fetchMock: ReturnType<typeof vi.fn>;
const ENV_KEYS = [
  "PUBLIC_SITE_URL",
  "SITE_URL",
  "URL",
  "LOVABLE_API_KEY",
  "RESEND_API_KEY",
] as const;
let savedEnv: Record<string, string | undefined>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const key of ENV_KEYS) delete process.env[key];
  process.env.PUBLIC_SITE_URL = "https://example.test";

  db.reset();
  defaultDb();
  setServerFnContext({ supabase: { from: db.from, rpc: h.rpc } });

  h.rpc.mockResolvedValue({ data: [], error: null });
  h.resolveTenantIdForHost.mockResolvedValue(TENANT);
  h.currentTenantHost.mockResolvedValue("example.test");
  h.fetchSuppressedEmails.mockResolvedValue(new Map());
  h.rateLimit.mockResolvedValue(true);
  h.sendTxEmail.mockResolvedValue(undefined);
  h.getRequest.mockReturnValue(
    new Request("https://example.test/zapis", { headers: { "user-agent": "vitest" } }),
  );

  fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  resetServerFnContext();
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.unstubAllGlobals();
  errorSpy.mockRestore();
});

/** Ładunek ostatniego upsertu subskrybenta. */
function upserted(): Record<string, unknown> {
  const chain = db.chainsFor(SUBSCRIBERS).find((c) => c.has("upsert"));
  return (chain?.argsOf("upsert")?.[0] ?? {}) as Record<string, unknown>;
}

/** Treść maila DOI wysłanego przez gateway. */
function sentMail(): Record<string, unknown> {
  const init = fetchMock.mock.calls[0]?.[1] as { body?: string } | undefined;
  return JSON.parse(init?.body ?? "{}") as Record<string, unknown>;
}

describe("konfiguracja tenanta", () => {
  it("host bez tenanta nie zapisuje niczego", async () => {
    h.resolveTenantIdForHost.mockResolvedValue(null);

    const res = await subscribeToNewsletter({ data: input() });

    expect(res).toEqual({ ok: false, error: "not_configured" });
    expect(db.chainsFor(SUBSCRIBERS)).toHaveLength(0);
  });

  it("brak ustawień newslettera to `not_configured`", async () => {
    db.setResponse(SETTINGS, ok(null));

    const res = await subscribeToNewsletter({ data: input() });

    expect(res).toEqual({ ok: false, error: "not_configured" });
    expect(db.chainsFor(SUBSCRIBERS)).toHaveLength(0);
  });

  it("ustawienia są przypięte do tenanta hosta - nie do „pierwszego wiersza”", async () => {
    await subscribeToNewsletter({ data: input() });

    expect(db.lastChain(SETTINGS)?.argsOf("eq")).toEqual(["tenant_id", TENANT]);
    expect(h.currentTenantHost).toHaveBeenCalledTimes(1);
  });

  it("wyłączony newsletter odmawia zapisu", async () => {
    db.setResponse(SETTINGS, ok(settings({ enabled: false })));

    const res = await subscribeToNewsletter({ data: input() });

    expect(res).toEqual({ ok: false, error: "disabled" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("walidacja wejścia", () => {
  it("odrzuca adres, który nie jest adresem", async () => {
    await expect(
      subscribeToNewsletter({ data: input({ email: "to nie adres" }) }),
    ).rejects.toThrow();
    expect(db.chainsFor(SETTINGS)).toHaveLength(0);
  });

  it("adres jest sprowadzany do małych liter - unikalność jest bez wielkości liter", async () => {
    await subscribeToNewsletter({ data: input({ email: "Nowy@Example.TEST" }) });

    expect(upserted().email).toBe("nowy@example.test");
    // Bez tego ten sam człowiek zapisany dwa razy różną wielkością liter
    // dostawałby dwa maile i liczył się dwa razy w raporcie.
    expect(upserted().email).not.toContain("N");
  });

  it("domyślnym językiem jest polski", async () => {
    await subscribeToNewsletter({ data: { email: "nowy@example.test" } });

    expect(upserted().language).toBe("pl");
    // Podany język wygrywa nad domyślnym.
    expect(upserted().email).toBe("nowy@example.test");
  });
});

describe("polityka pól", () => {
  it("naruszenie polityki tenanta zatrzymuje zapis i nazywa pola", async () => {
    h.rpc.mockResolvedValue({ data: ["required:company"], error: null });

    const res = await subscribeToNewsletter({ data: input() });

    expect(res).toEqual({ ok: false, error: "policy_violation:required:company" });
    expect(db.chainsFor(SUBSCRIBERS).some((c) => c.has("upsert"))).toBe(false);
  });

  it("pola wymagane przez widget rozszerzają politykę tenanta", async () => {
    const res = await subscribeToNewsletter({
      data: input({ requiredFields: ["firstName", "lastName"] }),
    });

    expect(res).toEqual({
      ok: false,
      error: "policy_violation:required:firstName,required:lastName",
    });
    // Odrzucenie PRZED zapisem - niepełny wiersz nie trafia do tabeli.
    expect(db.chainsFor(SUBSCRIBERS).some((c) => c.has("upsert"))).toBe(false);
  });

  it("wymagane pole PODANE nie jest naruszeniem", async () => {
    const res = await subscribeToNewsletter({
      data: input({ requiredFields: ["firstName"], firstName: "Anna" }),
    });

    expect(res).toMatchObject({ ok: true });
    expect(upserted().first_name).toBe("Anna");
  });

  it("powtórzone naruszenia nie dublują się w komunikacie", async () => {
    h.rpc.mockResolvedValue({ data: ["required:company"], error: null });

    const res = await subscribeToNewsletter({
      data: input({ requiredFields: ["company"], meta: {} }),
    });

    expect(res).toEqual({ ok: false, error: "policy_violation:required:company" });
    // Jedno wystąpienie, nie „required:company,required:company".
    expect(res.ok ? [] : res.error.split(",")).toHaveLength(1);
  });

  it("awaria sprawdzenia polityki nie blokuje zapisu, ale zostawia ślad w logu", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "rpc down" } });

    const res = await subscribeToNewsletter({ data: input() });

    expect(res).toMatchObject({ ok: true });
    expect(errorSpy).toHaveBeenCalledWith("[newsletter] policy check failed", expect.anything());
  });

  it("politykę sprawdzamy dla właściwego typu formularza", async () => {
    await subscribeToNewsletter({ data: input({ formType: "join_us" }) });

    expect(h.rpc).toHaveBeenCalledWith(
      "enforce_form_field_policy",
      expect.objectContaining({ _tenant: TENANT, _form_type: "join_us" }),
    );
  });
});

describe("adres już zapisany", () => {
  it("POTWIERDZONY subskrybent nie jest resetowany do `pending`", async () => {
    db.setResponse(SUBSCRIBERS, (chain) =>
      chain.has("upsert") ? ok(null) : ok({ id: "s-1", status: "subscribed" }),
    );

    const res = await subscribeToNewsletter({ data: input() });

    expect(res).toEqual({ ok: true, status: "exists" });
    expect(db.chainsFor(SUBSCRIBERS).some((c) => c.has("upsert"))).toBe(false);
  });

  it("adres `pending` może spróbować ponownie - token się odświeża", async () => {
    db.setResponse(SUBSCRIBERS, (chain) => {
      if (chain.has("upsert")) return ok(null);
      if (chain.argsOf("select")?.[0] === "unsubscribe_token") {
        return ok({ unsubscribe_token: "unsub-tok" });
      }
      return ok({ id: "s-1", status: "pending" });
    });

    const res = await subscribeToNewsletter({ data: input() });

    expect(res).toMatchObject({ ok: true, status: "pending" });
    expect(upserted().confirmation_token).toEqual(expect.any(String));
  });
});

describe("lista wykluczeń", () => {
  it("TRWAŁA blokada nie dostaje ani maila, ani wiersza `pending`", async () => {
    h.fetchSuppressedEmails.mockResolvedValue(
      new Map([["nowy@example.test", { scope: "permanent", reason: "complaint" }]]),
    );

    const res = await subscribeToNewsletter({ data: input() });

    expect(res).toEqual({ ok: false, error: "suppressed" });
    expect(db.chainsFor(SUBSCRIBERS).some((c) => c.has("upsert"))).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("blokada CZASOWA nie zatrzymuje zapisu - nowa zgoda jest świeżym dowodem", async () => {
    h.fetchSuppressedEmails.mockResolvedValue(
      new Map([["nowy@example.test", { scope: "transient", reason: "soft_bounce" }]]),
    );

    const res = await subscribeToNewsletter({ data: input() });

    expect(res).toMatchObject({ ok: true, status: "pending" });
    expect(upserted().status).toBe("pending");
  });
});

describe("limity nadużyć", () => {
  it("limit na IP zatrzymuje zapis", async () => {
    h.rateLimit.mockResolvedValueOnce(false);

    const res = await subscribeToNewsletter({ data: input() });

    expect(res).toEqual({ ok: false, error: "rate_limited" });
    expect(h.rateLimit.mock.calls[0]?.[0]).toMatchObject({ scope: "newsletter.subscribe" });
  });

  it("limit na ODBIORCĘ trzyma nawet przy rotacji IP", async () => {
    h.rateLimit.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    const res = await subscribeToNewsletter({ data: input() });

    expect(res).toEqual({ ok: false, error: "rate_limited" });
    expect(h.rateLimit.mock.calls[1]?.[0]).toMatchObject({
      scope: "newsletter.recipient",
      subjectId: "nowy@example.test",
    });
  });

  it("nieznane IP trafia do WSPÓLNEGO wiadra - usunięcie nagłówka nie omija limitu", async () => {
    h.getRequest.mockReturnValue(new Request("https://example.test/zapis"));

    await subscribeToNewsletter({ data: input() });

    expect(h.rateLimit.mock.calls[0]?.[0]).toMatchObject({ subjectId: "unknown-ip" });
    // Drugie wiadro (per adres) działa niezależnie od nagłówka IP, więc bot bez
    // `x-forwarded-for` nadal nie zapisze jednego adresu bez limitu.
    expect(h.rateLimit.mock.calls.map((c) => c[0].scope)).toEqual([
      "newsletter.subscribe",
      "newsletter.recipient",
    ]);
  });

  it("IP czytamy z nagłówków proxy w ustalonej kolejności", async () => {
    h.getRequest.mockReturnValue(
      new Request("https://example.test/zapis", {
        headers: { "cf-connecting-ip": "203.0.113.7", "x-forwarded-for": "198.51.100.1, 10.0.0.1" },
      }),
    );

    await subscribeToNewsletter({ data: input() });

    expect(h.rateLimit.mock.calls[0]?.[0]).toMatchObject({ subjectId: "203.0.113.7" });
    expect(upserted().ip).toBe("203.0.113.7");
  });

  it("bez cf-connecting-ip bierzemy PIERWSZY adres z x-forwarded-for", async () => {
    h.getRequest.mockReturnValue(
      new Request("https://example.test/zapis", {
        headers: { "x-forwarded-for": "198.51.100.1, 10.0.0.1" },
      }),
    );

    await subscribeToNewsletter({ data: input() });

    expect(upserted().ip).toBe("198.51.100.1");
  });

  it("brak kontekstu żądania nie wywraca zapisu", async () => {
    h.getRequest.mockImplementation(() => {
      throw new Error("brak kontekstu");
    });

    const res = await subscribeToNewsletter({ data: input() });

    expect(res).toMatchObject({ ok: true });
    expect(upserted().ip).toBeNull();
  });
});

describe("double opt-in WŁĄCZONY", () => {
  it("zapisuje `pending` z tokenem i terminem ważności 48h", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-18T10:00:00.000Z"));

    const res = await subscribeToNewsletter({ data: input() });

    expect(res).toMatchObject({ ok: true, status: "pending" });
    const row = upserted();
    expect(row.status).toBe("pending");
    expect(row.confirmed_at).toBeNull();
    expect(row.confirmation_expires_at).toBe("2026-08-20T10:00:00.000Z");
    vi.useRealTimers();
  });

  it("token potwierdzenia jest losowym hexem 64 znaków (mennica po stronie serwera)", async () => {
    await subscribeToNewsletter({ data: input() });

    expect(String(upserted().confirmation_token)).toMatch(/^[0-9a-f]{64}$/);
    // 64 znaki hex to 32 bajty entropii - token krótszy dałby się zgadnąć.
    expect(String(upserted().confirmation_token)).toHaveLength(64);
  });

  it("dwa zapisy dostają RÓŻNE tokeny", async () => {
    await subscribeToNewsletter({ data: input() });
    const first = upserted().confirmation_token;
    db.reset();
    defaultDb();
    await subscribeToNewsletter({ data: input() });

    expect(upserted().confirmation_token).not.toBe(first);
    // Drugi token jest równie dobry - nie „ten sam z dopiskiem".
    expect(String(upserted().confirmation_token)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("upsert celuje w parę (tenant, e-mail) - to ona jest kluczem unikalności", async () => {
    await subscribeToNewsletter({ data: input() });

    const chain = db.chainsFor(SUBSCRIBERS).find((c) => c.has("upsert"));
    expect(chain?.argsOf("upsert")?.[1]).toEqual({ onConflict: "tenant_id,email" });
    expect(upserted().tenant_id).toBe(TENANT);
  });

  it("mail potwierdzający niesie link z tokenem", async () => {
    process.env.LOVABLE_API_KEY = "lov";
    process.env.RESEND_API_KEY = "re";

    await subscribeToNewsletter({ data: input() });

    const token = String(upserted().confirmation_token);
    expect(String(sentMail().html)).toContain(`/newsletter/confirm?token=${token}`);
    expect(String(sentMail().subject)).toBeTruthy();
  });

  it("mail niesie też link wypisu, gdy trigger wystawił token", async () => {
    process.env.LOVABLE_API_KEY = "lov";
    process.env.RESEND_API_KEY = "re";

    await subscribeToNewsletter({ data: input() });

    expect(String(sentMail().html)).toContain("/newsletter/unsubscribe?token=unsub-tok");
    // Link potwierdzenia jest w tym samym mailu - jeden mail, dwie drogi.
    expect(String(sentMail().html)).toContain("/newsletter/confirm");
  });

  it("brak tokenu wypisu nie blokuje maila potwierdzającego", async () => {
    process.env.LOVABLE_API_KEY = "lov";
    process.env.RESEND_API_KEY = "re";
    db.setResponse(SUBSCRIBERS, (chain) => (chain.has("upsert") ? ok(null) : ok(null)));

    const res = await subscribeToNewsletter({ data: input() });

    expect(res).toMatchObject({ ok: true, emailSent: true });
    expect(String(sentMail().html)).not.toContain("/newsletter/unsubscribe");
  });

  it("nadawca tenanta trafia do nagłówka From", async () => {
    process.env.LOVABLE_API_KEY = "lov";
    process.env.RESEND_API_KEY = "re";
    db.setResponse(
      SETTINGS,
      ok(settings({ sender_name: "NES", sender_email: "biuro@example.test" })),
    );

    await subscribeToNewsletter({ data: input() });

    expect(sentMail().from).toBe("NES <biuro@example.test>");
    // Nazwa i adres w jednym nagłówku - sam adres wygląda w skrzynce na spam.
    expect(String(sentMail().from)).toContain("<biuro@example.test>");
  });

  it("brak skonfigurowanej poczty NIE gubi zapisu - wiersz `pending` zostaje", async () => {
    const res = await subscribeToNewsletter({ data: input() });

    expect(res).toEqual({ ok: true, status: "pending", emailSent: false });
    expect(upserted().status).toBe("pending");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("odmowa dostawcy poczty nie kasuje zapisu - wraca `emailSent: false`", async () => {
    process.env.LOVABLE_API_KEY = "lov";
    process.env.RESEND_API_KEY = "re";
    fetchMock.mockResolvedValue(new Response("rate limited", { status: 429 }));

    const res = await subscribeToNewsletter({ data: input() });

    // Wiersz `pending` MUSI zostać: adres da się potwierdzić, gdy poczta wróci.
    expect(res).toEqual({ ok: true, status: "pending", emailSent: false });
    expect(upserted().status).toBe("pending");
  });

  it("awaria sieci przy wysyłce też nie gubi zapisu", async () => {
    process.env.LOVABLE_API_KEY = "lov";
    process.env.RESEND_API_KEY = "re";
    fetchMock.mockRejectedValue(new Error("ECONNRESET"));

    const res = await subscribeToNewsletter({ data: input() });

    expect(res).toMatchObject({ ok: true, status: "pending", emailSent: false });
    expect(errorSpy).toHaveBeenCalled();
  });

  it("błąd zapisu subskrybenta jest zwracany wprost", async () => {
    db.setResponse(SUBSCRIBERS, (chain) =>
      chain.has("upsert") ? fail("duplicate key") : ok(null),
    );

    const res = await subscribeToNewsletter({ data: input() });

    expect(res).toEqual({ ok: false, error: "duplicate key" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("double opt-in WYŁĄCZONY", () => {
  beforeEach(() => {
    db.setResponse(SETTINGS, ok(settings({ double_opt_in: false })));
  });

  it("zapisuje od razu jako potwierdzony", async () => {
    const res = await subscribeToNewsletter({ data: input() });

    expect(res).toEqual({ ok: true, status: "subscribed" });
    const row = upserted();
    expect(row.status).toBe("subscribed");
    expect(row.confirmation_token).toBeNull();
  });

  it("wysyła powitanie kolejką transakcyjną, z kluczem idempotencji", async () => {
    await subscribeToNewsletter({ data: input() });

    expect(h.sendTxEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "newsletter_confirmed",
        to: "nowy@example.test",
        tenantId: TENANT,
        idempotencyKey: `newsletter_confirmed:${TENANT}:nowy@example.test`,
      }),
    );
    // Jedno powitanie na potwierdzenie, nie jedno na każde wejście w link.
    expect(h.sendTxEmail).toHaveBeenCalledTimes(1);
  });

  it("adres docelowy powitania zależy od języka", async () => {
    await subscribeToNewsletter({ data: input({ language: "en" }) });

    expect(h.sendTxEmail.mock.calls[0]?.[0]).toMatchObject({ ctaPath: "/en/analyses", lang: "en" });
    // Prefiks językowy w ścieżce - bez niego odbiorca ląduje na polskiej stronie.
    expect(h.sendTxEmail.mock.calls[0]?.[0].ctaPath.startsWith("/en/")).toBe(true);
  });

  it("błąd zapisu zatrzymuje wysyłkę powitania", async () => {
    db.setResponse(SUBSCRIBERS, (chain) => (chain.has("upsert") ? fail("boom") : ok(null)));

    const res = await subscribeToNewsletter({ data: input() });

    expect(res).toEqual({ ok: false, error: "boom" });
    expect(h.sendTxEmail).not.toHaveBeenCalled();
  });
});

describe("ślad zgody i źródła", () => {
  it("zapisuje zgody wraz ze źródłem, formularzem i przeglądarką", async () => {
    const consents = [
      { key: "marketing", text: "Zgoda marketingowa", version: "1.0", given: true },
    ];

    await subscribeToNewsletter({
      data: input({
        consents,
        source: "popup-glowny",
        formId: "form-7",
        formName: "Popup startowy",
      }),
    });

    const row = upserted();
    expect(row.consents).toEqual(consents);
    expect(row.source).toBe("popup-glowny");
    expect(row.source_form_id).toBe("form-7");
    expect(row.source_form_name).toBe("Popup startowy");
    expect(row.user_agent).toBe("vitest");
  });

  it("bez podanego źródła zapisujemy źródło domyślne, nie pustkę", async () => {
    await subscribeToNewsletter({ data: input() });

    expect(upserted().source).toBe("newsletter-form");
    expect(upserted().consents).toEqual([]);
  });

  it("pola dodatkowe trafiają do `meta` tylko wtedy, gdy są", async () => {
    await subscribeToNewsletter({ data: input({ meta: { company: "ACME" } }) });
    const withMeta = upserted();
    db.reset();
    defaultDb();
    await subscribeToNewsletter({ data: input({ meta: {} }) });

    expect(withMeta.meta).toEqual({ company: "ACME" });
    // Pusta `meta` NIE nadpisuje pól złapanych wcześniej innym formularzem.
    expect(upserted()).not.toHaveProperty("meta");
  });

  it("dane kontaktowe idą do CRM razem z polami niestandardowymi", async () => {
    await subscribeToNewsletter({
      data: input({
        firstName: "Anna",
        lastName: "Nowak",
        meta: { company: "ACME", phone: "+48 111 222 333" },
        custom: { rola: "analityk" },
      }),
    });

    expect(h.rpc).toHaveBeenCalledWith(
      "crm_upsert_from_form",
      expect.objectContaining({
        _tenant: TENANT,
        _email: "nowy@example.test",
        _first_name: "Anna",
        _company: "ACME",
        _custom: { rola: "analityk" },
      }),
    );
    // Nazwisko też jedzie - kontakt w CRM bez nazwiska jest bezużyteczny.
    expect(h.rpc.mock.calls.find((c) => c[0] === "crm_upsert_from_form")?.[1]).toMatchObject({
      _last_name: "Nowak",
    });
  });

  it("wyjątek z CRM też jest połykany - zapis do newslettera jest ważniejszy", async () => {
    h.rpc.mockImplementation((name: string) => {
      if (name === "crm_upsert_from_form") throw new Error("crm wybuchł");
      return Promise.resolve({ data: [], error: null });
    });

    const res = await subscribeToNewsletter({ data: input() });

    expect(res).toMatchObject({ ok: true });
    expect(errorSpy).toHaveBeenCalledWith("[newsletter] crm sync threw", expect.anything());
  });

  it("awaria synchronizacji z CRM nie przewraca zapisu", async () => {
    h.rpc.mockImplementation((name: string) =>
      name === "crm_upsert_from_form"
        ? Promise.resolve({ data: null, error: { message: "crm down" } })
        : Promise.resolve({ data: [], error: null }),
    );

    const res = await subscribeToNewsletter({ data: input() });

    expect(res).toMatchObject({ ok: true });
    expect(errorSpy).toHaveBeenCalledWith("[newsletter] crm sync failed", expect.anything());
  });
});

describe("adres linku potwierdzającego (bezpieczeństwo)", () => {
  it("bierze się z konfiguracji, a nie z nagłówków żądania", async () => {
    process.env.LOVABLE_API_KEY = "lov";
    process.env.RESEND_API_KEY = "re";
    process.env.PUBLIC_SITE_URL = "https://example.test/";
    h.getRequest.mockReturnValue(
      new Request("https://example.test/zapis", {
        // Podstawiony nagłówek proxy: gdyby wygrał, link DOI prowadziłby na
        // domenę atakującego, a token wyciekłby wraz z kliknięciem.
        headers: { "x-forwarded-host": "phishing.example" },
      }),
    );

    await subscribeToNewsletter({ data: input() });

    const html = String(sentMail().html);
    expect(html).toContain("https://example.test/newsletter/confirm");
    expect(html).not.toContain("phishing.example");
  });

  it("imię z formularza jest ESKAPOWANE w treści maila (wstrzyknięcie HTML)", async () => {
    process.env.LOVABLE_API_KEY = "lov";
    process.env.RESEND_API_KEY = "re";

    await subscribeToNewsletter({
      data: input({ name: '<script>alert("x")</script>' }),
    });

    const html = String(sentMail().html);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("bez konfiguracji i bez kontekstu żądania link jest względny, a nie „undefined”", async () => {
    process.env.LOVABLE_API_KEY = "lov";
    process.env.RESEND_API_KEY = "re";
    delete process.env.PUBLIC_SITE_URL;
    h.getRequest.mockImplementation(() => {
      throw new Error("brak kontekstu");
    });

    const res = await subscribeToNewsletter({ data: input() });

    expect(res).toMatchObject({ ok: true });
    expect(String(sentMail().html)).toContain("/newsletter/confirm?token=");
    expect(String(sentMail().html)).not.toContain("undefined/newsletter");
  });

  it("bez konfiguracji schodzi na origin z URL-a żądania", async () => {
    process.env.LOVABLE_API_KEY = "lov";
    process.env.RESEND_API_KEY = "re";
    delete process.env.PUBLIC_SITE_URL;
    h.getRequest.mockReturnValue(new Request("https://zapas.example.test/zapis"));

    await subscribeToNewsletter({ data: input() });

    expect(String(sentMail().html)).toContain("https://zapas.example.test/newsletter/confirm");
    // Nie „undefined/newsletter/confirm" - link bez hosta jest martwy.
    expect(String(sentMail().html)).not.toContain("undefined/newsletter");
  });
});
