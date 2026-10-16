// WERSJA DEPLOYA: GET /api/public/version.
//
// PO CO TEN PLIK ISTNIEJE. Klient (`src/lib/cacheBusting.ts`, `fetchVersion`
// i `startCacheBusting`) odpytuje ten adres co 5 minut i przy zmianie wartości
// `v` robi miękkie odświeżenie (`router.invalidate`) - to jedyny sygnał, po
// którym otwarta karta dowiaduje się o nowym deployu, zanim trafi na usunięty
// chunk. Plik trasy stał na 0% pokrycia, a niósł defekt, którego żaden test nie
// mógł zobaczyć:
//
//   BUILD_ID LICZONY W ZASIĘGU MODUŁU. `rt-${Date.now().toString(36)}` liczył
//   się przy ładowaniu modułu, czyli w zakresie globalnym workerd - a tam zegar
//   stoi na 0. Produkcja oddawała więc stałe `rt-0` w KAŻDYM deployu (repo samo
//   to opisuje w `src/lib/http/documentCache.server.ts`, przy nonce
//   rewalidacji), a `LOVABLE_BUILD_ID` nie jest nigdzie ustawiany. Skutek:
//   klient nigdy nie widział nowego deployu.
//
// CO DOWODZIMY:
//   1. kształt odpowiedzi i nagłówki (`no-store`, JSON) - kontrakt `fetchVersion`,
//   2. kolejność źródeł: runtime `LOVABLE_BUILD_ID` -> stała buildu
//      `__NES_BUILD_ID__` (define Vite) -> leniwy `rt-<czas żądania>`,
//   3. że zegar NIE jest czytany przy imporcie modułu (model workerd: zegar
//      zakresu globalnego = 0, zegar żądania = prawdziwy czas),
//   4. stabilność: ten sam izolat i ten sam build dają tę samą wartość, a nowy
//      build - inną (to jest dokładnie pytanie, które zadaje klient),
//   5. bramkę SSR przy odczycie stałej (jak `l2BuildId()`): stała, inna w każdym
//      buildzie, nie może zmieniać hashy chunków klienta.
//
// MODEL IZOLATU. „Izolat" = świeża instancja modułu (`vi.resetModules` +
// dynamiczny import) załadowana przy zegarze 0. Stałą `define` podstawiamy jako
// zmienną globalną - w vitest wolny identyfikator czyta się z `globalThis`,
// dokładnie tą samą ścieżką (`typeof` + wartość), co w artefakcie po
// podstawieniu (tak samo `src/lib/http/__tests__/documentCacheL2BuildId.test.ts`).
//
// NAZWA PLIKU. Prefiks `-`: generator drzewa tras pomija takie pliki
// (`routeFileIgnorePattern` w `vite.config.ts`), więc test nie staje się trasą.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { routeServerHandlers, type RouteServerHandler } from "@/test/routeHarness";

/** Chwila żądania w testach - dowolna, byle daleko od zera zakresu globalnego. */
const REQUEST_TIME = Date.UTC(2026, 9, 16, 9, 30);

/** Ładuje NOWY izolat: zegar zakresu globalnego stoi na 0 - jak w workerd. */
async function bootIsolate(): Promise<RouteServerHandler> {
  vi.setSystemTime(0);
  vi.resetModules();
  const { Route } = await import("@/routes/api/public/version");
  const get = routeServerHandlers(Route).GET;
  if (!get) throw new Error("test: trasa wersji nie ma handlera GET");
  return get;
}

function request(): Request {
  return new Request("https://neweuropeanstrategies.com/api/public/version");
}

/** Żądanie w podanej chwili - zegar zakresu żądania jest prawdziwy. */
async function versionAt(get: RouteServerHandler, at: number): Promise<string> {
  vi.setSystemTime(at);
  const body: unknown = await (await get({ request: request() })).json();
  if (!body || typeof body !== "object" || !("v" in body) || typeof body.v !== "string") {
    throw new Error("test: odpowiedź nie niesie napisu `v`");
  }
  return body.v;
}

/** Artefakt buildu ze stałą `define` (albo bez niej - `undefined`). */
function buildConstant(value: string | undefined): void {
  vi.stubGlobal("__NES_BUILD_ID__", value);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  // Odczyt stałej siedzi za bramką SSR - trasa wersji biegnie wyłącznie na serwerze.
  vi.stubEnv("SSR", true);
  // Środowisko maszyny nie może przeciekać do dowodu o kolejności źródeł.
  vi.stubEnv("LOVABLE_BUILD_ID", undefined);
  buildConstant(undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("GET /api/public/version - kontrakt odpowiedzi", () => {
  it("wystawia wyłącznie GET", async () => {
    vi.resetModules();
    const { Route } = await import("@/routes/api/public/version");

    expect(Object.keys(routeServerHandlers(Route))).toEqual(["GET"]);
  });

  it("oddaje 200 z JSON-em `{ v }` i nagłówkami no-store", async () => {
    buildConstant("tmgi4x2k1");
    const get = await bootIsolate();
    vi.setSystemTime(REQUEST_TIME);

    const response = await get({ request: request() });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
    // Pośrednik (edge, przeglądarka) z zamrożoną odpowiedzią ukryłby deploy
    // dokładnie tak samo jak stała wartość.
    expect(response.headers.get("Cache-Control")).toBe("no-store, max-age=0");
    expect(await response.json()).toEqual({ v: "tmgi4x2k1" });
  });
});

describe("kolejność źródeł identyfikatora", () => {
  it("runtime `LOVABLE_BUILD_ID` wygrywa ze stałą buildu", async () => {
    vi.stubEnv("LOVABLE_BUILD_ID", "deploy-42");
    buildConstant("tmgi4x2k1");
    const get = await bootIsolate();

    expect(await versionAt(get, REQUEST_TIME)).toBe("deploy-42");
  });

  it("bez zmiennej runtime oddaje stałą buildu `__NES_BUILD_ID__`", async () => {
    // To jest źródło, które realnie istnieje na produkcji: `define` w obu
    // presetach Vite. Wcześniej trasa go nie czytała i spadała do zegara.
    buildConstant("tmgi4x2k1");
    const get = await bootIsolate();

    expect(await versionAt(get, REQUEST_TIME)).toBe("tmgi4x2k1");
  });

  it("pusta zmienna runtime nie jest identyfikatorem - przechodzi do stałej", async () => {
    vi.stubEnv("LOVABLE_BUILD_ID", "");
    buildConstant("tmgi4x2k1");
    const get = await bootIsolate();

    expect(await versionAt(get, REQUEST_TIME)).toBe("tmgi4x2k1");
  });

  it("bez obu źródeł oddaje `rt-<czas pierwszego żądania w base36>`", async () => {
    const get = await bootIsolate();

    expect(await versionAt(get, REQUEST_TIME)).toBe(`rt-${REQUEST_TIME.toString(36)}`);
  });

  it("poza zakresem SSR stała jest ignorowana (w bundlu klienta odczyt znika)", async () => {
    // Bramka jak w `l2BuildId()`: plik trasy jest też w drzewie tras klienta,
    // a stała jest inna w każdym buildzie - jej literał w chunku klienta
    // zmieniałby hash chunku przy każdym deployu.
    vi.stubEnv("SSR", false);
    buildConstant("tmgi4x2k1");
    const get = await bootIsolate();

    expect(await versionAt(get, REQUEST_TIME)).toBe(`rt-${REQUEST_TIME.toString(36)}`);
  });
});

describe("zegar zakresu globalnego workerd stoi na 0 - identyfikator nie może z niego pochodzić", () => {
  it("fallback liczy się w CZASIE ŻĄDANIA, nie przy imporcie modułu", async () => {
    // Moduł ładuje się przy zegarze 0 (`bootIsolate`). Wyrażenie zegarowe
    // w zasięgu modułu dałoby tu `rt-0` - dokładnie wartość z produkcji.
    const get = await bootIsolate();

    const v = await versionAt(get, REQUEST_TIME);

    expect(v).not.toBe("rt-0");
    expect(v).toBe(`rt-${REQUEST_TIME.toString(36)}`);
  });

  it("nowy deploy daje klientowi NOWĄ wartość", async () => {
    // Pytanie, które zadaje `startCacheBusting`: „czy wartość się zmieniła?".
    // Przy stałym `rt-0` odpowiedź brzmiała „nie" po każdym deployu.
    buildConstant("build-a");
    const before = await versionAt(await bootIsolate(), REQUEST_TIME);

    buildConstant("build-b");
    const after = await versionAt(await bootIsolate(), REQUEST_TIME + 60_000);

    expect(before).toBe("build-a");
    expect(after).toBe("build-b");
  });
});

describe("stabilność wartości", () => {
  it("izolat oddaje tę samą wartość przy kolejnych żądaniach (memo raz na izolat)", async () => {
    // Zmiana w obrębie jednego izolatu to fałszywy „nowy build" i niepotrzebne
    // miękkie odświeżenie u każdego klienta, który trafi na ten izolat.
    const get = await bootIsolate();

    const first = await versionAt(get, REQUEST_TIME);
    const later = await versionAt(get, REQUEST_TIME + 3_600_000);

    expect(later).toBe(first);
  });

  it("dwa izolaty TEGO SAMEGO buildu oddają tę samą wartość", async () => {
    // Cloudflare rozkłada ruch na wiele izolatów jednego deployu. Ze stałą
    // buildu klient nie widzi rotacji izolatu jako nowego deployu.
    buildConstant("build-a");
    const first = await versionAt(await bootIsolate(), REQUEST_TIME);
    const second = await versionAt(await bootIsolate(), REQUEST_TIME + 120_000);

    expect(second).toBe(first);
  });
});
