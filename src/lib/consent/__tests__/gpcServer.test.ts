// Kontrakt warstwy serwerowej GPC (transport sygnału do klienta).
//
// Dwie własności są tu krytyczne i nietrywialne:
//
//  A) `Vary: Sec-GPC` idzie na KAŻDY dokument HTML, także bez sygnału. Bez tego
//     cache pośredniczący mógłby podać dokument z `Set-Cookie: nes_gpc=1`
//     klientowi, który sygnału nie wysyła (i odwrotnie) - klamra przykleiłaby się
//     do losowej osoby.
//
//  B) `Set-Cookie` leci TYLKO gdy stan cookie != stan nagłówka. Bezwarunkowe
//     pisanie zabiłoby trafienia cache'a brzegowego, a brak kasowania utrwaliłby
//     opt-out po tym, jak użytkownik wyłączył GPC w przeglądarce.
//
// Odpowiedzi nie-HTML (JSON API, beacony, zasoby) nie są w ogóle dotykane.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GPC_COOKIE, GPC_HEADER } from "@/lib/consent/gpc";
import {
  applyGpcTransport,
  gpcCookieHeaderValue,
  gpcTransportHeaders,
  planGpcCookie,
  requestHasGpc,
  type GpcTransportRequest,
} from "@/lib/consent/gpc.server";
import { readGpc, resolveGpcForWrite } from "@/lib/consents.server";

function htmlResponse(headers: Record<string, string> = {}): Response {
  return new Response("<!doctype html><title>t</title>", {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", ...headers },
  });
}

/**
 * Żądanie zbudowane z gołej mapy nagłówków, NIE przez `new Request(...)`:
 * konstruktor Request implementuje listę nagłówków „zakazanych" z fetch speca,
 * a `Sec-GPC` (prefiks `Sec-`) i `Cookie` są na niej oba - przez konstruktor
 * ścieżki z sygnałem byłyby nietestowalne, bo nagłówki milcząco by wyparowały.
 * Dlatego `applyGpcTransport` przyjmuje zawężony `GpcTransportRequest`.
 */
function req(
  opts: { gpc?: boolean; cookie?: string; proto?: string; url?: string } = {},
): GpcTransportRequest {
  const map = new Map<string, string>();
  if (opts.gpc) map.set(GPC_HEADER, "1");
  if (opts.cookie) map.set("cookie", opts.cookie);
  if (opts.proto) map.set("x-forwarded-proto", opts.proto);
  return {
    url: opts.url ?? "https://neweuropeanstrategies.com/",
    headers: { get: (name: string) => map.get(name.toLowerCase()) ?? null },
  };
}

describe("requestHasGpc", () => {
  it("detects the header and ignores everything else", () => {
    expect(requestHasGpc(req({ gpc: true }))).toBe(true);
    expect(requestHasGpc(req())).toBe(false);
    expect(requestHasGpc(null)).toBe(false);
  });
});

describe("planGpcCookie", () => {
  it("writes the cookie on a fresh signal", () => {
    expect(planGpcCookie(true, false)).toBe("set");
  });

  it("does nothing when cookie and signal already agree", () => {
    expect(planGpcCookie(true, true)).toBeNull();
    expect(planGpcCookie(false, false)).toBeNull();
  });

  it("clears the cookie once the signal disappears", () => {
    expect(planGpcCookie(false, true)).toBe("clear");
  });
});

describe("gpcCookieHeaderValue", () => {
  it("sets a long-lived, Lax, path-scoped cookie and marks Secure on https", () => {
    const value = gpcCookieHeaderValue(true, true);
    expect(value).toContain(`${GPC_COOKIE}=1`);
    expect(value).toMatch(/Max-Age=\d+/);
    expect(value).toContain("Path=/");
    expect(value).toContain("SameSite=Lax");
    expect(value).toContain("Secure");
  });

  it("omits Secure on plain http (dev / preview must still work)", () => {
    expect(gpcCookieHeaderValue(true, false)).not.toContain("Secure");
  });

  it("clears with Max-Age=0 and an empty value", () => {
    const value = gpcCookieHeaderValue(false, true);
    expect(value).toContain(`${GPC_COOKIE}=;`);
    expect(value).toContain("Max-Age=0");
  });
});

describe("gpcTransportHeaders", () => {
  it("adds Vary: Sec-GPC even when no signal is present", () => {
    const headers = gpcTransportHeaders(req(), htmlResponse());
    expect(headers?.get("vary")).toBe("Sec-GPC");
    expect(headers?.getSetCookie()).toHaveLength(0);
  });

  it("appends to an existing Vary instead of overwriting it", () => {
    const vary = gpcTransportHeaders(req(), htmlResponse({ vary: "Accept-Language" }))?.get("vary");
    expect(vary).toContain("Accept-Language");
    expect(vary).toContain("Sec-GPC");
  });

  it("does not duplicate Vary when it is already declared", () => {
    const headers = gpcTransportHeaders(req(), htmlResponse({ vary: "Cookie, Sec-GPC" }));
    const tokens = (headers?.get("vary") ?? "").split(",").map((v) => v.trim().toLowerCase());
    expect(tokens.filter((v) => v === "sec-gpc")).toHaveLength(1);
  });

  it("mirrors a fresh Sec-GPC header into the transport cookie", () => {
    const cookies = gpcTransportHeaders(req({ gpc: true }), htmlResponse())?.getSetCookie() ?? [];
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toContain(`${GPC_COOKIE}=1`);
  });

  it("stays silent when the cookie already reflects the signal (cache-friendly)", () => {
    const headers = gpcTransportHeaders(
      req({ gpc: true, cookie: `${GPC_COOKIE}=1` }),
      htmlResponse(),
    );
    expect(headers?.getSetCookie()).toHaveLength(0);
  });

  it("clears a stale cookie when the browser stops sending the signal", () => {
    const cookies =
      gpcTransportHeaders(req({ cookie: `${GPC_COOKIE}=1` }), htmlResponse())?.getSetCookie() ?? [];
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toContain("Max-Age=0");
  });

  it("omits Secure when the proxy reports plain http", () => {
    const cookies =
      gpcTransportHeaders(
        req({ gpc: true, proto: "http", url: "http://localhost:3000/" }),
        htmlResponse(),
      )?.getSetCookie() ?? [];
    expect(cookies[0]).not.toContain("Secure");
  });

  it("returns null for non-HTML responses (nothing to transport)", () => {
    const json = new Response("{}", { headers: { "content-type": "application/json" } });
    expect(gpcTransportHeaders(req({ gpc: true }), json)).toBeNull();
  });
});

describe("kolejność middleware - Set-Cookie nie może wejść do cache'a", () => {
  /**
   * INWARIANT BEZPIECZEŃSTWA, nie kosmetyka. Odpowiedź wraca z wnętrza łańcucha
   * na zewnątrz, więc `gpcMiddleware` MUSI stać POWYŻEJ `documentCacheMiddleware`:
   * tylko wtedy `Set-Cookie: nes_gpc` jest doklejany PO odtworzeniu wpisu z NES
   * Edge Cache. Odwrotna kolejność wpuściłaby cookie do ZAPISANEGO dokumentu i
   * wpis rozgrzany przez osobę z sygnałem GPC ustawiałby opt-out każdemu
   * kolejnemu czytelnikowi tej ścieżki (albo, w drugą stronę, wpis bez cookie
   * zjadałby cudzy sygnał).
   *
   * Test jest statyczny (czyta `src/start.ts`), bo chodzi o KOLEJNOŚĆ w tablicy
   * `requestMiddleware` - reorder jest zmianą o jedną linię, niewidoczną w żadnym
   * teście behawioralnym, dopóki cache nie zacznie realnie trafiać.
   */
  it("gpcMiddleware stoi powyżej documentCacheMiddleware w requestMiddleware", () => {
    const source = readFileSync("src/start.ts", "utf8");
    const list = source.slice(
      source.indexOf("requestMiddleware: ["),
      source.indexOf("functionMiddleware:"),
    );
    expect(list, "nie znaleziono tablicy requestMiddleware w src/start.ts").toContain(
      "gpcMiddleware",
    );
    const gpcAt = list.indexOf("gpcMiddleware");
    const cacheAt = list.indexOf("documentCacheMiddleware");
    expect(cacheAt).toBeGreaterThan(-1);
    expect(
      gpcAt,
      "gpcMiddleware musi być PRZED documentCacheMiddleware - inaczej Set-Cookie wejdzie do wpisu cache",
    ).toBeLessThan(cacheAt);
  });
});

describe("resolveGpcForWrite - asymetria klient/serwer", () => {
  /** `Request`-podobny obiekt: konstruktor Request wycina `Sec-GPC` i `Cookie`. */
  const fakeRequest = (headers: Record<string, string>): Request =>
    ({
      headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    }) as unknown as Request;

  it("reads the signal from the Sec-GPC header", () => {
    expect(readGpc(fakeRequest({ [GPC_HEADER]: "1" }))).toBe(true);
  });

  it("falls back to the transport cookie (RPC calls carry no Sec-GPC)", () => {
    expect(readGpc(fakeRequest({ cookie: `${GPC_COOKIE}=1` }))).toBe(true);
  });

  it("reports no signal when neither carrier says anything", () => {
    expect(readGpc(fakeRequest({}))).toBe(false);
    expect(readGpc(null)).toBe(false);
  });

  it("lets the client CONFIRM a signal the server cannot see (navigator only)", () => {
    expect(resolveGpcForWrite(fakeRequest({}), true)).toBe(true);
  });

  it("does NOT let the client hide a signal the server did see", () => {
    // Sedno fail-closed: deklaracja klienta to dane wejściowe, nie dowód.
    expect(resolveGpcForWrite(fakeRequest({ [GPC_HEADER]: "1" }), false)).toBe(true);
    expect(resolveGpcForWrite(fakeRequest({ cookie: `${GPC_COOKIE}=1` }), undefined)).toBe(true);
  });

  it("records no signal when neither side reports one", () => {
    expect(resolveGpcForWrite(fakeRequest({}), false)).toBe(false);
    expect(resolveGpcForWrite(fakeRequest({}), undefined)).toBe(false);
  });
});

describe("applyGpcTransport", () => {
  it("preserves status, body and pre-existing headers", async () => {
    const response = new Response("<!doctype html>body", {
      status: 203,
      statusText: "Non-Authoritative",
      headers: { "content-type": "text/html", "x-nes-cache": "HIT" },
    });
    const out = applyGpcTransport(req({ gpc: true }), response);
    expect(out.status).toBe(203);
    expect(out.headers.get("x-nes-cache")).toBe("HIT");
    expect(out.headers.get("vary")).toContain("Sec-GPC");
    expect(await out.text()).toBe("<!doctype html>body");
  });

  it("leaves non-HTML responses completely alone (identity preserved)", () => {
    const json = new Response("{}", { headers: { "content-type": "application/json" } });
    const out = applyGpcTransport(req({ gpc: true }), json);
    expect(out).toBe(json);
    expect(out.headers.get("vary")).toBeNull();
  });
});
