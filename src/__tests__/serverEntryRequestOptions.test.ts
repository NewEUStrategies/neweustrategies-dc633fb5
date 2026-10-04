// DRUGI ARGUMENT `handler.fetch` NALEŻY DO FRAMEWORKA - i ten plik tego pilnuje.
//
// Do 2026-09-01 `src/server.ts` wołał `handler.fetch(request, env, ctx)`:
//   * slot nr 2 to `RequestOptions` TanStack Start - `context` | `inlineCss` |
//     `onEarlyHints` | `responseLinkHeader`
//     (@tanstack/start-server-core/src/request-handler.ts:60-68), więc `env`
//     workera było w nim KOLIZJĄ KONTRAKTU: binding albo zmienna o nazwie
//     `inlineCss` czy `onEarlyHints` zostałaby wzięta za opcję renderu;
//   * slotu nr 3 `requestHandler` nie ma w sygnaturze (tamże
//     request-response.ts:124), więc `REVALIDATION_CTX` był kodem martwym.
//
// Test odtwarza PRODUKCYJNY łańcuch wywołania, nie jego atrapę:
//   src/server.ts -> (atrapa `server-entry`, ale) -> PRAWDZIWY `requestHandler`
//   z @tanstack/react-start/server, czyli realny zasięg żądania h3 i realne
//   scalenie nagłówków zdarzenia w `toResponse()`.
// Atrapą jest wyłącznie moduł wirtualnego entry (`server-entry`), bo tylko on
// w teście nie istnieje - build go nie generuje. Wszystko poniżej granicy
// `requestHandler` jest prawdziwe: `appendLinkHeader`, `applyDeferredDocumentStore`,
// strażnik strumienia dokumentu.
//
// CZEGO TEN PLIK NIE MOŻE ZMIERZYĆ: `env` i `ExecutionContext` realnego workerd.
// Pod presetem `cloudflare-module` nasze entry i tak dostaje jeden argument
// (nitro woła `viteEnv.fetch(request)`), a bindingi widać przez `process.env`
// (unenv czyta `globalThis.__env__`) - i TO jest tu sprawdzalne. Emisja 103
// Early Hints wymagałaby runtime'u Workers i nie jest przedmiotem tej naprawy.
//
// Zero sieci, zero sekretów.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import serverEntry from "../server";
import {
  getDocumentCacheSnapshot,
  handleDocumentRequest,
  resetDocumentCacheForTests,
  revalidationHeader,
} from "../lib/http/documentCache.server";
import { appendLinkHeader, setCacheControlHeader } from "../lib/http/responseHeaders";
import type { DocumentRevalidator } from "../lib/http/documentCache.server";

const HTML_HEADERS = { "content-type": "text/html; charset=utf-8" } as const;
const DOC = "<html><body>ok</body></html>";

const hoisted = vi.hoisted(() => ({
  /** Każde wywołanie `handler.fetch` z `src/server.ts`, z zachowaną ARNOŚCIĄ. */
  calls: [] as Array<ReadonlyArray<unknown>>,
  /** Render pojedynczego testu, wołany WEWNĄTRZ zasięgu żądania h3. */
  render: null as null | ((request: Request) => Response | Promise<Response>),
  /** Driver rewalidacji w tle, przechwycony z `setDocumentRevalidator`. */
  revalidator: null as DocumentRevalidator | null,
  /** Gdy ustawione, entry rzuca tym PRZED dispatchem (ścieżka `catch` w server.ts). */
  failBeforeDispatch: undefined as unknown,
}));

vi.mock("@tanstack/react-start/server-entry", async () => {
  const { requestHandler } = await import("@tanstack/react-start/server");
  // Ta sama granica, którą build wstawia w wirtualne entry.
  const boundary = requestHandler(async (request: Request) => {
    const render = hoisted.render;
    if (!render) throw new Error("test nie ustawił renderu");
    return await render(request);
  });
  return {
    default: {
      // `createServerEntry` rozsypuje `...args` na granicę - odwzorowujemy to
      // 1:1, żeby test mierzył ARNOŚĆ wywołania z `src/server.ts`, a nie naszą.
      fetch: (...args: ReadonlyArray<unknown>) => {
        hoisted.calls.push(args);
        if (hoisted.failBeforeDispatch !== undefined) throw hoisted.failBeforeDispatch;
        const [request, requestOpts] = args;
        if (!(request instanceof Request)) {
          throw new Error("pierwszym argumentem entry musi być Request");
        }
        return boundary(request, requestOpts);
      },
    },
  };
});

vi.mock("../lib/http/documentCache.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/http/documentCache.server")>();
  return {
    ...actual,
    // Jedyna nadpisana funkcja: przechwyt drivera, żeby dosięgnąć DRUGIEGO
    // miejsca wołającego `handler.fetch` (przebieg w tle na żądaniu
    // syntetycznym). Reszta modułu - w tym `applyDeferredDocumentStore` - jest
    // prawdziwa i współdzieli stan z produkcyjną.
    setDocumentRevalidator: (revalidator: DocumentRevalidator | null): void => {
      hoisted.revalidator = revalidator;
      actual.setDocumentRevalidator(revalidator);
    },
  };
});

/**
 * Runtime'y wołają entry z RÓŻNĄ liczbą argumentów: workerd `(request, env, ctx)`,
 * nitro w dev `(request, init)`, nitro w produkcji `(request)`. Sygnatura
 * `src/server.ts` deklaruje tylko `request` - nadmiarowe argumenty JS ignoruje.
 * Ten alias pozwala je podać BEZ rzutowania (funkcja o mniejszej liczbie
 * parametrów jest przypisywalna do typu o większej).
 */
type RuntimeFetch = (request: Request, ...runtimeArgs: ReadonlyArray<unknown>) => Promise<Response>;
const entryFetch: RuntimeFetch = serverEntry.fetch;

/**
 * `env` workera z bindingami nazwanymi DOKŁADNIE jak opcje frameworka. Gdyby
 * ten obiekt trafił w slot nr 2, `inlineCss: "false"` (string - prawdziwy!)
 * wyłączyłby inline CSS, a nie-funkcja w `onEarlyHints` rzuciłaby w środku
 * renderu. Dlatego to jest właściwa atrapa dla tej naprawy.
 */
const HOSTILE_ENV = {
  inlineCss: "false",
  onEarlyHints: "to nie jest funkcja",
  responseLinkHeader: "1",
  context: "to nie jest kontekst",
  SUPABASE_URL: "https://przyklad.invalid",
} as const;

const EXECUTION_CTX = {
  waitUntil(): void {},
  passThroughOnException(): void {},
};

function htmlRender(headers: Record<string, string> = {}): () => Response {
  return () => new Response(DOC, { status: 200, headers: { ...HTML_HEADERS, ...headers } });
}

beforeEach(() => {
  hoisted.calls.length = 0;
  hoisted.render = htmlRender();
  hoisted.failBeforeDispatch = undefined;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("entry SSR: slot nr 2 `handler.fetch` jest wolny dla frameworka", () => {
  it("reports current HTML handling time without relabeling cached SSR time as TTFB", async () => {
    let now = 1000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    hoisted.render = () => {
      now += 37;
      return new Response(DOC, {
        headers: { ...HTML_HEADERS, "server-timing": "ssr;dur=12", "x-nes-cache": "HIT" },
      });
    };
    const response = await entryFetch(new Request("https://tenant-a.eu/"));
    expect(response.headers.get("server-timing")).toBe("ssr;dur=12, server-init;dur=0, app;dur=37");
    expect(await response.text()).toContain("ok");
  });

  it("does not add document timings to JSON responses", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    hoisted.render = () => Response.json({ ok: true });
    const response = await entryFetch(new Request("https://tenant-a.eu/api/data"));
    expect(response.headers.get("server-timing")).toBeNull();
    expect(await response.json()).toEqual({ ok: true });
    // Log dokumentu dotyczy WYŁĄCZNIE HTML - API i beacony nie zaśmiecają Workers Logs.
    expect(log).not.toHaveBeenCalled();
  });

  // LOG DOKUMENTU DO WORKERS LOGS (audyt 0.1 / F40). Hosting zdejmuje
  // `Server-Timing` i `x-nes-cache` z odpowiedzi, więc ta linia JSON jest
  // jedynym miejscem, w którym rozkład TTFB na fazy i status cache przeżywają.
  it("logs one JSON line per HTML document: path only, phases parsed, no query, no cookies", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    let now = 1000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    hoisted.render = () => {
      now += 37;
      return new Response(DOC, {
        headers: {
          ...HTML_HEADERS,
          "server-timing":
            'nes-edge;desc="MISS", ssr;dur=674.0, db;dur=2697.0;desc="n=19", edge-routing;dur=284.2',
          "x-nes-cache": "MISS",
          "set-cookie": "nes_lang=pl; Path=/",
        },
      });
    };
    const response = await entryFetch(
      new Request("https://tenant-a.eu/en/blog?utm_source=mail&token=sekret", {
        headers: { cookie: "sb-access-token=tajne", "accept-language": "en" },
      }),
    );
    await response.text();

    const lines = log.mock.calls.map((call) => String(call[0]));
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toEqual({
      kind: "doc",
      path: "/en/blog",
      status: 200,
      cache: "MISS",
      revalidation: false,
      serverInitMs: 0,
      appMs: 37,
      edgeRoutingMs: 284.2,
      ssrMs: 674,
      dbMs: 2697,
      dbCount: 19,
      // P0.4 (SC-1): linia powstaje PO KOŃCU body - `streamMs` na tej samej
      // bazie co `appMs` (zegar zamrożony po renderze, więc 37). Numer
      // żądania izolatu zależy od kolejności testów w pliku, wiek też.
      streamMs: 37,
      isoReq: expect.any(Number),
      isoAgeS: expect.any(Number),
      // Dokładne wartości licznika przypina blok „świeży moduł" na końcu pliku.
      coldEntry: expect.any(Boolean),
      // Żądanie bez nagłówka user-agent to automat (lista z botFilter.ts).
      uaClass: "bot",
      // Atrapa renderu nie niesie Cache-Control, więc wg polityki zapisu
      // (documentStorePolicy) ten MISS jest zdegradowany - jak w magazynie.
      degraded: true,
    });
    // Bez PII: ani query string, ani cookie, ani host nie mają prawa być w logu.
    expect(lines[0]).not.toContain("sekret");
    expect(lines[0]).not.toContain("tajne");
    expect(lines[0]).not.toContain("utm_source");
    expect(lines[0]).not.toContain("tenant-a.eu");
    // Nagłówek wychodzący nadal dostaje te same liczby, co log.
    expect(response.headers.get("server-timing")).toContain("server-init;dur=0, app;dur=37");
  });

  it("logs a background revalidation render with `revalidation: true`, never as a reader hit", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    hoisted.render = () =>
      new Response(DOC, {
        headers: { ...HTML_HEADERS, "server-timing": 'nes-edge;desc="MISS", ssr;dur=12.0' },
      });
    await hoisted.revalidator!(new Request("https://tenant-a.eu/blog?page=2"));

    const lines = log.mock.calls.map((call) => String(call[0]));
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({
      kind: "doc",
      path: "/blog",
      status: 200,
      revalidation: true,
      serverInitMs: 0,
      ssrMs: 12,
    });
    expect(lines[0]).not.toContain("page=2");
  });

  it("ścieżka czytelnika przekazuje wyłącznie kontrolowane opcje frameworka, cokolwiek dostanie od runtime'u", async () => {
    const response = await entryFetch(
      new Request("https://tenant-a.eu/blog"),
      HOSTILE_ENV,
      EXECUTION_CTX,
    );
    await response.text();

    expect(hoisted.calls).toHaveLength(1);
    const call = hoisted.calls[0]!;
    // ARNOŚĆ, nie tylko wartość: `fetch(request, undefined)` też przepuściłoby
    // asercję na `call[1]`, a jawne `undefined` w slocie opcji to już decyzja
    // o kształcie wywołania, której nie chcemy podejmować za framework.
    expect(call).toHaveLength(2);
    expect(call[1]).toEqual({ onEarlyHints: expect.any(Function) });
  });

  it("żaden binding env nie może już zostać wzięty za opcję renderu", async () => {
    const response = await entryFetch(
      new Request("https://tenant-a.eu/"),
      HOSTILE_ENV,
      EXECUTION_CTX,
    );
    await response.text();

    // Nie ma ŻADNEGO argumentu za `request` - ani `env`, ani `ctx`.
    expect(hoisted.calls[0]![1]).toEqual({ onEarlyHints: expect.any(Function) });
    // Ta sama rzecz po tożsamości obiektu: to ten konkretny `env` sprawdzamy,
    // a nie tylko długość tablicy.
    expect(hoisted.calls[0]).not.toContain(HOSTILE_ENV);
  });

  it("entry działa z 1, 2 i 3 argumentami (nitro prod, nitro dev, workerd)", async () => {
    const request = (path: string): Request => new Request(`https://tenant-a.eu${path}`);

    const one = await entryFetch(request("/a"));
    const two = await entryFetch(request("/b"), { method: "GET" });
    const three = await entryFetch(request("/c"), HOSTILE_ENV, EXECUTION_CTX);

    for (const response of [one, two, three]) {
      expect(response.status).toBe(200);
      expect(await response.text()).toContain("ok");
    }
    expect(hoisted.calls.map((call) => call.length)).toEqual([2, 2, 2]);
  });
});

describe("entry SSR: `env` dociera do czytelników drogą `process.env`", () => {
  it("render widzi binding przez process.env, choć entry nie przekazuje env dalej", async () => {
    vi.stubEnv("NES_TEST_BINDING", "wartość-z-env");
    let seen: string | undefined;
    hoisted.render = (): Response => {
      // Tak czyta env CAŁA aplikacja (392 odczyty `process.env.*`): unenv
      // podstawia pod `process.env` proxy nad `globalThis.__env__`, ustawianym
      // przez preset cloudflare-module warstwę WYŻEJ niż nasze entry.
      seen = process.env.NES_TEST_BINDING;
      return new Response(DOC, { status: 200, headers: HTML_HEADERS });
    };

    const response = await entryFetch(new Request("https://tenant-a.eu/"), HOSTILE_ENV);
    await response.text();

    expect(seen).toBe("wartość-z-env");
    expect(hoisted.calls[0]).toHaveLength(2);
  });
});

describe("entry SSR: nagłówek `Link` przeżywa całą drogę", () => {
  it("wartość z `appendLinkHeader` wychodzi z entry nietknięta", async () => {
    const hint = "</assets/dict-pl.js>; rel=preload; as=script";
    hoisted.render = (): Response => {
      appendLinkHeader(hint);
      return new Response(DOC, { status: 200, headers: HTML_HEADERS });
    };

    const response = await entryFetch(new Request("https://tenant-a.eu/"), HOSTILE_ENV);
    const body = await response.text();

    // Nagłówek zdarzenia h3, scalony na odpowiedź w `toResponse()`, przeszedł
    // dalej cały ogon entry: normalizator katastrofy (200 wychodzi z niego
    // nietknięte), odroczony zapis i strażnika strumienia.
    expect(response.headers.get("link")).toBe(hint);
    // Strażnik NAPRAWDĘ przepakował odpowiedź - asercja wyżej nie jest pozorna.
    expect(response.headers.get("x-ssr-doc-guard")).toBe("on");
    expect(body).toContain("ok");
  });

  it("dwa wpisy z różnych loaderów zostają złączone i żaden nie ginie", async () => {
    const first = "</assets/dict-pl.js>; rel=preload; as=script";
    const second = "</assets/hero.avif>; rel=preload; as=image";
    hoisted.render = (): Response => {
      appendLinkHeader(first);
      appendLinkHeader(second);
      return new Response(DOC, { status: 200, headers: HTML_HEADERS });
    };

    const response = await entryFetch(new Request("https://tenant-a.eu/"));
    await response.text();

    expect(response.headers.get("link")).toBe(`${first}, ${second}`);
  });

  it("`Link` nadany wprost na odpowiedzi renderu też wychodzi bez zmian", async () => {
    const hint = "</assets/font.woff2>; rel=preload; as=font; crossorigin";
    hoisted.render = htmlRender({ link: hint });

    const response = await entryFetch(new Request("https://tenant-a.eu/"));
    await response.text();

    expect(response.headers.get("link")).toBe(hint);
  });
});

describe("entry SSR: driver rewalidacji w tle", () => {
  it("jest zarejestrowany i też przekazuje wyłącznie kontrolowane opcje frameworka", async () => {
    const revalidator = hoisted.revalidator;
    expect(revalidator).toBeTypeOf("function");

    const reader = new Request("https://tenant-a.eu/blog", {
      headers: {
        "x-forwarded-host": "tenant-a.eu",
        "accept-language": "pl-PL,pl;q=0.9",
        authorization: "Bearer nie-dla-cache",
      },
    });

    const stored = await revalidator!(reader);

    // Brak zarejestrowanego odroczonego zapisu (middleware cache'a w tym teście
    // nie biegnie), więc driver uczciwie raportuje "nie zapisałem".
    expect(stored).toBe(false);
    const call = hoisted.calls.at(-1)!;
    expect(call).toHaveLength(2);

    const synthetic = call[0];
    if (!(synthetic instanceof Request)) throw new Error("driver nie podał Requestu");
    const [markerName, markerValue] = revalidationHeader();
    expect(synthetic.headers.get(markerName)).toBe(markerValue);
    expect(synthetic.method).toBe("GET");
    expect(synthetic.url).toBe("https://tenant-a.eu/blog");
    // Wąska lista nagłówków: host tenanta i negocjacja języka jadą dalej...
    expect(synthetic.headers.get("x-forwarded-host")).toBe("tenant-a.eu");
    expect(synthetic.headers.get("accept-language")).toBe("pl-PL,pl;q=0.9");
    // ...a `authorization` NIE, bo dokument w cache'u jest anonimową skorupą.
    expect(synthetic.headers.get("authorization")).toBeNull();
    // CZEGO TU NIE MA: asercji na przeniesienie ciasteczka JĘZYKA. `cookie`
    // (jak i `host`) to nazwa ZABRONIONA dla straży „request" w Headers, którą
    // implementacja z tego środowiska wymusza w KONSTRUKTORZE `Request` - i po
    // stronie żądania czytelnika, i po stronie syntetycznego. Runtime serwerowy
    // (workerd, undici) tej straży nie wymusza, więc w produkcji ciasteczko
    // przechodzi. Tego jednego kroku nie da się tu zmierzyć bez runtime'u
    // Workers; naprawa punktu 9 go nie dotyka (`revalidationHeaders` jest bez
    // zmian).
  });
});

describe("entry SSR: potok awaryjny między zmienionymi liniami nie ucierpiał", () => {
  it("połknięty przez h3 błąd 500 nadal zamienia się w przyjazny dokument", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    hoisted.render = (): Response =>
      new Response(JSON.stringify({ unhandled: true, message: "HTTPError" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });

    const response = await entryFetch(new Request("https://tenant-a.eu/"), HOSTILE_ENV);
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body.length).toBeGreaterThan(0);
    expect(errors).toHaveBeenCalled();
  });
});

const CACHEABLE_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "public, max-age=60, s-maxage=900, stale-while-revalidate=86400",
} as const;
const RAY = "8c5a3b2e9f1d4e7a-WAW";
const encoder = new TextEncoder();

function docLines(log: { mock: { calls: unknown[][] } }): Record<string, unknown>[] {
  return log.mock.calls
    .map((call) => String(call[0]))
    .filter((line) => line.startsWith('{"kind":"doc"'))
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

/** Żądanie dokumentu z hostem tenanta tak, jak podaje go proxy produkcyjne. */
function documentRequest(path: string, headers: Record<string, string> = {}): Request {
  return new Request(`https://tenant-a.eu${path}`, {
    headers: { "x-forwarded-host": "tenant-a.eu", ...headers },
  });
}

/** Render przez PRAWDZIWY `handleDocumentRequest` (rejestracja odroczonego zapisu). */
function cachedRender(render: () => Response): (request: Request) => Promise<Response> {
  return async (request) => (await handleDocumentRequest(request, render)) as Response;
}

/**
 * Dokument do zapisu, którego trasa zawęża dyrektywę cache'ową DOPIERO PO
 * pierwszym chunku - dokładnie przypadek z documentCache.server.ts („degradacja
 * odkryta W TRAKCIE strumieniowania"): nagłówki wyszły jako publiczne,
 * a magazyn przy drugiej kontroli odmawia zapisu.
 *
 * Mechanika testu: `setCacheControlHeader` potrzebuje zasięgu żądania h3
 * (AsyncLocalStorage), a odczyt strumienia biegnie już poza nim. Dlatego
 * kontynuacja zawężenia jest rejestrowana W zasięgu (w renderze), a odpala ją
 * drugi `pull` źródła - czyli chwila, w której pierwszy chunk przeszedł już
 * przez tee zapisu (`highWaterMark: 0`: nikt nie czyta źródła przed tee).
 */
function narrowedAfterFirstChunk(): Response {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const narrowed = gate.then(() => setCacheControlHeader("private, no-store"));
  let pulls = 0;
  const body = new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        pulls += 1;
        if (pulls === 1) {
          controller.enqueue(encoder.encode("<html><body>"));
          return;
        }
        release();
        await narrowed;
        controller.enqueue(encoder.encode("</body></html>"));
        controller.close();
      },
    },
    { highWaterMark: 0 },
  );
  return new Response(body, { status: 200, headers: CACHEABLE_HEADERS });
}

// Recenzja P0.4, MAJOR 2: `degraded` w linii ma mówić, co magazyn ZROBIŁ, nie
// co obiecywały nagłówki wysłane przed body. Potrzebny prawdziwy zasięg
// żądania h3 (dyrektywa trasy), więc test żyje tutaj, nie w documentCache.
describe("entry SSR: linia dokumentu niesie prawdziwy wynik zapisu", () => {
  beforeEach(() => {
    resetDocumentCacheForTests();
  });

  it("dyrektywa `no-store` ustawiona PO pierwszym chunku daje `degraded: true` i `store: degraded`", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    hoisted.render = cachedRender(narrowedAfterFirstChunk);

    const response = await entryFetch(documentRequest("/w-trakcie"));
    // Nagłówki wyszły jako publiczne - z nich samych `degraded` byłoby false.
    expect(response.headers.get("cache-control")).toContain("public");
    expect(response.headers.get("x-nes-cache")).toBe("MISS");
    expect(await response.text()).toBe("<html><body></body></html>");

    // Linia jest w logu, zanim czytelnik zobaczył `done` (kontrakt harnessu).
    const lines = docLines(log);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      path: "/w-trakcie",
      cache: "MISS",
      degraded: true,
      store: "degraded",
    });
    expect(lines[0]).not.toHaveProperty("streamEnd");
    expect(getDocumentCacheSnapshot().entries).toBe(0);
  });

  it("kontrola: czysty MISS do zapisu daje `degraded: false`, `store: stored` i wpis w L1", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    hoisted.render = cachedRender(
      () => new Response(DOC, { status: 200, headers: CACHEABLE_HEADERS }),
    );

    const response = await entryFetch(documentRequest("/czysty"));
    expect(await response.text()).toBe(DOC);
    const lines = docLines(log);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ cache: "MISS", degraded: false, store: "stored" });
    expect(getDocumentCacheSnapshot().entries).toBe(1);
  });
});

// Recenzja P0.4, MINOR 5 + twardy kontrakt harnessu pomiaru (P0.1:
// scripts/performance/artifactServer.ts `rewarmDocument` + `logCursor`):
// kursor logu staje po HIT-cie rozgrzewki, a każda linia `revalidation:true`
// po nim liczy się jako render serwera w przebiegu Lighthouse'a.
describe("entry SSR: linia rewalidacji w tle", () => {
  beforeEach(() => {
    resetDocumentCacheForTests();
  });

  it("powstaje po decyzji magazynu, ale ZANIM odświeżony wpis da się podać jako HIT", async () => {
    const entriesAtLine: number[] = [];
    const log = vi.spyOn(console, "log").mockImplementation((line: unknown) => {
      if (String(line).includes('"revalidation":true')) {
        entriesAtLine.push(getDocumentCacheSnapshot().entries);
      }
    });
    hoisted.render = cachedRender(
      () => new Response(DOC, { status: 200, headers: CACHEABLE_HEADERS }),
    );

    const trigger = documentRequest("/odswiezany?page=2", { "cf-ray": RAY });
    expect(await hoisted.revalidator!(trigger)).toBe(true);

    // W chwili zapisu linii wpisu w L1 jeszcze nie było; po rewalidacji jest.
    expect(entriesAtLine).toEqual([0]);
    expect(getDocumentCacheSnapshot().entries).toBe(1);
    const lines = docLines(log);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      path: "/odswiezany",
      cache: "MISS",
      revalidation: true,
      degraded: false,
      store: "stored",
      // Kolonia i ray żądania WYZWALAJĄCEGO - pola logu do korelacji.
      colo: "WAW",
      ray: RAY,
    });
    for (const key of ["isoReq", "isoAgeS", "coldEntry", "streamMs"]) {
      expect(lines[0]).not.toHaveProperty(key);
    }
    // ...i nigdy nagłówek syntetycznego żądania - ten wpływa na render.
    const synthetic = hoisted.calls.at(-1)![0] as Request;
    expect(synthetic.headers.get("cf-ray")).toBeNull();
  });

  it("degradacja odkryta W TRAKCIE strumieniowania: ta sama definicja `degraded` co na ścieżce czytelnika", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    hoisted.render = cachedRender(narrowedAfterFirstChunk);

    expect(await hoisted.revalidator!(documentRequest("/odswiezany-zdegradowany"))).toBe(false);

    const lines = docLines(log);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      revalidation: true,
      cache: "MISS",
      degraded: true,
      store: "degraded",
    });
    // Żądanie wyzwalające bez `cf-ray`: brak kolonii i ray-a, a nie śmieci.
    expect(lines[0]).not.toHaveProperty("colo");
    expect(lines[0]).not.toHaveProperty("ray");
    expect(getDocumentCacheSnapshot().entries).toBe(0);
  });
});

// Recenzja P0.4, MINOR 8: wyjątek PRZED dispatchem routera (też padnięty
// import entry na zimnym izolacie) daje stronę 500 - do tej pory bez linii.
describe("entry SSR: strona 500 ze ścieżki `catch` ma linię dokumentu", () => {
  it("linia z licznikiem izolatu, kolonią i ray-em, bez `streamMs`; Server-Timing bez zmian", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const failure = new Error("entry padło przed routerem");
    hoisted.failBeforeDispatch = failure;

    const response = await entryFetch(
      new Request("https://tenant-a.eu/blog?token=sekret", { headers: { "cf-ray": RAY } }),
    );
    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("server-timing")).toBeNull();
    expect(errors).toHaveBeenCalledWith(failure);

    const lines = docLines(log);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toEqual({
      kind: "doc",
      path: "/blog",
      status: 500,
      cache: null,
      revalidation: false,
      serverInitMs: expect.any(Number),
      appMs: expect.any(Number),
      colo: "WAW",
      isoReq: expect.any(Number),
      isoAgeS: expect.any(Number),
      coldEntry: expect.any(Boolean),
      uaClass: "bot",
      ray: RAY,
    });
    expect(JSON.stringify(lines[0])).not.toContain("sekret");
  });

  it("kontrola: zerwany klient (499, nie HTML) nadal bez linii dokumentu", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    hoisted.failBeforeDispatch = Object.assign(new Error("socket"), { code: "ECONNRESET" });

    const response = await entryFetch(new Request("https://tenant-a.eu/blog"));
    expect(response.status).toBe(499);
    expect(docLines(log)).toHaveLength(0);
  });
});

// Recenzja P0.4, MINOR 3 i 4. Licznik izolatu żyje w zasięgu modułu
// `src/server.ts` i nie da się go cofnąć - świeży import modułu to świeży
// izolat. MUSI stać na końcu pliku: `vi.resetModules()` podmienia instancje
// modułów (w tym znacznik rewalidacji), z których korzystają testy wyżej.
describe("entry SSR: licznik izolatu na świeżym module", () => {
  async function freshEntry(): Promise<RuntimeFetch> {
    vi.resetModules();
    const fresh = await import("../server");
    return fresh.default.fetch;
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it("pierwsze żądanie: `isoReq` 1, `isoAgeS` 0 i `coldEntry`; po 5 s drugie: 2, 5, ciepłe", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-04T10:00:00Z"), toFake: ["Date"] });
    const fetchFresh = await freshEntry();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    // Wiek liczy się od PIERWSZEGO ŻĄDANIA, nie od załadowania modułu.
    vi.advanceTimersByTime(7_000);

    await (await fetchFresh(new Request("https://tenant-a.eu/pierwsze"))).text();
    vi.advanceTimersByTime(5_000);
    await (await fetchFresh(new Request("https://tenant-a.eu/drugie"))).text();

    expect(
      docLines(log).map(({ path, isoReq, isoAgeS, coldEntry }) => ({
        path,
        isoReq,
        isoAgeS,
        coldEntry,
      })),
    ).toEqual([
      { path: "/pierwsze", isoReq: 1, isoAgeS: 0, coldEntry: true },
      { path: "/drugie", isoReq: 2, isoAgeS: 5, coldEntry: false },
    ]);
  });

  it("dwa równoległe żądania na zimnym izolacie: oba `coldEntry`, choć `isoReq` 1 ma tylko pierwsze", async () => {
    const fetchFresh = await freshEntry();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const [first, second] = await Promise.all([
      fetchFresh(new Request("https://tenant-a.eu/rownolegle-a")),
      fetchFresh(new Request("https://tenant-a.eu/rownolegle-b")),
    ]);
    await first.text();
    await second.text();
    await (await fetchFresh(new Request("https://tenant-a.eu/po-starcie"))).text();

    const byPath = new Map(docLines(log).map((line) => [line.path, line]));
    expect(byPath.get("/rownolegle-a")).toMatchObject({ isoReq: 1, coldEntry: true });
    // `isoReq == 1` uznałoby to żądanie za ciepłe, choć czekało na ten sam import.
    expect(byPath.get("/rownolegle-b")).toMatchObject({ isoReq: 2, coldEntry: true });
    expect(byPath.get("/po-starcie")).toMatchObject({ isoReq: 3, coldEntry: false });
  });
});
