// Wypis jednym kliknięciem (RFC 8058 „one-click") - endpoint, który MUSI
// działać bezwarunkowo.
//
// Klient pocztowy (Gmail, Apple Mail) POST-uje tu formularz
// `List-Unsubscribe=One-Click` bez żadnej interakcji ze stroną, a wytyczne
// Google/Yahoo dla nadawców masowych wymagają, by taki wypis zadziałał w ciągu
// dwóch dni. Endpoint jest publiczny i BEZ LOGOWANIA - tokenem jest sam adres.
//
// Trzy rzeczy, których złamanie kosztuje reputację domeny albo prywatność:
//   1. odpowiedź NIE może zdradzać adresu spod tokenu (token ląduje w logach
//      proxy i w historii przeglądarki),
//   2. PONOWNE kliknięcie w ten sam link nie jest błędem - klient pocztowy
//      potrafi POST-ować one-click wielokrotnie,
//   3. token musi być odczytany z każdego z trzech miejsc, w których go
//      przysyłają różni klienci: query, formularz, JSON.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ok, supabaseFromStub } from "@/test/supabaseChain";
import { routeServerHandlers } from "@/test/routeHarness";

const h = vi.hoisted(() => ({ unsubscribeByToken: vi.fn() }));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: (t: string) => db.from(t) },
}));
vi.mock("@/lib/email/suppression.server", () => ({ unsubscribeByToken: h.unsubscribeByToken }));

import { Route } from "@/routes/email/unsubscribe";

const db = supabaseFromStub();
const TOKENS = "email_unsubscribe_tokens";
const SUBSCRIBERS = "newsletter_subscribers";

function handlers() {
  return routeServerHandlers(Route);
}

function get(query = "?token=tok-1"): Promise<Response> {
  return handlers().GET({
    request: new Request(`https://example.test/email/unsubscribe${query}`),
  });
}

function post(init: { query?: string; body?: string; contentType?: string }): Promise<Response> {
  const headers: Record<string, string> = {};
  if (init.contentType) headers["Content-Type"] = init.contentType;
  return handlers().POST({
    request: new Request(`https://example.test/email/unsubscribe${init.query ?? ""}`, {
      method: "POST",
      headers,
      body: init.body,
    }),
  });
}

let logSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  db.reset();
  db.setResponse(TOKENS, ok(null));
  db.setResponse(SUBSCRIBERS, ok(null));
  h.unsubscribeByToken.mockResolvedValue({
    ok: true,
    alreadyUnsubscribed: false,
    tenantId: "tenant-1",
  });
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  logSpy.mockRestore();
  errorSpy.mockRestore();
});

describe("GET - walidacja tokenu przed stroną potwierdzenia", () => {
  it("brak tokenu to 400", async () => {
    const res = await get("");

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "Token is required" });
  });

  it("ważny token pocztowy jest ważny", async () => {
    db.setResponse(TOKENS, ok({ used_at: null }));

    const res = await get();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ valid: true });
  });

  it("token już użyty mówi o tym wprost", async () => {
    db.setResponse(TOKENS, ok({ used_at: "2026-08-01T10:00:00Z" }));

    const res = await get();

    await expect(res.json()).resolves.toEqual({ valid: false, reason: "already_unsubscribed" });
    expect(res.status).toBe(200);
  });

  it("token subskrybenta newslettera jest długowieczny - samo istnienie wystarcza", async () => {
    db.setResponse(SUBSCRIBERS, ok({ status: "subscribed" }));

    const res = await get();

    await expect(res.json()).resolves.toEqual({ valid: true });
    expect(db.lastChain(SUBSCRIBERS)?.argsOf("eq")).toEqual(["unsubscribe_token", "tok-1"]);
  });

  it("subskrybent już wypisany nie jest błędem, tylko stanem", async () => {
    db.setResponse(SUBSCRIBERS, ok({ status: "unsubscribed" }));

    const res = await get();

    await expect(res.json()).resolves.toEqual({ valid: false, reason: "already_unsubscribed" });
    expect(res.status).toBe(200);
  });

  it("token nieznany nigdzie to 404", async () => {
    const res = await get();

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "Invalid or expired token" });
  });

  it("odpowiedź NIGDY nie zdradza adresu spod tokenu", async () => {
    db.setResponse(TOKENS, ok({ used_at: null, email: "sekret@example.test" }));

    const res = await get();
    const body = await res.text();

    expect(body).not.toContain("sekret@example.test");
    expect(body).not.toContain("@");
  });

  it("odpowiedzi nie wolno cache'ować", async () => {
    db.setResponse(TOKENS, ok({ used_at: null }));

    const res = await get();

    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-type")).toContain("application/json");
  });
});

describe("POST - skąd czytamy token", () => {
  it("z parametru zapytania (one-click Gmaila)", async () => {
    const res = await post({
      query: "?token=tok-query",
      contentType: "application/x-www-form-urlencoded",
      body: "List-Unsubscribe=One-Click",
    });

    expect(res.status).toBe(200);
    expect(h.unsubscribeByToken.mock.calls[0]?.[1]).toBe("tok-query");
  });

  it("z pola formularza, gdy to NIE jest one-click", async () => {
    const res = await post({
      contentType: "application/x-www-form-urlencoded",
      body: "token=tok-form",
    });

    expect(res.status).toBe(200);
    expect(h.unsubscribeByToken.mock.calls[0]?.[1]).toBe("tok-form");
  });

  it("przy one-click pole formularza NIE nadpisuje tokenu z query", async () => {
    const res = await post({
      query: "?token=tok-query",
      contentType: "application/x-www-form-urlencoded",
      body: "List-Unsubscribe=One-Click&token=tok-podstawiony",
    });

    expect(res.status).toBe(200);
    expect(h.unsubscribeByToken.mock.calls[0]?.[1]).toBe("tok-query");
  });

  it("z ciała JSON (strona aplikacji)", async () => {
    const res = await post({
      contentType: "application/json",
      body: JSON.stringify({ token: "tok-json" }),
    });

    expect(res.status).toBe(200);
    expect(h.unsubscribeByToken.mock.calls[0]?.[1]).toBe("tok-json");
  });

  it("zepsuty JSON nie wywraca wypisu - zostaje token z query", async () => {
    const res = await post({
      query: "?token=tok-query",
      contentType: "application/json",
      body: "{to nie json",
    });

    expect(res.status).toBe(200);
    expect(h.unsubscribeByToken.mock.calls[0]?.[1]).toBe("tok-query");
  });

  it("JSON bez pola token schodzi na query", async () => {
    const res = await post({
      query: "?token=tok-query",
      contentType: "application/json",
      body: JSON.stringify({ inne: "pole" }),
    });

    expect(h.unsubscribeByToken.mock.calls[0]?.[1]).toBe("tok-query");
    expect(res.status).toBe(200);
  });

  it("brak tokenu wszędzie to 400, bez dotykania bazy", async () => {
    const res = await post({});

    expect(res.status).toBe(400);
    expect(h.unsubscribeByToken).not.toHaveBeenCalled();
  });
});

describe("POST - skutek wypisu", () => {
  it("udany wypis potwierdza sukces", async () => {
    const res = await post({ query: "?token=tok-1" });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ success: true });
  });

  it("PONOWNE kliknięcie to nadal sukces, nie błąd", async () => {
    h.unsubscribeByToken.mockResolvedValue({
      ok: true,
      alreadyUnsubscribed: true,
      tenantId: "tenant-1",
    });

    const res = await post({ query: "?token=tok-1" });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ success: true, reason: "already_unsubscribed" });
  });

  it.each(["unknown_token", "missing_token"])("token %s to 404", async (error) => {
    h.unsubscribeByToken.mockResolvedValue({ ok: false, error });

    const res = await post({ query: "?token=tok-1" });

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "Invalid or expired token" });
  });

  it("awaria bazy to 500 i wpis w logu błędów", async () => {
    h.unsubscribeByToken.mockResolvedValue({ ok: false, error: "db_error" });

    const res = await post({ query: "?token=tok-1" });

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: "Failed to process unsubscribe" });
    expect(errorSpy).toHaveBeenCalled();
  });

  it("log sukcesu NIE zawiera ani adresu, ani tokenu", async () => {
    await post({ query: "?token=tok-sekretny" });

    const logged = JSON.stringify(logSpy.mock.calls);
    expect(logged).not.toContain("tok-sekretny");
    expect(logged).toContain("tenant-1");
  });
});
