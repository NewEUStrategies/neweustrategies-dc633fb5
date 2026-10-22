// Publiczny endpoint linku „Chcę dalej otrzymywać" (wygaszanie, I9d-Y1).
//
// RZECZY, KTÓRE MOGĄ SIĘ TU ZEPSUĆ, I ŻADNA NIE JEST WIDOCZNA W UI:
//   1. GET MUTUJE. Bramki pocztowe i podglądy linków wykonują GET na każdym
//      adresie z maila - gdyby GET potwierdzał, skaner odnawiałby zgodę za
//      ludzi, którzy maila nie otworzyli. Mutacja WYŁĄCZNIE na POST.
//   2. TOKEN WIELOKROTNY. Link jest jednorazowy - drugi POST z tym samym
//      tokenem to `already` (nonce cyklu znika w bazie przy pierwszym użyciu).
//   3. WYGASŁY LINK DOCHODZI DO BAZY. Termin w podpisie odcina go przed RPC.
//   4. CICHY SUKCES PRZY AWARII. Błąd bazy = 500: osoba widzi błąd i ponawia,
//      zamiast wierzyć, że została na liście, i po terminie zostać usunięta.
//   5. LIMITER POMINIĘTY. Publiczny zapis bez auth - limit per IP przed RPC.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => {
  const state = {
    /** Nonce cykli w „bazie" - pierwszy POST je kasuje (jednorazowość). */
    cycles: new Set<string>(),
    rpcCalls: [] as Array<{ fn: string; args: Record<string, unknown> }>,
    rpcError: null as { message: string } | null,
    rpcThrows: false,
    /** Wynik nadpisany (inactive, gone). */
    forcedResult: null as string | null,
    rateLimitCalls: [] as Array<{ scope: string; subjectId: string; max: number }>,
    rateLimitAllows: true,
  };
  const supabaseAdmin = {
    async rpc(fn: string, args: Record<string, unknown>) {
      state.rpcCalls.push({ fn, args });
      if (state.rpcThrows) throw new Error("connection reset");
      if (state.rpcError) return { data: null, error: state.rpcError };
      if (state.forcedResult) return { data: { result: state.forcedResult }, error: null };
      const key = `${String(args.p_subscriber)}:${String(args.p_nonce)}`;
      if (!state.cycles.has(key)) return { data: { result: "already" }, error: null };
      state.cycles.delete(key);
      return { data: { result: "kept", tenant_id: "t1", lang: "pl" }, error: null };
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

import { Route } from "./api.public.newsletter.keep";
import { signNewsletterKeepToken } from "@/lib/privacy/newsletterKeepToken.server";

const SUBSCRIBER = "6f9e6f6e-0000-4000-8000-0000000000b1";
const NONCE = "1b2c3d4e-0000-4000-8000-00000000c0de";
const ENDPOINT = "https://nes.example/api/public/newsletter/keep";

function handlers(): {
  GET: (ctx: { request: Request }) => Promise<Response>;
  POST: (ctx: { request: Request }) => Promise<Response>;
} {
  const options = (Route as unknown as { options: { server: { handlers: unknown } } }).options;
  return options.server.handlers as ReturnType<typeof handlers>;
}

function token(expiresAt = new Date(Date.now() + 86_400_000)): string {
  return signNewsletterKeepToken({ subscriberId: SUBSCRIBER, nonce: NONCE, expiresAt });
}

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
        ...headers,
      },
      body: JSON.stringify(body),
    }),
  };
}

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", "sekret-testowy");
  const { state } = db;
  state.cycles = new Set([`${SUBSCRIBER}:${NONCE}`]);
  state.rpcCalls = [];
  state.rpcError = null;
  state.rpcThrows = false;
  state.forcedResult = null;
  state.rateLimitCalls = [];
  state.rateLimitAllows = true;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("GET nigdy nie mutuje", () => {
  it("przeglądarka: 303 na stronę z przyciskiem, token i język przechodzą, bez bazy", async () => {
    const value = token();
    const res = await handlers().GET(get(`?token=${value}&lang=EN-gb`, "text/html"));
    expect(res.status).toBe(303);
    const target = new URL(res.headers.get("location") ?? "");
    expect(target.pathname).toBe("/newsletter/keep");
    expect(target.searchParams.get("token")).toBe(value);
    expect(target.searchParams.get("lang")).toBe("en");
    expect(db.state.rpcCalls).toEqual([]);
  });

  it("nieobsługiwany język nie przechodzi dalej", async () => {
    const res = await handlers().GET(get(`?token=${token()}&lang=<script>`, "text/html"));
    expect(new URL(res.headers.get("location") ?? "").searchParams.has("lang")).toBe(false);
  });

  it("fetch strony: ważny token -> ok, BEZ wywołania bazy i limitera", async () => {
    const res = await handlers().GET(get(`?token=${token()}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(db.state.rpcCalls).toEqual([]);
    expect(db.state.rateLimitCalls).toEqual([]);
  });

  it("wygasły -> 410, nieważny -> 400 (bez bazy)", async () => {
    const expired = await handlers().GET(get(`?token=${token(new Date(Date.now() - 1000))}`));
    expect(expired.status).toBe(410);
    expect(await expired.json()).toEqual({ ok: false, error: "expired" });
    const invalid = await handlers().GET(get("?token=k123"));
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ ok: false, error: "invalid_token" });
    expect(db.state.rpcCalls).toEqual([]);
  });
});

describe("POST potwierdza - raz", () => {
  it("pierwszy POST resetuje licznik (RPC z subskrybentem i nonce), drugi to `already`", async () => {
    const value = token();
    const first = await handlers().POST(post({ token: value }));
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ ok: true });
    expect(db.state.rpcCalls).toEqual([
      { fn: "newsletter_sunset_keep", args: { p_subscriber: SUBSCRIBER, p_nonce: NONCE } },
    ]);
    const second = await handlers().POST(post({ token: value }));
    expect(await second.json()).toEqual({ ok: true, already: true });
  });

  it("odpowiedź nie ujawnia adresu ani najemcy", async () => {
    const res = await handlers().POST(post({ token: token() }));
    const body = JSON.stringify(await res.json());
    expect(body).not.toContain("t1");
    expect(body).not.toContain("@");
  });

  it("formularz i token w adresie też działają", async () => {
    const value = token();
    const res = await handlers().POST({
      request: new Request(`${ENDPOINT}?token=${value}`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "",
      }),
    });
    expect(await res.json()).toEqual({ ok: true });
  });

  it("wygasły i nieważny token nie dochodzą do limitera ani do bazy", async () => {
    const expired = await handlers().POST(post({ token: token(new Date(Date.now() - 1000)) }));
    expect(expired.status).toBe(410);
    const invalid = await handlers().POST(post({ token: "nie-token" }));
    expect(invalid.status).toBe(400);
    expect(db.state.rpcCalls).toEqual([]);
    expect(db.state.rateLimitCalls).toEqual([]);
  });

  it("limiter per IP przed bazą: odmowa -> 429 bez zapisu", async () => {
    db.state.rateLimitAllows = false;
    const res = await handlers().POST(post({ token: token() }));
    expect(res.status).toBe(429);
    expect(db.state.rateLimitCalls).toEqual([
      { scope: "newsletter.keep", subjectId: "203.0.113.7", max: 10 },
    ]);
    expect(db.state.rpcCalls).toEqual([]);
  });

  it("awaria bazy (błąd albo wyjątek) -> 500 ze stałym kodem, nie cichy sukces", async () => {
    db.state.rpcError = { message: 'relation "newsletter_sunset_requests" does not exist' };
    const failed = await handlers().POST(post({ token: token() }));
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ ok: false, error: "update_failed" });
    db.state.rpcError = null;
    db.state.rpcThrows = true;
    const thrown = await handlers().POST(post({ token: token() }));
    expect(thrown.status).toBe(500);
  });

  it("subskrybent wypisany (409) albo już usunięty (404)", async () => {
    db.state.forcedResult = "inactive";
    expect((await handlers().POST(post({ token: token() }))).status).toBe(409);
    db.state.forcedResult = "gone";
    const gone = await handlers().POST(post({ token: token() }));
    expect(gone.status).toBe(404);
    expect(await gone.json()).toEqual({ ok: false, error: "not_found" });
  });
});
