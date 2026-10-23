// Publiczny endpoint linków pomiaru otwarć i kliknięć (I9d-Y2): „Nie mierz
// moich otwarć i kliknięć" i „Zgadzam się na pomiar".
//
// RZECZY, KTÓRE MOGĄ SIĘ TU ZEPSUĆ, I ŻADNA NIE JEST WIDOCZNA W UI:
//   1. GET MUTUJE. Skaner linków w bramce pocztowej wykonuje GET na każdym
//      adresie z maila - zgoda albo wycofanie na GET działałyby za ludzi,
//      którzy maila nie otworzyli. Zapis WYŁĄCZNIE na POST.
//   2. TOKEN ZMIENIA AKCJĘ. Rodzaj akcji wynika z podpisu, nie z parametru:
//      token wycofania nigdy nie udziela zgody.
//   3. CICHY SUKCES PRZY AWARII. Błąd bazy = 500 - osoba, która wyłącza
//      pomiar, musi wiedzieć, że decyzja nie została zapisana.
//   4. LIMITER POMINIĘTY. Publiczny zapis bez auth - limit per IP przed RPC.
//   5. WYCIEK DANYCH. Odpowiedź nie niesie adresu ani najemcy.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => {
  const state = {
    rpcCalls: [] as Array<{ fn: string; args: Record<string, unknown> }>,
    rpcError: null as { message: string } | null,
    rpcThrows: false,
    /** Wynik nadpisany per RPC. */
    results: {} as Record<string, unknown>,
    rateLimitCalls: [] as Array<{ scope: string; subjectId: string; max: number }>,
    rateLimitAllows: true,
  };
  const supabaseAdmin = {
    async rpc(fn: string, args: Record<string, unknown>) {
      state.rpcCalls.push({ fn, args });
      if (state.rpcThrows) throw new Error("connection reset");
      if (state.rpcError) return { data: null, error: state.rpcError };
      return { data: state.results[fn] ?? null, error: null };
    },
  };
  return { state, supabaseAdmin };
});

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: db.supabaseAdmin }));
vi.mock("@/lib/server/rate-limit.server", () => ({
  rateLimit: async (options: { scope: string; subjectId: string; max: number }) => {
    db.state.rateLimitCalls.push({
      scope: options.scope,
      subjectId: options.subjectId,
      max: options.max,
    });
    return db.state.rateLimitAllows;
  },
}));

import { Route } from "./api.public.newsletter.measurement";
import {
  signMeasurementConfirmToken,
  signMeasurementWithdrawToken,
} from "@/lib/privacy/measurementToken.server";
import { signNewsletterKeepToken } from "@/lib/privacy/newsletterKeepToken.server";
import { measurementPromptStateOf } from "@/lib/privacy/measurement";

const SUBSCRIBER = "6f9e6f6e-0000-4000-8000-0000000000b1";
const LEAD = "7b0c4f2e-1d3a-4c5b-9e8f-0a1b2c3d4e5f";
const NONCE = "1b2c3d4e-0000-4000-8000-00000000c0de";
const ENDPOINT = "https://nes.example/api/public/newsletter/measurement";

function handlers(): {
  GET: (ctx: { request: Request }) => Promise<Response>;
  POST: (ctx: { request: Request }) => Promise<Response>;
} {
  const options = (Route as unknown as { options: { server: { handlers: unknown } } }).options;
  return options.server.handlers as ReturnType<typeof handlers>;
}

const withdrawSub = () =>
  signMeasurementWithdrawToken({ kind: "subscriber", subscriberId: SUBSCRIBER });
const withdrawLead = () => signMeasurementWithdrawToken({ kind: "lead", leadId: LEAD });
const confirm = (expiresAt = new Date(Date.now() + 86_400_000)) =>
  signMeasurementConfirmToken({ subscriberId: SUBSCRIBER, nonce: NONCE, expiresAt });

function get(query: string, accept = "application/json"): { request: Request } {
  return { request: new Request(`${ENDPOINT}${query}`, { headers: { accept } }) };
}

function post(body: unknown, headers: Record<string, string> = {}): { request: Request } {
  return {
    request: new Request(ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "cf-connecting-ip": "203.0.113.7",
        "user-agent": "Przeglądarka/1.0",
        ...headers,
      },
      body: JSON.stringify(body),
    }),
  };
}

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", "sekret-testowy");
  const { state } = db;
  state.rpcCalls = [];
  state.rpcError = null;
  state.rpcThrows = false;
  state.results = {
    email_measurement_state: {
      result: "ok",
      consent: true,
      measured: true,
      enabled: true,
      tenant_id: "t1",
      lang: "pl",
    },
    email_measurement_withdraw: { result: "withdrawn", tenant_id: "t1", lang: "pl" },
    newsletter_measurement_confirm: { result: "confirmed", tenant_id: "t1", lang: "pl" },
  };
  state.rateLimitCalls = [];
  state.rateLimitAllows = true;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("GET nigdy nie mutuje", () => {
  it("przeglądarka: 303 na stronę, token, język i kanał przechodzą, bez bazy", async () => {
    const value = withdrawSub();
    const res = await handlers().GET(
      get(`?token=${value}&lang=EN-gb&via=preferences`, "text/html"),
    );
    expect(res.status).toBe(303);
    const target = new URL(res.headers.get("location") ?? "");
    expect(target.pathname).toBe("/newsletter/measurement");
    expect(target.searchParams.get("token")).toBe(value);
    expect(target.searchParams.get("lang")).toBe("en");
    expect(target.searchParams.get("via")).toBe("preferences");
    expect(db.state.rpcCalls).toEqual([]);
  });

  it("nieobsługiwany język i kanał nie przechodzą dalej", async () => {
    const res = await handlers().GET(
      get(`?token=${withdrawSub()}&lang=<script>&via=account`, "text/html"),
    );
    const target = new URL(res.headers.get("location") ?? "");
    expect(target.searchParams.has("lang")).toBe(false);
    expect(target.searchParams.has("via")).toBe(false);
  });

  it("fetch wycofania: odczyt stanu zgody (bez zapisu), podmiot z tokenu", async () => {
    const res = await handlers().GET(get(`?token=${withdrawLead()}`));
    expect(res.status).toBe(200);
    // Stara baza bez pola `refused` - zakładamy odmowę (zachowanie jak dotąd).
    expect(await res.json()).toEqual({
      ok: true,
      action: "withdraw",
      consent: true,
      refused: true,
    });
    expect(db.state.rpcCalls).toEqual([
      { fn: "email_measurement_state", args: { p_subscriber: null, p_lead: LEAD } },
    ]);
    expect(db.state.rpcCalls.map((c) => c.fn)).not.toContain("email_measurement_withdraw");
    expect(db.state.rateLimitCalls).toEqual([]);
  });

  it("fetch wycofania bez zgody: `refused` z bazy rozróżnia „odmowa zapisana” od „zapisz odmowę” (I9d-Y2b R1)", async () => {
    db.state.results.email_measurement_state = { result: "ok", consent: false, refused: true };
    const refused = await handlers().GET(get(`?token=${withdrawSub()}`));
    const refusedBody = await refused.json();
    expect(refusedBody).toEqual({ ok: true, action: "withdraw", consent: false, refused: true });
    expect(measurementPromptStateOf(200, refusedBody)).toBe("alreadyOff");

    db.state.results.email_measurement_state = { result: "ok", consent: false, refused: false };
    const open = await handlers().GET(get(`?token=${withdrawSub()}`));
    const openBody = await open.json();
    expect(openBody).toEqual({ ok: true, action: "withdraw", consent: false, refused: false });
    // Przycisk zostaje: odmowa osoby bez zgody trafi do rejestru (wyklucza z próśb).
    expect(measurementPromptStateOf(200, openBody)).toBe("confirmWithdraw");
  });

  it("fetch wycofania: podmiot usunięty -> 404; awaria odczytu -> przycisk jak zwykle", async () => {
    db.state.results.email_measurement_state = { result: "gone" };
    const gone = await handlers().GET(get(`?token=${withdrawSub()}`));
    expect(gone.status).toBe(404);
    db.state.rpcThrows = true;
    const failed = await handlers().GET(get(`?token=${withdrawSub()}`));
    expect(failed.status).toBe(200);
    expect(await failed.json()).toEqual({ ok: true, action: "withdraw" });
  });

  it("fetch zgody: ważny token -> ok z językiem SUBSKRYBENTA, bez zapisu (nonce zużywa dopiero POST)", async () => {
    db.state.results.email_measurement_state = { result: "ok", consent: false, lang: "en" };
    const res = await handlers().GET(get(`?token=${confirm()}&lang=pl`));
    expect(res.status).toBe(200);
    // Język treści zgody = język zapisu w `_email_measurement_grant`
    // (wiersz subskrybenta), nie `lang` z adresu (I9d-Y2b, R1.19).
    expect(await res.json()).toEqual({ ok: true, action: "confirm", lang: "en" });
    expect(db.state.rpcCalls).toEqual([
      { fn: "email_measurement_state", args: { p_subscriber: SUBSCRIBER, p_lead: null } },
    ]);
    expect(db.state.rpcCalls.map((c) => c.fn)).not.toContain("newsletter_measurement_confirm");
    expect(db.state.rateLimitCalls).toEqual([]);
  });

  it("fetch zgody: język spoza pl/en z bazy -> reguła `consentLangOf` (pl)", async () => {
    db.state.results.email_measurement_state = { result: "ok", consent: false, lang: "de" };
    const res = await handlers().GET(get(`?token=${confirm()}`));
    expect(await res.json()).toEqual({ ok: true, action: "confirm", lang: "pl" });
  });

  it("fetch zgody: subskrybent usunięty -> 404; awaria odczytu -> 500 bez języka (strona: błąd z ponowieniem, bez przycisku)", async () => {
    db.state.results.email_measurement_state = { result: "gone" };
    const gone = await handlers().GET(get(`?token=${confirm()}`));
    expect(gone.status).toBe(404);
    expect(await gone.json()).toEqual({ ok: false, error: "not_found" });

    db.state.rpcThrows = true;
    const thrown = await handlers().GET(get(`?token=${confirm()}`));
    expect(thrown.status).toBe(500);
    const thrownBody = (await thrown.json()) as Record<string, unknown>;
    expect(thrownBody).toEqual({ ok: false, error: "state_failed" });
    expect(thrownBody).not.toHaveProperty("lang");

    db.state.rpcThrows = false;
    db.state.rpcError = { message: 'relation "newsletter_subscribers" does not exist' };
    const failed = await handlers().GET(get(`?token=${confirm()}`));
    expect(failed.status).toBe(500);
    expect(JSON.stringify(await failed.json())).not.toContain("newsletter_subscribers");

    db.state.rpcError = null;
    db.state.results.email_measurement_state = { unexpected: true };
    const shape = await handlers().GET(get(`?token=${confirm()}`));
    expect(shape.status).toBe(500);
  });

  it("wygasły -> 410, nieważny i obcy token -> 400 (bez bazy)", async () => {
    const expired = await handlers().GET(get(`?token=${confirm(new Date(Date.now() - 1000))}`));
    expect(expired.status).toBe(410);
    expect(await expired.json()).toEqual({ ok: false, error: "expired" });
    const keep = signNewsletterKeepToken({
      subscriberId: SUBSCRIBER,
      nonce: NONCE,
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    for (const value of ["ws123", keep]) {
      const invalid = await handlers().GET(get(`?token=${value}`));
      expect(invalid.status).toBe(400);
      expect(await invalid.json()).toEqual({ ok: false, error: "invalid_token" });
    }
    expect(db.state.rpcCalls).toEqual([]);
  });
});

describe("POST wycofania pomiaru", () => {
  it("subskrybent: RPC z podmiotem, kanałem, IP i UA; powtórka `already`", async () => {
    const first = await handlers().POST(post({ token: withdrawSub() }));
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ ok: true, action: "withdraw" });
    expect(db.state.rpcCalls).toEqual([
      {
        fn: "email_measurement_withdraw",
        args: {
          p_subscriber: SUBSCRIBER,
          p_lead: null,
          p_channel: "email_footer",
          p_ip: "203.0.113.7",
          p_user_agent: "Przeglądarka/1.0",
        },
      },
    ]);
    db.state.results.email_measurement_withdraw = { result: "already" };
    const second = await handlers().POST(post({ token: withdrawSub() }));
    expect(await second.json()).toEqual({ ok: true, action: "withdraw", already: true });
  });

  it("kontakt CRM z maila ścieżki; kanał preferencji z ciała, nieznany = stopka", async () => {
    await handlers().POST(post({ token: withdrawLead(), channel: "preferences" }));
    expect(db.state.rpcCalls[0].args).toMatchObject({
      p_subscriber: null,
      p_lead: LEAD,
      p_channel: "preferences",
    });
    await handlers().POST(post({ token: withdrawLead(), channel: "account" }));
    expect(db.state.rpcCalls[1].args.p_channel).toBe("email_footer");
  });

  it("odpowiedź nie ujawnia adresu ani najemcy", async () => {
    const res = await handlers().POST(post({ token: withdrawSub() }));
    const body = JSON.stringify(await res.json());
    expect(body).not.toContain("t1");
    expect(body).not.toContain("@");
  });

  it("formularz i token w adresie też działają", async () => {
    const res = await handlers().POST({
      request: new Request(`${ENDPOINT}?token=${withdrawSub()}&via=preferences`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "",
      }),
    });
    expect(await res.json()).toEqual({ ok: true, action: "withdraw" });
    expect(db.state.rpcCalls[0].args.p_channel).toBe("preferences");
  });

  it("podmiot usunięty -> 404", async () => {
    db.state.results.email_measurement_withdraw = { result: "gone" };
    const res = await handlers().POST(post({ token: withdrawSub() }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false, error: "not_found" });
  });
});

describe("POST zgody na pomiar (prośba z panelu)", () => {
  it("RPC z subskrybentem, nonce, IP i UA; powtórka `already`", async () => {
    const res = await handlers().POST(post({ token: confirm() }));
    expect(await res.json()).toEqual({ ok: true, action: "confirm" });
    expect(db.state.rpcCalls).toEqual([
      {
        fn: "newsletter_measurement_confirm",
        args: {
          p_subscriber: SUBSCRIBER,
          p_nonce: NONCE,
          p_ip: "203.0.113.7",
          p_user_agent: "Przeglądarka/1.0",
        },
      },
    ]);
    db.state.results.newsletter_measurement_confirm = { result: "already" };
    const again = await handlers().POST(post({ token: confirm() }));
    expect(await again.json()).toEqual({ ok: true, action: "confirm", already: true });
  });

  it("token wycofania NIGDY nie woła zgody (akcja z podpisu)", async () => {
    await handlers().POST(post({ token: withdrawSub(), action: "confirm" }));
    expect(db.state.rpcCalls.map((c) => c.fn)).toEqual(["email_measurement_withdraw"]);
  });

  it("subskrybent wypisany (409), usunięty (404), zły nonce (400)", async () => {
    db.state.results.newsletter_measurement_confirm = { result: "inactive" };
    expect((await handlers().POST(post({ token: confirm() }))).status).toBe(409);
    db.state.results.newsletter_measurement_confirm = { result: "gone" };
    expect((await handlers().POST(post({ token: confirm() }))).status).toBe(404);
    db.state.results.newsletter_measurement_confirm = { result: "invalid" };
    const invalid = await handlers().POST(post({ token: confirm() }));
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ ok: false, error: "invalid_token" });
  });
});

describe("bramki zapisu", () => {
  it("wygasły i nieważny token nie dochodzą do limitera ani do bazy", async () => {
    const expired = await handlers().POST(post({ token: confirm(new Date(Date.now() - 1000)) }));
    expect(expired.status).toBe(410);
    const invalid = await handlers().POST(post({ token: "nie-token" }));
    expect(invalid.status).toBe(400);
    expect(db.state.rpcCalls).toEqual([]);
    expect(db.state.rateLimitCalls).toEqual([]);
  });

  it("limiter per IP przed bazą: odmowa -> 429 bez zapisu", async () => {
    db.state.rateLimitAllows = false;
    const res = await handlers().POST(post({ token: withdrawSub() }));
    expect(res.status).toBe(429);
    expect(db.state.rateLimitCalls).toEqual([
      { scope: "newsletter.measurement", subjectId: "203.0.113.7", max: 10 },
    ]);
    expect(db.state.rpcCalls).toEqual([]);
  });

  it("awaria bazy (błąd, zły kształt, wyjątek) -> 500 ze stałym kodem, nie cichy sukces", async () => {
    db.state.rpcError = { message: 'relation "crm_consent_log" does not exist' };
    const failed = await handlers().POST(post({ token: withdrawSub() }));
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ ok: false, error: "update_failed" });
    db.state.rpcError = null;
    db.state.results.newsletter_measurement_confirm = { result: "coś_nowego" };
    expect((await handlers().POST(post({ token: confirm() }))).status).toBe(500);
    db.state.rpcThrows = true;
    expect((await handlers().POST(post({ token: confirm() }))).status).toBe(500);
  });
});
