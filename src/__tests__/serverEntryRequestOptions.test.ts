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
import { revalidationHeader } from "../lib/http/documentCache.server";
import { appendLinkHeader } from "../lib/http/responseHeaders";
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
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("entry SSR: slot nr 2 `handler.fetch` jest wolny dla frameworka", () => {
  it("ścieżka czytelnika woła handler JEDNYM argumentem, cokolwiek dostanie od runtime'u", async () => {
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
    expect(call).toHaveLength(1);
    expect(call[1]).toBeUndefined();
  });

  it("żaden binding env nie może już zostać wzięty za opcję renderu", async () => {
    const response = await entryFetch(
      new Request("https://tenant-a.eu/"),
      HOSTILE_ENV,
      EXECUTION_CTX,
    );
    await response.text();

    // Nie ma ŻADNEGO argumentu za `request` - ani `env`, ani `ctx`.
    expect(hoisted.calls[0]!.slice(1)).toEqual([]);
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
    expect(hoisted.calls.map((call) => call.length)).toEqual([1, 1, 1]);
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
    expect(hoisted.calls[0]).toHaveLength(1);
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
  it("jest zarejestrowany i też woła handler JEDNYM argumentem", async () => {
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
    expect(call).toHaveLength(1);

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
