// L2 NA NAZWANYM CACHE'U (fala 3, P3.6a, diagnoza `faza3/diagnoza/cache-dokumentu.md` R1).
//
// W produkcji `caches.default` nic nie przechowuje (hosting w trybie, w którym Cloudflare je
// wyłącza), więc L2 dokumentów, migawki routingu i cache mediów były no-opem, a `l2Stats().enabled`
// i tak meldowało „włączone". Ta suita podstawia PRAWDZIWY kształt runtime'u - `globalThis.caches`
// z `default` i `open` - i sprawdza zachowanie fasady, a nie atrapę wstrzykniętą obok niej:
//   - nazwany cache niesie wpis kolonii przez „rotację izolatu" (HIT z L2), samotest go potwierdza;
//   - `open` rzuca -> powrót do `caches.default`; martwy default -> samotest `false`, L2 wyłączone;
//   - runtime bez `open` -> `caches.default` wprost, bez samotestu (zachowanie sprzed zmiany);
//   - klucz dokumentu niesie segment buildu, purge trafia w ten sam nazwany magazyn.
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

import { NES_CACHE_HEADER } from "@/lib/http/documentCache";
import {
  applyDeferredDocumentStore,
  getDocumentCacheSnapshot,
  handleDocumentRequest,
  purgeDocumentCache,
  purgeDocumentPaths,
  resetDocumentCacheForTests,
} from "@/lib/http/documentCache.server";
import { getColoCache, l2Stats, setColoCacheForTests } from "@/lib/http/documentCacheL2.server";

/** Funkcjonalny magazyn Cache API (mapa URL -> odpowiedź) z rejestrem wywołań. */
function memoryCache() {
  const entries = new Map<string, { body: Uint8Array; headers: Headers }>();
  return {
    match: vi.fn(async (request: Request) => {
      const hit = entries.get(request.url);
      return hit
        ? new Response(hit.body.slice(), { headers: new Headers(hit.headers) })
        : undefined;
    }),
    put: vi.fn(async (request: Request, response: Response) => {
      entries.set(request.url, {
        body: new Uint8Array(await response.arrayBuffer()),
        headers: new Headers(response.headers),
      });
    }),
    delete: vi.fn(async (request: Request) => entries.delete(request.url)),
    urls: () => [...entries.keys()],
  };
}

/** `caches.default` z produkcji: przyjmuje zapis i nic nie przechowuje. */
function inertCache() {
  return {
    match: vi.fn(async (_request: Request): Promise<Response | undefined> => undefined),
    put: vi.fn(async (_request: Request, _response: Response): Promise<void> => {}),
  };
}

const CACHEABLE_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "public, max-age=60, s-maxage=900, stale-while-revalidate=86400",
};

function htmlResponse(body: string): Response {
  return new Response(body, { status: 200, headers: CACHEABLE_HEADERS });
}

function docRequest(path: string, host = "tenant-a.eu"): Request {
  return new Request(`https://${host}${path}`, {
    method: "GET",
    headers: { "x-forwarded-host": host },
  });
}

/** Pełny cykl jednego żądania: middleware + odroczony zapis z `src/server.ts`. */
async function renderThroughEdge(
  path: string,
  render: () => Response | Promise<Response>,
): Promise<Response> {
  const result = await handleDocumentRequest(docRequest(path), render);
  return applyDeferredDocumentStore(result as Response);
}

/** „Rotacja izolatu": znika L1 i cały stan modułu L2 (fasada, samotest), kolonia zostaje. */
function rotateIsolate(): void {
  resetDocumentCacheForTests();
  setColoCacheForTests(undefined);
}

const selfTestUrls = (urls: readonly string[]) => urls.filter((url) => url.includes("/selftest/"));

let log: MockInstance<typeof console.log>;

beforeEach(() => {
  rotateIsolate();
  log = vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  rotateIsolate();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("fasada nazwanego cache'u (`caches.open`)", () => {
  it("wpis kolonii przeżywa rotację izolatu: HIT z L2 bez renderu, samotest `verified: true`", async () => {
    const named = memoryCache();
    const fallback = inertCache();
    const open = vi.fn(async (_name: string) => named);
    vi.stubGlobal("caches", { default: fallback, open });
    const render = vi.fn(() => htmlResponse("<html>kolonia</html>"));

    const miss = await renderThroughEdge("/wpis", render);
    expect(miss.headers.get(NES_CACHE_HEADER)).toBe("MISS");
    await miss.text();
    await vi.waitFor(() => expect(l2Stats().stores).toBe(1));
    await vi.waitFor(() => expect(l2Stats().verified).toBe(true));
    expect(l2Stats()).toMatchObject({ enabled: true, verified: true, store: "named" });
    expect(open).toHaveBeenCalledWith("nes-edge-v1");

    rotateIsolate();
    const hit = (await handleDocumentRequest(docRequest("/wpis"), render)) as Response;
    expect(hit.headers.get(NES_CACHE_HEADER)).toBe("HIT");
    expect(hit.headers.get("server-timing")).toContain('nes-layer;desc="L2"');
    expect(await hit.text()).toBe("<html>kolonia</html>");
    expect(render).toHaveBeenCalledTimes(1);
    expect(getDocumentCacheSnapshot().l2.hits).toBe(1);
    // `caches.default` nie bierze udziału, gdy nazwany cache działa.
    expect(fallback.match).not.toHaveBeenCalled();
    expect(fallback.put).not.toHaveBeenCalled();
  });

  it("uchwyt magazynu i samotest są raz na izolat; samotest pisze jedną linię logu", async () => {
    const named = memoryCache();
    const open = vi.fn(async (_name: string) => named);
    vi.stubGlobal("caches", { default: inertCache(), open });

    await (await renderThroughEdge("/a", () => htmlResponse("<html>a</html>"))).text();
    await vi.waitFor(() => expect(l2Stats().verified).toBe(true));
    const opensAfterWarmup = open.mock.calls.length;

    for (const path of ["/b", "/c", "/a"]) {
      await (await renderThroughEdge(path, () => htmlResponse(`<html>${path}</html>`))).text();
    }
    purgeDocumentPaths("tenant-a.eu", ["/b"]);
    await vi.waitFor(() => expect(named.delete).toHaveBeenCalled());

    expect(open.mock.calls.length).toBe(opensAfterWarmup);
    expect(selfTestUrls(named.urls())).toHaveLength(1);
    const lines = log.mock.calls
      .map((call) => String(call[0]))
      .filter((line) => line.includes('"kind":"l2"'));
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({ kind: "l2", verified: true, store: "named" });
  });

  it("Server-Timing dokumentu niesie stan samotestu: `pending`, potem `named`", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const named = memoryCache();
    let releaseSelfTest: () => void = () => {};
    const selfTestGate = new Promise<void>((resolve) => {
      releaseSelfTest = resolve;
    });
    const gated = {
      ...named,
      put: vi.fn(async (request: Request, response: Response) => {
        if (request.url.includes("/selftest/")) await selfTestGate;
        await named.put(request, response);
      }),
    };
    vi.stubGlobal("caches", { default: inertCache(), open: async () => gated });

    const pending = await renderThroughEdge("/stan", () => htmlResponse("<html>stan</html>"));
    expect(pending.headers.get("server-timing")).toMatch(/nes-l2;desc="pending"$/);
    await pending.text();

    releaseSelfTest();
    await vi.waitFor(() => expect(l2Stats().verified).toBe(true));
    const settled = await renderThroughEdge("/stan", () => htmlResponse("<html>inny</html>"));
    expect(settled.headers.get(NES_CACHE_HEADER)).toBe("HIT");
    // Metryka stanu L2 zawsze OSTATNIA (wiek wpisu przesuwa `vi.waitFor` na sztucznym zegarze).
    expect(settled.headers.get("server-timing")).toMatch(
      /^nes-edge;desc="HIT", nes-age;dur=\d+, nes-layer;desc="L1", nes-l2;desc="named"$/,
    );
  });

  it("purge pełny podbija wersję w NAZWANYM cache'u - świeży izolat nie dostaje starego wpisu", async () => {
    const named = memoryCache();
    vi.stubGlobal("caches", { default: inertCache(), open: async () => named });
    const render = vi.fn(() => htmlResponse("<html>v1</html>"));

    await (await renderThroughEdge("/wpis", render)).text();
    await vi.waitFor(() => expect(l2Stats().stores).toBe(1));

    purgeDocumentCache("tenant-a.eu");
    await vi.waitFor(() => expect(l2Stats().bumps).toBe(1));
    expect(named.urls().some((url) => url.includes("/__nes/version/tenant-a.eu"))).toBe(true);

    rotateIsolate();
    const after = await renderThroughEdge("/wpis", render);
    expect(after.headers.get(NES_CACHE_HEADER)).toBe("MISS");
    expect(render).toHaveBeenCalledTimes(2);
    // Domknięcie zapisu, żeby nie wylądował w magazynie następnego testu.
    await after.text();
    await vi.waitFor(() => expect(l2Stats().stores).toBe(1));
  });

  it("klucz dokumentu niesie segment buildu (poza buildem: stały napis `dev`)", async () => {
    const named = memoryCache();
    vi.stubGlobal("caches", { default: inertCache(), open: async () => named });

    await (await renderThroughEdge("/klucz", () => htmlResponse("<html>k</html>"))).text();
    await vi.waitFor(() => expect(l2Stats().stores).toBe(1));

    const docKeys = named.urls().filter((url) => url.includes("/__nes/doc/"));
    expect(docKeys).toHaveLength(1);
    expect(docKeys[0]).toMatch(/\/__nes\/doc\/dev\/0\/0\//);
    expect(l2Stats().build).toBe("dev");
  });
});

describe("`caches.open` niedostępne: powrót do `caches.default`", () => {
  it.each([
    ["odrzuca obietnicę", async () => Promise.reject(new Error("disabled"))],
    [
      "rzuca synchronicznie",
      () => {
        throw new Error("disabled");
      },
    ],
    ["zwraca nie-cache", async () => ({ match: 1 })],
  ])(
    "`open` %s, a martwy default oblewa samotest: `verified: false`, L2 wyłączone w izolacie",
    async (_label, open) => {
      const fallback = inertCache();
      vi.stubGlobal("caches", { default: fallback, open });
      const render = vi.fn(() => htmlResponse("<html>render</html>"));

      await (await renderThroughEdge("/martwe", render)).text();
      await vi.waitFor(() => expect(l2Stats().verified).toBe(false));
      expect(l2Stats()).toMatchObject({ enabled: false, verified: false, store: "default" });
      expect(getColoCache()).toBeNull();
      expect(getDocumentCacheSnapshot().l2).toMatchObject({ enabled: false, verified: false });

      // Po samoteście żaden MISS nie płaci już za odczyty martwego magazynu.
      const touched = fallback.match.mock.calls.length + fallback.put.mock.calls.length;
      resetDocumentCacheForTests();
      const miss = await renderThroughEdge("/martwe", render);
      expect(miss.headers.get(NES_CACHE_HEADER)).toBe("MISS");
      expect(miss.headers.get("server-timing")).toMatch(/nes-l2;desc="off"$/);
      await miss.text();
      expect(fallback.match.mock.calls.length + fallback.put.mock.calls.length).toBe(touched);
      // L1 działa bez zmian: kolejne żądanie tego izolatu to HIT z pamięci.
      const hit = await renderThroughEdge("/martwe", render);
      expect(hit.headers.get(NES_CACHE_HEADER)).toBe("HIT");
      expect(hit.headers.get("server-timing")).toContain('nes-layer;desc="L1"');
    },
  );

  it("`open` rzuca, a działający default przechodzi samotest i niesie wpis kolonii", async () => {
    const fallback = memoryCache();
    vi.stubGlobal("caches", {
      default: fallback,
      open: async () => {
        throw new Error("disabled");
      },
    });
    const render = vi.fn(() => htmlResponse("<html>default</html>"));

    await (await renderThroughEdge("/zapas", render)).text();
    await vi.waitFor(() => expect(l2Stats().verified).toBe(true));
    await vi.waitFor(() => expect(l2Stats().stores).toBe(1));
    expect(l2Stats()).toMatchObject({ enabled: true, store: "default" });

    rotateIsolate();
    const hit = (await handleDocumentRequest(docRequest("/zapas"), render)) as Response;
    expect(hit.headers.get(NES_CACHE_HEADER)).toBe("HIT");
    expect(hit.headers.get("server-timing")).toContain('nes-layer;desc="L2"');
    expect(render).toHaveBeenCalledTimes(1);
  });
});

describe("runtime bez `caches.open`: zachowanie sprzed zmiany", () => {
  it("`caches.default` wprost, bez fasady, bez samotestu i bez metryki `nes-l2`", async () => {
    const fallback = memoryCache();
    vi.stubGlobal("caches", { default: fallback });
    const render = vi.fn(() => htmlResponse("<html>dawniej</html>"));

    expect(getColoCache()).toBe(fallback);
    const miss = await renderThroughEdge("/dawniej", render);
    expect(miss.headers.get("server-timing")).not.toContain("nes-l2");
    await miss.text();
    await vi.waitFor(() => expect(l2Stats().stores).toBe(1));
    expect(l2Stats()).toMatchObject({ enabled: true, verified: null, store: "default" });
    expect(selfTestUrls(fallback.urls())).toHaveLength(0);

    rotateIsolate();
    const hit = (await handleDocumentRequest(docRequest("/dawniej"), render)) as Response;
    expect(hit.headers.get(NES_CACHE_HEADER)).toBe("HIT");
    expect(hit.headers.get("server-timing")).toContain('nes-layer;desc="L2"');
  });

  it("bez `globalThis.caches` (Node, vitest) L2 to no-op i brak metryki `nes-l2`", async () => {
    expect(getColoCache()).toBeNull();
    const miss = await renderThroughEdge("/node", () => htmlResponse("<html>node</html>"));
    expect(miss.headers.get("server-timing")).not.toContain("nes-l2");
    await miss.text();
    expect(l2Stats()).toMatchObject({ enabled: false, verified: null, store: null });
  });
});
