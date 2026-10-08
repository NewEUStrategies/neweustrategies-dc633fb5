// IDENTYFIKATOR BUILDU W KLUCZU DOKUMENTU L2 (fala 3, P3.6a, R1 diagnozy `cache-dokumentu.md`).
//
// Do wdrożenia działającego L2 stary HTML nie przeżywał deployu, bo L1 żyje w pamięci izolatu,
// a nowy deploy to nowe izolaty. Wpis kolonii z oknem STALE do doby przeżywa deploy - bez buildu
// w kluczu czytelnik dostałby HTML wskazujący chunki i arkusz POPRZEDNIEGO buildu. Segment buildu
// to stała `__NES_BUILD_ID__` z `define` Vite (runda 10: zamiast dynamicznego importu mapy bootu,
// który przenosił chunk manifestu Start do `_ssr/`). Poza buildem stały napis `dev`, a build
// produkcyjny bez stałej nie używa L2 dokumentów wcale.
//
// Test podstawia stałą jako zmienną globalną: `define` zamienia identyfikator na literał tylko
// w buildzie, a w vitest wolny identyfikator czyta się z `globalThis` - dokładnie ta sama ścieżka
// odczytu (`typeof` + wartość), co w artefakcie po podstawieniu.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  l2BuildId,
  l2Delete,
  l2Match,
  l2Put,
  l2Stats,
  setColoCacheForTests,
  type ColoCache,
} from "@/lib/http/documentCacheL2.server";

/** Magazyn kolonii współdzielony przez „deploye" w teście (Cache API przeżywa wdrożenie). */
function memoryColoCache(): ColoCache & { urls(): string[] } {
  const entries = new Map<string, { body: Uint8Array; headers: Headers }>();
  return {
    async match(request: Request) {
      const hit = entries.get(request.url);
      return hit
        ? new Response(hit.body.slice(), { headers: new Headers(hit.headers) })
        : undefined;
    },
    async put(request: Request, response: Response) {
      entries.set(request.url, {
        body: new Uint8Array(await response.arrayBuffer()),
        headers: new Headers(response.headers),
      });
    },
    async delete(request: Request) {
      return entries.delete(request.url);
    },
    urls: () => [...entries.keys()],
  };
}

const ENTRY = {
  contentType: "text/html; charset=utf-8",
  cacheControl: "public, max-age=60, s-maxage=900, stale-while-revalidate=86400",
  contentLanguage: "pl",
  link: null,
  freshMs: 180_000,
  swrMs: 3_600_000,
};

function entry(html: string) {
  return { ...ENTRY, body: new TextEncoder().encode(html), storedAt: Date.now() };
}

/**
 * Deploy = nowy izolat z nową stałą buildu nad TYM SAMYM magazynem kolonii.
 * `undefined` = artefakt bez stałej (`define` nie zadziałał albo vitest).
 */
function deploy(colo: ColoCache, buildId: string | undefined): void {
  vi.stubGlobal("__NES_BUILD_ID__", buildId);
  setColoCacheForTests(colo);
}

const docKeys = (colo: { urls(): string[] }) =>
  colo.urls().filter((url) => url.includes("/__nes/doc/"));

beforeEach(() => {
  vi.stubEnv("SSR", true);
});

afterEach(() => {
  setColoCacheForTests(undefined);
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("segment buildu w kluczu dokumentu L2", () => {
  it("bierze identyfikator ze stałej `__NES_BUILD_ID__`", async () => {
    const colo = memoryColoCache();
    deploy(colo, "tmgi4x2k1");

    await l2Put("tenant-a.eu", "tenant-a.eu::/", entry("<html>build A</html>"));

    expect(docKeys(colo)).toEqual([
      `https://nes-edge-cache.internal/__nes/doc/tmgi4x2k1/0/0/${encodeURIComponent("tenant-a.eu::/")}`,
    ]);
    expect(l2Stats().build).toBe("tmgi4x2k1");
    const hit = await l2Match("tenant-a.eu", "tenant-a.eu::/");
    expect(new TextDecoder().decode(hit!.body)).toBe("<html>build A</html>");
  });

  it("po deployu nowy build nie widzi HTML-a poprzedniego, a purge ścieżki trafia we własny wpis", async () => {
    const colo = memoryColoCache();
    deploy(colo, "build-a");
    await l2Put("tenant-a.eu", "tenant-a.eu::/", entry("<html>stary build</html>"));
    // Ten sam build po „rotacji izolatu": wpis kolonii jest osiągalny.
    deploy(colo, "build-a");
    expect(await l2Match("tenant-a.eu", "tenant-a.eu::/")).not.toBeNull();

    deploy(colo, "build-b");
    expect(await l2Match("tenant-a.eu", "tenant-a.eu::/")).toBeNull();

    await l2Put("tenant-a.eu", "tenant-a.eu::/", entry("<html>nowy build</html>"));
    const hit = await l2Match("tenant-a.eu", "tenant-a.eu::/");
    expect(new TextDecoder().decode(hit!.body)).toBe("<html>nowy build</html>");
    expect(await l2Delete("tenant-a.eu", "tenant-a.eu::/")).toBe(true);
    expect(await l2Match("tenant-a.eu", "tenant-a.eu::/")).toBeNull();
    // Wpis starego buildu jest nietknięty, ale nieosiągalny (wygaśnie TTL-em).
    expect(docKeys(colo).some((url) => url.includes("/build-a/"))).toBe(true);
  });

  it("znaki spoza [A-Za-z0-9_-] nie psują ścieżki klucza, a długość ma sufit", async () => {
    const colo = memoryColoCache();
    deploy(colo, "v2.10+rc/1 ?#");
    await l2Put(null, "no-host::/x", entry("<html>x</html>"));
    expect(l2Stats().build).toBe("v2_10_rc_1___");
    expect(docKeys(colo)[0]).toContain("/__nes/doc/v2_10_rc_1___/");

    deploy(colo, "x".repeat(200));
    expect(l2BuildId()).toBe("x".repeat(64));
  });

  it("build produkcyjny BEZ stałej nie używa L2 dokumentów (brak stałego identyfikatora)", async () => {
    vi.stubEnv("PROD", true);
    const colo = memoryColoCache();
    deploy(colo, undefined);

    await l2Put("tenant-a.eu", "tenant-a.eu::/", entry("<html>bez buildu</html>"));
    expect(docKeys(colo)).toEqual([]);
    expect(await l2Match("tenant-a.eu", "tenant-a.eu::/")).toBeNull();
    expect(await l2Delete("tenant-a.eu", "tenant-a.eu::/")).toBe(false);
    expect(l2Stats()).toMatchObject({ build: null, stores: 0 });
  });

  it("stała pusta po przycięciu też nie jest identyfikatorem (PROD -> L2 dokumentów wyłączone)", () => {
    vi.stubEnv("PROD", true);
    deploy(memoryColoCache(), "");
    expect(l2BuildId()).toBeNull();
  });

  it("poza zakresem SSR stała jest ignorowana (w bundlu klienta gałąź znika)", () => {
    vi.stubEnv("SSR", false);
    deploy(memoryColoCache(), "build-a");
    expect(l2BuildId()).toBe("dev");
  });

  it("poza buildem (vitest) segment to stały napis `dev`, nie zegar", async () => {
    const colo = memoryColoCache();
    deploy(colo, undefined);
    await l2Put(null, "no-host::/a", entry("<html>a</html>"));
    // „Restart izolatu" w innej chwili: ten sam segment, wpis dalej osiągalny.
    deploy(colo, undefined);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 3_600_000);
    try {
      expect(await l2Match(null, "no-host::/a")).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
    expect(docKeys(colo)[0]).toContain("/__nes/doc/dev/");
  });
});
