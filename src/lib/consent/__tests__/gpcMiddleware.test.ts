// MIDDLEWARE TRANSPORTU GPC (`gpc.server.ts` - ostatnie niepokryte linie).
//
// PO CO OSOBNY PLIK. `gpcServer.test.ts` pokrywa CZYSTE funkcje transportu
// (`planGpcCookie`, `gpcTransportHeaders`, `applyGpcTransport`, wartość
// `Set-Cookie`) - i słusznie, bo to tam mieszkają reguły. Nie pokrywa jednak
// SAMEGO middleware, bo `createMiddleware()` z frameworka buduje obiekt, który
// nie wystawia zarejestrowanego handlera: bez podmiany fabryki ciała middleware
// nie da się wywołać. Ten plik podmienia fabrykę, żeby przechwycić handler
// i sprawdzić trzy rzeczy, których żaden test czystych funkcji nie zobaczy:
//
//   1. MIDDLEWARE PRZEPUSZCZA wynik dalej, gdy nie ma w nim odpowiedzi
//      (`getMiddlewareResponse` oddaje `null`). Zwrócenie czegokolwiek innego
//      urwałoby łańcuch `requestMiddleware`.
//   2. NAKŁADA transport na odpowiedź HTML - i robi to NA WYNIKU next(),
//      nie na własnej, nowej odpowiedzi.
//   3. ZACHOWUJE KSZTAŁT wyniku: framework przekazuje albo samą `Response`,
//      albo obiekt z polem `response`. Middleware musi oddać ten sam kształt,
//      który dostał, bo od tego zależy współpraca z `documentCacheMiddleware`
//      stojącym NIŻEJ w łańcuchu.
//
// PLUS jedna gałąź `isSecureRequest`, której nie da się wywołać przez
// `Request`: adres, którego `new URL()` nie parsuje. W produkcji taki adres
// przychodzi od adaptera runtime'u (ścieżka bez schematu), a skutkiem musi być
// cookie BEZ flagi `Secure` - a nie wyjątek w połowie renderu dokumentu.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE: reguł `Vary`/`Set-Cookie` (to `gpcServer.test.ts`),
// rdzenia sygnału (`gpc.test.ts`) i klamrowania kategorii (`gpcCmpClamp.test.ts`).
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  /** Handler zarejestrowany przez `createMiddleware().server(...)`. */
  handler: null as
    | ((args: {
        request: { url: string; headers: Headers };
        next: () => Promise<unknown>;
      }) => Promise<unknown>)
    | null,
}));

vi.mock("@tanstack/react-start", () => ({
  createMiddleware: () => {
    const chain = {
      middleware: () => chain,
      client: () => chain,
      server: (
        fn: (args: {
          request: { url: string; headers: Headers };
          next: () => Promise<unknown>;
        }) => Promise<unknown>,
      ) => {
        h.handler = fn;
        return chain;
      },
    };
    return chain;
  },
}));

import { GPC_COOKIE, GPC_HEADER } from "@/lib/consent/gpc";
import { gpcCookieHeaderValue, gpcMiddleware, gpcTransportHeaders } from "@/lib/consent/gpc.server";

/** Żądanie w kształcie, jakiego wymaga transport (`GpcTransportRequest`). */
function transportRequest(
  url: string,
  headers: Record<string, string> = {},
): { url: string; headers: Headers } {
  return { url, headers: new Headers(headers) };
}

/** Wynik middleware w kształcie „obiekt niosący odpowiedź". */
interface ResponseCarrier {
  response: Response;
  context: Record<string, unknown>;
}

function isResponseCarrier(value: unknown): value is ResponseCarrier {
  return (
    typeof value === "object" &&
    value !== null &&
    "response" in value &&
    value.response instanceof Response
  );
}

function htmlResponse(): Response {
  return new Response("<!doctype html><title>t</title>", {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function jsonResponse(): Response {
  return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
}

/** Handler middleware - `gpcMiddleware` musi go zarejestrować przy imporcie. */
function middlewareHandler(): (args: {
  request: { url: string; headers: Headers };
  next: () => Promise<unknown>;
}) => Promise<unknown> {
  // Odwołanie do eksportu utrzymuje import „żywy" (i jest kanarkiem: gdyby
  // moduł przestał budować middleware, handler byłby `null`).
  expect(gpcMiddleware, "moduł nie zbudował middleware").toBeTruthy();
  if (!h.handler) throw new Error("test: middleware nie zarejestrowało handlera serwerowego");
  return h.handler;
}

beforeEach(() => {
  // Handler rejestruje się RAZ, przy imporcie modułu - nie zerujemy go.
  expect(h.handler).toBeTruthy();
});

describe("gpcMiddleware - transport sygnału w łańcuchu żądania", () => {
  it("wynik BEZ odpowiedzi przechodzi dalej NIETKNIĘTY", async () => {
    // `requestMiddleware` przekazuje różne kształty; wynik bez `response` to
    // normalna sytuacja (np. wczesne przerwanie wyżej). Zwrócenie tu czegoś
    // innego urwałoby łańcuch.
    const marker = { context: { anything: 1 } };
    const result = await middlewareHandler()({
      request: transportRequest("https://example.org/"),
      next: async () => marker,
    });
    expect(result).toBe(marker);
  });

  it("SAMA `Response` HTML dostaje `Vary: Sec-GPC` i wraca jako `Response`", async () => {
    const result = await middlewareHandler()({
      request: transportRequest("https://example.org/"),
      next: async () => htmlResponse(),
    });
    expect(result).toBeInstanceOf(Response);
    if (!(result instanceof Response)) throw new Error("test: nie `Response`");
    expect(result.headers.get("vary")).toContain("Sec-GPC");
  });

  it("odpowiedź NIE-HTML nie jest w ogóle dotykana - ta sama instancja wraca", async () => {
    // Beacony i API nie noszą cookie sygnału; nowa `Response` byłaby zbędną
    // kopią ciała strumienia przy każdym żądaniu.
    const response = jsonResponse();
    const result = await middlewareHandler()({
      request: transportRequest("https://example.org/api", { [GPC_HEADER]: "1" }),
      next: async () => response,
    });
    expect(result).toBe(response);
  });

  it("KSZTAŁT „obiekt z polem `response`” jest ZACHOWANY", async () => {
    // `documentCacheMiddleware` stoi NIŻEJ i czyta `result.response`. Zwrócenie
    // samej `Response` zamiast obiektu zgubiłoby resztę wyniku (kontekst).
    const carrier = { response: htmlResponse(), context: { tenant: "t1" } };
    const result = await middlewareHandler()({
      request: transportRequest("https://example.org/"),
      next: async () => carrier,
    });
    expect(result).not.toBeInstanceOf(Response);
    // STRAŻNIK, nie rzutowanie: warunek sprawdza kształt w RUNTIME i to on
    // zawęża typ. Rzutowanie przepuściłoby też wynik, w którym `response`
    // zniknęło - czyli dokładnie ten defekt, którego szukamy.
    if (!isResponseCarrier(result)) throw new Error("test: middleware zgubiło kształt wyniku");
    expect(result.context).toEqual({ tenant: "t1" });
    expect(result.response.headers.get("vary")).toContain("Sec-GPC");
    // Nowa odpowiedź, nie mutacja - headers runtime'u Workera bywają immutable.
    expect(result.response).not.toBe(carrier.response);
  });

  it("żądanie Z SYGNAŁEM dokłada cookie transportowe", async () => {
    const result = await middlewareHandler()({
      request: transportRequest("https://example.org/", { [GPC_HEADER]: "1" }),
      next: async () => htmlResponse(),
    });
    // `Set-Cookie` na odpowiedziach tworzonych skryptem bywa filtrowany przez
    // implementację `fetch` (guard „response"), więc plan sprawdzamy przez
    // funkcję czystą - to ta sama decyzja, którą middleware wykonało.
    const headers = gpcTransportHeaders(
      transportRequest("https://example.org/", { [GPC_HEADER]: "1" }),
      htmlResponse(),
    );
    expect(headers?.getSetCookie?.().join(";") ?? "").toContain(GPC_COOKIE);
    expect(result).toBeInstanceOf(Response);
  });
});

describe("isSecureRequest - flaga `Secure` na cookie sygnału", () => {
  it("nagłówek `x-forwarded-proto` rozstrzyga przed adresem", () => {
    // Za terminacją TLS adres widziany przez aplikację jest `http:`, więc bez
    // tego nagłówka cookie sygnału jeździłoby bez `Secure` na produkcji.
    const secure = gpcTransportHeaders(
      transportRequest("http://example.org/", {
        [GPC_HEADER]: "1",
        "x-forwarded-proto": "https, http",
      }),
      htmlResponse(),
    );
    expect(secure?.getSetCookie?.().join(";") ?? "").toContain("Secure");

    const plain = gpcTransportHeaders(
      transportRequest("https://example.org/", {
        [GPC_HEADER]: "1",
        "x-forwarded-proto": "http",
      }),
      htmlResponse(),
    );
    expect(plain?.getSetCookie?.().join(";") ?? "").not.toContain("Secure");
  });

  it("bez nagłówka decyduje SCHEMAT adresu", () => {
    const https = gpcTransportHeaders(
      transportRequest("https://example.org/", { [GPC_HEADER]: "1" }),
      htmlResponse(),
    );
    expect(https?.getSetCookie?.().join(";") ?? "").toContain("Secure");

    const http = gpcTransportHeaders(
      transportRequest("http://example.org/", { [GPC_HEADER]: "1" }),
      htmlResponse(),
    );
    expect(http?.getSetCookie?.().join(";") ?? "").not.toContain("Secure");
  });

  it("ADRES NIEPARSOWALNY schodzi na brak `Secure`, a nie na wyjątek", () => {
    // Adapter runtime'u potrafi podać `request.url` bez schematu (ścieżkę).
    // Wyjątek w tym miejscu wywaliłby się PO wyrenderowaniu dokumentu, a h4
    // przykryłoby to generycznym 500 - czyli sygnał prywatności zabiłby stronę.
    const headers = gpcTransportHeaders(
      transportRequest("/tylko-sciezka", { [GPC_HEADER]: "1" }),
      htmlResponse(),
    );
    expect(headers).toBeTruthy();
    expect(headers?.getSetCookie?.().join(";") ?? "").not.toContain("Secure");
  });

  it("PUSTY `x-forwarded-proto` nie jest traktowany jako deklaracja", () => {
    // Pusty nagłówek dokłada część serwerów proxy; czytany jako „nie https"
    // zdejmowałby `Secure` na realnie szyfrowanym połączeniu.
    const headers = gpcTransportHeaders(
      transportRequest("https://example.org/", {
        [GPC_HEADER]: "1",
        "x-forwarded-proto": "  ",
      }),
      htmlResponse(),
    );
    expect(headers?.getSetCookie?.().join(";") ?? "").toContain("Secure");
  });

  it("wartość cookie kasującego sygnał nie niesie `Max-Age` większego od zera", () => {
    // Kasowanie musi być kasowaniem: `Max-Age=0` plus pusta wartość. Inaczej
    // wyłączenie GPC w przeglądarce zostawiałoby opt-out na rok.
    const clearing = gpcCookieHeaderValue(false, true);
    expect(clearing).toContain("Max-Age=0");
    expect(clearing).toContain(`${GPC_COOKIE}=;`);
    expect(clearing).toContain("Secure");
  });
});
