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
import { ok, fail, supabaseFromStub, type SupabaseResult } from "@/test/supabaseChain";
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
import {
  NEWSLETTER_CONSENT_VERSION,
  NEWSLETTER_CONSENT_VERSION_BUNDLED,
  newsletterConsentHtml,
  newsletterConsentPayload,
  resolveNewsletterConsent,
  signupNewsletterSubscription,
} from "@/lib/newsletter/consentText";
import { CONSENT_ENTRIES_MAX } from "@/lib/newsletter/consentLimits";
import {
  EMAIL_MEASUREMENT_CONSENT_VERSION,
  MEASUREMENT_DOI_MAIL_NOTE,
  measurementConsentHtml,
  measurementConsentPayload,
  measurementConsentPlain,
} from "@/lib/newsletter/measurementConsentText";
import { verifyDoiMeasurementToken } from "@/lib/privacy/measurementToken.server";

const db = supabaseFromStub();
const SETTINGS = "newsletter_settings";
const SUBSCRIBERS = "newsletter_subscribers";

const TENANT = "tenant-1";
/** Identyfikator wiersza `pending` oddawany po upsercie (wiąże sekret skrzynki). */
const PENDING_ID = "5a5a5a5a-0000-4000-8000-00000000d001";

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
    if (chain.argsOf("select")?.[0] === "id, unsubscribe_token") {
      return ok({ id: PENDING_ID, unsubscribe_token: "unsub-tok" });
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

  it("ponowny zapis istniejącego adresu = zaangażowanie (wygaszanie, I9d-Y1), odpowiedź bez zmian", async () => {
    db.setResponse(SUBSCRIBERS, (chain) =>
      chain.has("upsert") ? ok(null) : ok({ id: "s-1", status: "subscribed" }),
    );

    const res = await subscribeToNewsletter({ data: input() });

    expect(res).toEqual({ ok: true, status: "exists" });
    const touch = h.rpc.mock.calls.find((c) => c[0] === "newsletter_engagement_touch");
    expect(touch?.[1]).toEqual({
      p_tenant: expect.any(String),
      p_email: input().email.toLowerCase(),
    });
  });

  it("awaria znacznika zaangażowania nie psuje formularza", async () => {
    db.setResponse(SUBSCRIBERS, (chain) =>
      chain.has("upsert") ? ok(null) : ok({ id: "s-1", status: "subscribed" }),
    );
    h.rpc.mockImplementation(async (name: string) =>
      name === "newsletter_engagement_touch"
        ? { data: null, error: { message: "touch down" } }
        : { data: [], error: null },
    );

    expect(await subscribeToNewsletter({ data: input() })).toEqual({ ok: true, status: "exists" });
  });

  it("adres `pending` może spróbować ponownie - token się odświeża", async () => {
    db.setResponse(SUBSCRIBERS, (chain) => {
      if (chain.has("upsert")) return ok(null);
      if (chain.argsOf("select")?.[0] === "id, unsubscribe_token") {
        return ok({ id: PENDING_ID, unsubscribe_token: "unsub-tok" });
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

  it("wypis NIE zamyka ponownego zapisu przez double opt-in - zgodę można wyrazić znowu", async () => {
    h.fetchSuppressedEmails.mockResolvedValue(
      new Map([["nowy@example.test", { scope: "permanent", reason: "unsubscribe" }]]),
    );

    const res = await subscribeToNewsletter({ data: input() });

    expect(res).toMatchObject({ ok: true, status: "pending" });
    expect(upserted().status).toBe("pending");
  });

  it("wypis zatrzymuje zapis BEZ double opt-in - obcy adres nie wraca do wysyłki", async () => {
    db.setResponse(SETTINGS, ok(settings({ double_opt_in: false })));
    h.fetchSuppressedEmails.mockResolvedValue(
      new Map([["nowy@example.test", { scope: "permanent", reason: "unsubscribe" }]]),
    );

    const res = await subscribeToNewsletter({ data: input() });

    expect(res).toEqual({ ok: false, error: "suppressed" });
    expect(db.chainsFor(SUBSCRIBERS).some((c) => c.has("upsert"))).toBe(false);
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

  it("bez cf-connecting-ip bierzemy OSTATNI adres z x-forwarded-for", async () => {
    // Lista rośnie od klienta w stronę serwera: pierwszy wpis dopisuje KLIENT,
    // a proxy dokleja adres połączenia na KOŃCU. Kubełek kluczowany pierwszym
    // wpisem rotował się jednym nagłówkiem.
    h.getRequest.mockReturnValue(
      new Request("https://example.test/zapis", {
        headers: { "x-forwarded-for": "198.51.100.1, 203.0.113.9" },
      }),
    );

    await subscribeToNewsletter({ data: input() });

    expect(upserted().ip).toBe("203.0.113.9");
  });

  it("rotacja prefiksu `x-forwarded-for` NIE daje nowego kubełka", async () => {
    const podmioty: unknown[] = [];
    for (const prefiks of ["1.2.3.4", "8.8.8.8"]) {
      h.rateLimit.mockClear();
      h.getRequest.mockReturnValue(
        new Request("https://example.test/zapis", {
          headers: { "x-forwarded-for": `${prefiks}, 203.0.113.9` },
        }),
      );
      await subscribeToNewsletter({ data: input() });
      podmioty.push(h.rateLimit.mock.calls[0]?.[0]?.subjectId);
    }

    expect(podmioty[0]).toBe("203.0.113.9");
    expect(podmioty[1]).toBe(podmioty[0]);
  });

  it("puste `x-forwarded-for` nie udaje adresu - wspólny kubełek, NULL w wierszu", async () => {
    h.getRequest.mockReturnValue(
      new Request("https://example.test/zapis", { headers: { "x-forwarded-for": " " } }),
    );

    await subscribeToNewsletter({ data: input() });

    expect(upserted().ip).toBeNull();
    expect(h.rateLimit.mock.calls[0]?.[0]).toMatchObject({ subjectId: "unknown-ip" });
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

    // Ten sam adres co w kampaniach: ENDPOINT z handlerem POST, nie strona SPA
    // (`@/lib/newsletter/unsubscribeUrl`).
    expect(String(sentMail().html)).toContain("/api/public/newsletter/unsubscribe?token=unsub-tok");
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
    expect(row.consents).toMatchObject(consents);
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

describe("newsletter preference tags in CRM", () => {
  it.each([null, [], ["existing", 7], ["topic:energia"]])(
    "merges incoming tags without deleting prior CRM tags (%j)",
    async (tags) => {
      db.setResponse("crm_leads", (chain) =>
        chain.has("update") ? ok(null) : ok({ id: "lead-1", tags }),
      );
      const result = await subscribeToNewsletter({
        data: input({ meta: { interests: "energia", mailing_lists: "Analizy" } }),
      });
      expect(result).toMatchObject({ ok: true });
      const update = db.chainsFor("crm_leads").find((c) => c.has("update"));
      expect(update?.argsOf("update")?.[0]).toMatchObject({
        tags: expect.arrayContaining([
          expect.stringContaining("energia"),
          expect.stringContaining("Analizy"),
        ]),
      });
      if (Array.isArray(tags) && tags.includes("existing"))
        expect(update?.argsOf("update")?.[0]).toMatchObject({
          tags: expect.arrayContaining(["existing"]),
        });
    },
  );
  it("ignores tag sync transport failures after saving the subscription", async () => {
    db.setResponse("crm_leads", () => {
      throw new Error("offline");
    });
    const result = await subscribeToNewsletter({ data: input({ meta: { interests: "energia" } }) });
    expect(result).toMatchObject({ ok: true });
    expect(errorSpy).toHaveBeenCalledWith("[newsletter] crm tag sync threw", expect.any(Error));
  });
});

it("preserves client interaction time and stamps receipt with the server clock", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const received = new Date("2026-09-13T20:00:00.000Z");
  vi.setSystemTime(received);
  try {
    const result = await subscribeToNewsletter({
      data: input({
        consents: [
          {
            key: "privacy",
            text: "Privacy version A",
            version: "v1",
            given: true,
            timestamp: "2026-09-13T19:59:58.000Z",
            received_at: "2099-01-01T00:00:00.000Z",
          },
        ],
      }),
    });
    expect(result.ok).toBe(true);
    expect(upserted().consents).toEqual([
      {
        key: "privacy",
        text: "Privacy version A",
        version: "v1",
        given: true,
        timestamp: "2026-09-13T19:59:58.000Z",
        received_at: received.toISOString(),
      },
    ]);
  } finally {
    vi.useRealTimers();
  }
});

describe("wersja treści zgody (I9d-Y2)", () => {
  it("treść z rejestru zachowuje wersję z pomiarem w `consents`", async () => {
    await subscribeToNewsletter({
      data: input({
        consents: [
          {
            key: "newsletter",
            text: newsletterConsentHtml("pl"),
            version: NEWSLETTER_CONSENT_VERSION,
            given: true,
            lang: "pl",
          },
        ],
      }),
    });
    const [entry] = upserted().consents as Record<string, unknown>[];
    expect(entry).toMatchObject({
      key: "newsletter",
      text: newsletterConsentHtml("pl"),
      version: NEWSLETTER_CONSENT_VERSION,
    });
    expect(typeof entry.received_at).toBe("string");
  });

  it("obca treść z wersją z pomiarem traci wersję - klient nie nada zgody na pomiar etykietą", async () => {
    await subscribeToNewsletter({
      data: input({
        consents: [{ key: "newsletter", text: "Cokolwiek.", version: NEWSLETTER_CONSENT_VERSION }],
      }),
    });
    const [entry] = upserted().consents as Record<string, unknown>[];
    expect(entry.text).toBe("Cokolwiek.");
    expect(entry).not.toHaveProperty("version");
  });

  it("inna wersja (skrót popupu) przechodzi bez zmian", async () => {
    await subscribeToNewsletter({
      data: input({
        consents: [
          { key: "privacy", text: "Polityka", version: "sha256:0123456789abcdef01234567" },
        ],
      }),
    });
    const [entry] = upserted().consents as Record<string, unknown>[];
    expect(entry.version).toBe("sha256:0123456789abcdef01234567");
  });
});

// ---------------------------------------------------------------------------
// I9d-Y2b: osobne pole zgody na pomiar - deklaracja, nie zgoda
// ---------------------------------------------------------------------------

describe("osobne pole pomiaru (I9d-Y2b)", () => {
  const SUB_ID = "5a5a5a5a-0000-4000-8000-00000000a001";
  const NEWSLETTER = newsletterConsentPayload(resolveNewsletterConsent(null, "pl"), "pl");

  /** Ładunek formularza z zaznaczonym polem pomiaru (kształt z frontu). */
  function declared(lang: "pl" | "en" = "pl") {
    return input({
      language: lang,
      consents: [
        newsletterConsentPayload(resolveNewsletterConsent(null, lang), lang),
        measurementConsentPayload(lang),
      ],
    });
  }

  function measurementCalls() {
    return h.rpc.mock.calls.filter((c) => c[0] === "newsletter_measurement_request_signup");
  }

  /** Wariant bez double opt-in: upsert oddaje id zapisanego wiersza. */
  function singleOptIn(upsertResult: SupabaseResult = ok({ id: SUB_ID })): void {
    db.setResponse(SETTINGS, ok(settings({ double_opt_in: false })));
    db.setResponse(SUBSCRIBERS, (chain) => (chain.has("upsert") ? upsertResult : ok(null)));
  }

  it("limit pozycji = wspólna stała `CONSENT_ENTRIES_MAX` (12 przechodzi, 13 nie)", async () => {
    const entries = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ key: `zgoda-${i}`, text: `Treść ${i}` }));
    expect(CONSENT_ENTRIES_MAX).toBe(12);
    await expect(
      subscribeToNewsletter({ data: input({ consents: entries(CONSENT_ENTRIES_MAX) }) }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      subscribeToNewsletter({ data: input({ consents: entries(CONSENT_ENTRIES_MAX + 1) }) }),
    ).rejects.toThrow();
  });

  it("deklaracja ląduje w `consents` subskrybenta w postaci rozpoznawanej przez SQL", async () => {
    await subscribeToNewsletter({ data: declared() });

    const consents = upserted().consents as Record<string, unknown>[];
    expect(consents.map((e) => e.key)).toEqual(["newsletter", "email_measurement_declared"]);
    expect(consents[1]).toMatchObject({
      text: measurementConsentHtml("pl"),
      version: EMAIL_MEASUREMENT_CONSENT_VERSION,
      given: true,
      lang: "pl",
    });
    // Format chwili odbioru = wyrażenie z `_newsletter_measurement_declared_at`.
    expect(String(consents[1].received_at)).toMatch(
      /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z$/,
    );
  });

  it("ładunek z `signupNewsletterSubscription({ measurement: true })` przechodzi przez serwer bez strat", async () => {
    const payload = signupNewsletterSubscription({
      email: "nowy@example.test",
      lang: "en",
      source: "auth_form",
      consent: resolveNewsletterConsent(null, "en"),
      measurement: true,
    });
    await subscribeToNewsletter({ data: payload });

    const consents = upserted().consents as Record<string, unknown>[];
    expect(consents.map((e) => e.key)).toEqual(["newsletter", "email_measurement_declared"]);
    expect(consents[1].text).toBe(measurementConsentHtml("en"));
  });

  it("treść deklaracji bez znaczników jest przepisana na HTML dopasowanego języka (postać SQL)", async () => {
    await subscribeToNewsletter({
      data: input({
        consents: [
          NEWSLETTER,
          {
            key: "email_measurement_declared",
            text: measurementConsentPlain("en"),
            version: EMAIL_MEASUREMENT_CONSENT_VERSION,
            given: true,
            lang: "pl",
          },
        ],
      }),
    });
    const consents = upserted().consents as Record<string, unknown>[];
    expect(consents[1]).toMatchObject({ text: measurementConsentHtml("en"), lang: "en" });
  });

  it("klucz zgody `email_measurement` z formularza znika ZAWSZE (także treść/wersja (a) starej paczki)", async () => {
    await subscribeToNewsletter({
      data: input({
        consents: [
          NEWSLETTER,
          {
            key: "email_measurement",
            text: measurementConsentHtml("pl"),
            version: EMAIL_MEASUREMENT_CONSENT_VERSION,
            given: true,
          },
          {
            key: " Email_Measurement ",
            text: "Zgoda (a)",
            version: NEWSLETTER_CONSENT_VERSION_BUNDLED,
            given: true,
          },
        ],
      }),
    });
    const consents = upserted().consents as Record<string, unknown>[];
    expect(consents.map((e) => e.key)).toEqual(["newsletter"]);
  });

  it("deklaracja bez zgody na newsletter, z obcą treścią albo wersją (a) jest usuwana", async () => {
    const cases = [
      [measurementConsentPayload("pl")],
      [NEWSLETTER, { ...measurementConsentPayload("pl"), text: "Zgadzam się na wszystko" }],
      [
        NEWSLETTER,
        { ...measurementConsentPayload("pl"), version: NEWSLETTER_CONSENT_VERSION_BUNDLED },
      ],
      [NEWSLETTER, { ...measurementConsentPayload("pl"), given: false }],
    ];
    for (const consents of cases) {
      db.reset();
      defaultDb();
      await subscribeToNewsletter({ data: input({ consents }) });
      const saved = upserted().consents as Record<string, unknown>[];
      expect(saved.map((e) => e.key)).not.toContain("email_measurement_declared");
    }
  });

  it("double opt-in: notka w mailu TYLKO przy deklaracji; bez prośby (pyta strona DOI)", async () => {
    process.env.LOVABLE_API_KEY = "lov";
    process.env.RESEND_API_KEY = "re";

    await subscribeToNewsletter({ data: declared() });
    expect(String(sentMail().html)).toContain(MEASUREMENT_DOI_MAIL_NOTE.pl);
    expect(measurementCalls()).toHaveLength(0);

    fetchMock.mockClear();
    await subscribeToNewsletter({ data: input({ consents: [NEWSLETTER] }) });
    const plain = String(sentMail().html);
    expect(plain).toContain("/newsletter/confirm?token=");
    expect(plain).not.toContain(MEASUREMENT_DOI_MAIL_NOTE.pl);
    expect(plain).not.toMatch(/pomiar/i);
    // Bez zaznaczonego pola - bez sekretu skrzynki w linku.
    expect(plain).not.toMatch(/[?&]m=/);
  });

  it("double opt-in z deklaracją: link niesie SEKRET SKRZYNKI związany z wierszem i adresem (I9d-Y2b R1)", async () => {
    process.env.LOVABLE_API_KEY = "lov";
    process.env.RESEND_API_KEY = "re";

    await subscribeToNewsletter({ data: declared() });

    const html = String(sentMail().html);
    const link = /\/newsletter\/confirm\?token=([0-9a-f]{64})&amp;m=(d[0-9a-f]{72})/.exec(html);
    expect(link).not.toBeNull();
    // Token DOI w linku = token zapisany w wierszu; sekret - podpis tego
    // wiersza i adresu (sprawdza go trasa potwierdzenia).
    expect(link?.[1]).toBe(upserted().confirmation_token);
    expect(
      verifyDoiMeasurementToken(link?.[2], {
        subscriberId: PENDING_ID,
        email: "nowy@example.test",
      }),
    ).toMatchObject({ ok: true });
    expect(
      verifyDoiMeasurementToken(link?.[2], {
        subscriberId: PENDING_ID,
        email: "inny@example.test",
      }),
    ).toEqual({ ok: false, reason: "invalid" });
    // Odczyt wiersza po upsercie oddaje id (sekret) i token wypisu.
    expect(
      db.chainsFor(SUBSCRIBERS).some((c) => c.argsOf("select")?.[0] === "id, unsubscribe_token"),
    ).toBe(true);
  });

  it("double opt-in z deklaracją, ale bez id wiersza: mail bez sekretu i bez notki (fail-closed), zapis bez zmian", async () => {
    process.env.LOVABLE_API_KEY = "lov";
    process.env.RESEND_API_KEY = "re";
    db.setResponse(SUBSCRIBERS, (chain) => (chain.has("upsert") ? ok(null) : ok(null)));

    const res = await subscribeToNewsletter({ data: declared() });

    expect(res).toMatchObject({ ok: true, status: "pending", emailSent: true });
    const html = String(sentMail().html);
    expect(html).not.toMatch(/[?&;]m=/);
    expect(html).not.toContain(MEASUREMENT_DOI_MAIL_NOTE.pl);
    expect(errorSpy).toHaveBeenCalledWith(
      "[newsletter] measurement secret skipped: subscriber id missing",
    );
  });

  it("notka DOI w języku zapisu (EN)", async () => {
    process.env.LOVABLE_API_KEY = "lov";
    process.env.RESEND_API_KEY = "re";

    await subscribeToNewsletter({ data: declared("en") });

    expect(String(sentMail().html)).toContain(MEASUREMENT_DOI_MAIL_NOTE.en);
    expect(String(sentMail().html)).not.toContain(MEASUREMENT_DOI_MAIL_NOTE.pl);
  });

  it("bez double opt-in: upsert oddaje id, a baza zakłada prośbę dla TEGO subskrybenta", async () => {
    singleOptIn();
    h.rpc.mockImplementation(async (name: string) =>
      name === "newsletter_measurement_request_signup"
        ? { data: { result: "requested" }, error: null }
        : { data: [], error: null },
    );

    const res = await subscribeToNewsletter({ data: declared() });

    expect(res).toEqual({ ok: true, status: "subscribed" });
    const chain = db.chainsFor(SUBSCRIBERS).find((c) => c.has("upsert"));
    expect(chain?.argsOf("select")).toEqual(["id"]);
    expect(measurementCalls()).toEqual([
      ["newsletter_measurement_request_signup", { p_subscriber: SUB_ID }],
    ]);
  });

  it("bez double opt-in i bez zaznaczonego pola - żadnej prośby", async () => {
    singleOptIn();
    await subscribeToNewsletter({ data: input({ consents: [NEWSLETTER] }) });
    expect(measurementCalls()).toHaveLength(0);
  });

  it("awaria prośby (błąd, wyjątek, brak id) nie psuje zapisu ani powitania; log bez adresu", async () => {
    singleOptIn();
    h.rpc.mockImplementation(async (name: string) =>
      name === "newsletter_measurement_request_signup"
        ? { data: null, error: { message: "function does not exist" } }
        : { data: [], error: null },
    );
    expect(await subscribeToNewsletter({ data: declared() })).toEqual({
      ok: true,
      status: "subscribed",
    });

    h.rpc.mockImplementation(async (name: string) => {
      if (name === "newsletter_measurement_request_signup") throw new Error("rpc padło");
      return { data: [], error: null };
    });
    expect(await subscribeToNewsletter({ data: declared() })).toEqual({
      ok: true,
      status: "subscribed",
    });

    singleOptIn(ok(null));
    h.rpc.mockResolvedValue({ data: [], error: null });
    expect(await subscribeToNewsletter({ data: declared() })).toEqual({
      ok: true,
      status: "subscribed",
    });
    expect(h.sendTxEmail).toHaveBeenCalled();

    const logged = JSON.stringify(errorSpy.mock.calls);
    expect(logged).toContain("measurement request");
    expect(logged).not.toContain("nowy@example.test");
  });

  it("baza nie rozpoznała deklaracji (`none`) - ostrzeżenie w logu zamiast ciszy", async () => {
    singleOptIn();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    h.rpc.mockImplementation(async (name: string) =>
      name === "newsletter_measurement_request_signup"
        ? { data: { result: "none" }, error: null }
        : { data: [], error: null },
    );

    await subscribeToNewsletter({ data: declared() });

    expect(warnSpy).toHaveBeenCalledWith(
      "[newsletter] measurement declaration not recognised by the database",
    );
    warnSpy.mockRestore();
  });

  it("adres już zapisany (`exists`): deklaracja dopisana do `consents` i prośba, odpowiedź bez zmian", async () => {
    db.setResponse(SUBSCRIBERS, (chain) =>
      chain.has("update")
        ? ok(null)
        : ok({
            id: SUB_ID,
            status: "subscribed",
            consents: [
              { key: "newsletter", text: "dawna zgoda", received_at: "2026-01-01T00:00:00.000Z" },
              {
                key: "Email_Measurement_Declared",
                text: measurementConsentHtml("pl"),
                received_at: "2026-02-01T00:00:00.000Z",
              },
            ],
          }),
    );

    const res = await subscribeToNewsletter({ data: declared() });

    expect(res).toEqual({ ok: true, status: "exists" });
    expect(db.chainsFor(SUBSCRIBERS).some((c) => c.has("upsert"))).toBe(false);
    const update = db.chainsFor(SUBSCRIBERS).find((c) => c.has("update"));
    const next = (update?.argsOf("update")?.[0] as { consents: Record<string, unknown>[] })
      .consents;
    // Stara deklaracja zastąpiona (tablica nie rośnie przy ponownych zapisach).
    expect(next.map((e) => e.key)).toEqual(["newsletter", "email_measurement_declared"]);
    expect(next[0].text).toBe("dawna zgoda");
    expect(next[1]).toMatchObject({ text: measurementConsentHtml("pl") });
    expect(next[1].received_at).not.toBe("2026-02-01T00:00:00.000Z");
    const eqs = update?.calls.filter((c) => c.method === "eq").map((c) => c.args);
    expect(eqs).toEqual([
      ["id", SUB_ID],
      ["tenant_id", TENANT],
    ]);
    expect(measurementCalls()).toEqual([
      ["newsletter_measurement_request_signup", { p_subscriber: SUB_ID }],
    ]);
    // Zaangażowanie dalej liczone jak dotąd.
    expect(h.rpc.mock.calls.some((c) => c[0] === "newsletter_engagement_touch")).toBe(true);
  });

  it("adres już zapisany: limity nadużyć PRZED zapisem deklaracji (regresje-r1-3) - odmowa bez zapisu i bez prośby", async () => {
    db.setResponse(SUBSCRIBERS, (chain) =>
      chain.has("update") ? ok(null) : ok({ id: SUB_ID, status: "subscribed", consents: [] }),
    );
    h.rateLimit.mockResolvedValueOnce(false);

    const limited = await subscribeToNewsletter({ data: declared() });

    expect(limited).toEqual({ ok: false, error: "rate_limited" });
    expect(db.chainsFor(SUBSCRIBERS).some((c) => c.has("update"))).toBe(false);
    expect(measurementCalls()).toHaveLength(0);
    expect(h.rpc.mock.calls.some((c) => c[0] === "newsletter_engagement_touch")).toBe(false);
    // Limit odbiorcy też obowiązuje gałąź „już zapisany".
    h.rateLimit.mockClear();
    h.rateLimit.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    expect(await subscribeToNewsletter({ data: declared() })).toEqual({
      ok: false,
      error: "rate_limited",
    });
    expect(h.rateLimit.mock.calls.map((c) => c[0].scope)).toEqual([
      "newsletter.subscribe",
      "newsletter.recipient",
    ]);
    expect(measurementCalls()).toHaveLength(0);
  });

  it("adres już zapisany bez zaznaczonego pola: bez zapisu `consents` i bez prośby", async () => {
    db.setResponse(SUBSCRIBERS, (chain) =>
      chain.has("upsert") ? ok(null) : ok({ id: SUB_ID, status: "subscribed", consents: [] }),
    );

    await subscribeToNewsletter({ data: input({ consents: [NEWSLETTER] }) });

    expect(db.chainsFor(SUBSCRIBERS).some((c) => c.has("update"))).toBe(false);
    expect(measurementCalls()).toHaveLength(0);
  });

  it("awaria zapisu deklaracji u zapisanego adresu: bez prośby, odpowiedź `exists`", async () => {
    db.setResponse(SUBSCRIBERS, (chain) =>
      chain.has("update")
        ? fail("update locked")
        : ok({ id: SUB_ID, status: "subscribed", consents: [] }),
    );

    expect(await subscribeToNewsletter({ data: declared() })).toEqual({
      ok: true,
      status: "exists",
    });
    expect(measurementCalls()).toHaveLength(0);
  });
});
