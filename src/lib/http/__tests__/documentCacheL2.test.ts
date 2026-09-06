import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NES_CACHE_HEADER } from "@/lib/http/documentCache";
import {
  bumpL2Version,
  l2Match,
  l2Put,
  setColoCacheForTests,
  type ColoCache,
} from "@/lib/http/documentCacheL2.server";
import {
  applyDeferredDocumentStore,
  getDocumentCacheSnapshot,
  handleDocumentRequest,
  purgeDocumentCache,
  resetDocumentCacheForTests,
} from "@/lib/http/documentCache.server";

/** Wierny funkcjonalnie zamiennik `caches.default`: mapa URL -> Response. */
function memoryColoCache(): ColoCache & { size(): number } {
  const entries = new Map<string, { body: Uint8Array; headers: Headers }>();
  return {
    async match(request: Request) {
      const hit = entries.get(request.url);
      if (!hit) return undefined;
      return new Response(hit.body.slice(), { headers: new Headers(hit.headers) });
    },
    async put(request: Request, response: Response) {
      entries.set(request.url, {
        body: new Uint8Array(await response.arrayBuffer()),
        headers: new Headers(response.headers),
      });
    },
    size: () => entries.size,
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

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

const ENTRY = {
  contentType: "text/html; charset=utf-8",
  cacheControl: "public, max-age=60, s-maxage=900, stale-while-revalidate=86400",
  contentLanguage: "pl",
  link: null,
  freshMs: 180_000,
  swrMs: 3_600_000,
};

beforeEach(() => {
  resetDocumentCacheForTests();
  setColoCacheForTests(memoryColoCache());
});

afterEach(() => {
  setColoCacheForTests(undefined);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("documentCacheL2 (Cache API per-colo)", () => {
  it.each([null, { match: 1, put() {} }, { match() {}, put: 1 }])(
    "degrades safely with an unsupported runtime cache: %j",
    async (runtimeCache) => {
      setColoCacheForTests(undefined);
      vi.stubGlobal("caches", { default: runtimeCache });
      expect(await l2Match(null, "no-host::/x")).toBeNull();
    },
  );
  it.each(["v2", "  "])(
    "reads persisted version %j and tolerates absent optional response metadata",
    async (version) => {
      const match = vi.fn(async (request: Request) =>
        request.url.includes("/__nes/version")
          ? new Response(version)
          : new Response("body", {
              headers: {
                "x-nes-l2-stored-at": String(Date.now()),
                "x-nes-l2-fresh-ms": "1000",
                "x-nes-l2-swr-ms": "2000",
              },
            }),
      );
      setColoCacheForTests(undefined);
      vi.stubGlobal("caches", { default: { match, put: async () => {} } });
      const result = await l2Match(null, "no-host::/x");
      expect(result).toMatchObject({ contentType: "text/html; charset=utf-8", cacheControl: "" });
      const key = match.mock.calls.at(-1)![0].url;
      expect(key).toContain(version.trim() || "0");
      expect(match.mock.calls.filter(([r]) => r.url.includes("/__nes/version"))).toHaveLength(2);
    },
  );
  it.each(["x-nes-l2-stored-at", "x-nes-l2-fresh-ms", "x-nes-l2-swr-ms"])(
    "rejects corrupt numeric metadata %s",
    async (header) => {
      setColoCacheForTests({
        put: async () => {},
        match: async (request) =>
          request.url.includes("/__nes/version")
            ? undefined
            : new Response("body", {
                headers: {
                  "x-nes-l2-stored-at": "100",
                  "x-nes-l2-fresh-ms": "1000",
                  "x-nes-l2-swr-ms": "1000",
                  [header]: "not-a-number",
                },
              }),
      });
      expect(await l2Match("tenant-a.eu", "tenant-a.eu::/x")).toBeNull();
    },
  );
  it("zapisuje i odczytuje wpis dokumentu z metadanymi świeżości", async () => {
    const body = new TextEncoder().encode("<html>colo</html>");
    await l2Put("tenant-a.eu", "tenant-a.eu::/x", { ...ENTRY, body, storedAt: Date.now() });
    const hit = await l2Match("tenant-a.eu", "tenant-a.eu::/x");
    expect(hit).not.toBeNull();
    expect(new TextDecoder().decode(hit!.body)).toBe("<html>colo</html>");
    expect(hit!.freshMs).toBe(ENTRY.freshMs);
    expect(hit!.contentLanguage).toBe("pl");
    expect(hit!.link).toBeNull();
  });

  it("utrwala nagłówek Link wpisu (preload LCP) w metadanych L2", async () => {
    const body = new TextEncoder().encode("<html>hero</html>");
    const link = '<https://cdn/cover.jpg>; rel="preload"; as="image"; fetchpriority=high';
    await l2Put("tenant-a.eu", "tenant-a.eu::/hero", {
      ...ENTRY,
      link,
      body,
      storedAt: Date.now(),
    });
    const hit = await l2Match("tenant-a.eu", "tenant-a.eu::/hero");
    expect(hit).not.toBeNull();
    expect(hit!.link).toBe(link);
  });

  it("bump wersji hosta unieważnia wpisy hosta, nie ruszając innych tenantów", async () => {
    const body = new TextEncoder().encode("x");
    await l2Put("tenant-a.eu", "tenant-a.eu::/x", { ...ENTRY, body, storedAt: Date.now() });
    await l2Put("tenant-b.eu", "tenant-b.eu::/x", { ...ENTRY, body, storedAt: Date.now() });

    await bumpL2Version("tenant-a.eu");
    expect(await l2Match("tenant-a.eu", "tenant-a.eu::/x")).toBeNull();
    expect(await l2Match("tenant-b.eu", "tenant-b.eu::/x")).not.toBeNull();
  });

  it("globalny bump unieważnia wpisy wszystkich hostów", async () => {
    const body = new TextEncoder().encode("x");
    await l2Put("tenant-a.eu", "tenant-a.eu::/x", { ...ENTRY, body, storedAt: Date.now() });
    await bumpL2Version(null);
    expect(await l2Match("tenant-a.eu", "tenant-a.eu::/x")).toBeNull();
  });

  it("degraduje do no-op, gdy Cache API jest niedostępne (poza Workers)", async () => {
    setColoCacheForTests(null);
    const body = new TextEncoder().encode("x");
    await expect(
      l2Put("tenant-a.eu", "tenant-a.eu::/x", { ...ENTRY, body, storedAt: Date.now() }),
    ).resolves.toBeUndefined();
    expect(await l2Match("tenant-a.eu", "tenant-a.eu::/x")).toBeNull();
  });
});

describe("handleDocumentRequest z warstwą L2", () => {
  it("świeży izolat (pusty L1) serwuje HIT z wpisu kolonii bez renderu", async () => {
    const next = vi.fn(async () => htmlResponse("<html>doc</html>"));
    const first = applyDeferredDocumentStore(
      (await handleDocumentRequest(docRequest("/wpis"), next)) as Response,
    );
    expect(first.headers.get(NES_CACHE_HEADER)).toBe("MISS");
    await first.text();
    await settle();

    // Symulacja rotacji izolatu: L1 znika, L2 (kolonia) zostaje.
    resetDocumentCacheForTests();

    const second = (await handleDocumentRequest(docRequest("/wpis"), next)) as Response;
    expect(second.headers.get(NES_CACHE_HEADER)).toBe("HIT");
    expect(await second.text()).toBe("<html>doc</html>");
    expect(next).toHaveBeenCalledTimes(1);
    expect(getDocumentCacheSnapshot().l2.hits).toBe(1);
    // Trafienie L2 zasiewa L1: kolejne żądanie nie dotyka już Cache API.
    expect(getDocumentCacheSnapshot().entries).toBe(1);
  });

  it("purge hosta bumpuje wersję L2 - świeży izolat nie dostanie starego wpisu", async () => {
    const next = vi.fn(async () => htmlResponse("<html>v1</html>"));
    const miss = applyDeferredDocumentStore(
      (await handleDocumentRequest(docRequest("/wpis"), next)) as Response,
    );
    await miss.text();
    await settle();

    purgeDocumentCache("tenant-a.eu");
    await settle();
    resetDocumentCacheForTests();

    const after = (await handleDocumentRequest(docRequest("/wpis"), next)) as Response;
    expect(after.headers.get(NES_CACHE_HEADER)).toBe("MISS");
    expect(next).toHaveBeenCalledTimes(2);
  });

  it("wpis L2 w oknie SWR: pierwsi czytelnicy dostają STALE, jeden płaci render", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const next = vi.fn(async () => htmlResponse("<html>old</html>"));
    const miss = applyDeferredDocumentStore(
      (await handleDocumentRequest(docRequest("/wpis"), next)) as Response,
    );
    await miss.text();
    await vi.waitFor(() => {
      expect(getDocumentCacheSnapshot().entries).toBe(1);
    });

    // Rotacja izolatu + upływ czasu poza świeżość (cap 3 min), w oknie SWR.
    resetDocumentCacheForTests();
    vi.setSystemTime(Date.now() + 10 * 60 * 1000);

    const failingNext = vi.fn(async () => {
      throw new Error("db hiccup");
    });
    const res = (await handleDocumentRequest(docRequest("/wpis"), failingNext)) as Response;
    expect(res.headers.get(NES_CACHE_HEADER)).toBe("STALE");
    expect(await res.text()).toBe("<html>old</html>");
    expect(getDocumentCacheSnapshot().l2.stale).toBe(1);
  });

  it("emituje Server-Timing z czasem renderu na ścieżce MISS", async () => {
    const next = vi.fn(async () => htmlResponse("<html>t</html>"));
    const res = (await handleDocumentRequest(docRequest("/wpis"), next)) as Response;
    const serverTiming = res.headers.get("server-timing") ?? "";
    expect(serverTiming).toContain('nes-edge;desc="MISS"');
    expect(serverTiming).toMatch(/ssr;dur=\d+(\.\d+)?/);
  });
});
