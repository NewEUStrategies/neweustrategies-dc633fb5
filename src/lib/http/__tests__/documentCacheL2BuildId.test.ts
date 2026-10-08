// IDENTYFIKATOR BUILDU W KLUCZU DOKUMENTU L2 (fala 3, P3.6a, R1 diagnozy `cache-dokumentu.md`).
//
// Do wdrożenia działającego L2 stary HTML nie przeżywał deployu, bo L1 żyje w pamięci izolatu,
// a nowy deploy to nowe izolaty. Wpis kolonii z oknem STALE do doby przeżywa deploy - bez buildu
// w kluczu czytelnik dostałby HTML wskazujący chunki i arkusz POPRZEDNIEGO buildu. Segment buildu
// to nazwa pliku wejścia klienta z `BOOT_MANIFEST.entry` (stała per build, hash treści); poza
// buildem stały napis, a build produkcyjny bez mapy bootu nie używa L2 dokumentów wcale.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BootManifest } from "@/lib/boot/bootManifest";
import {
  l2Delete,
  l2Match,
  l2Put,
  l2Stats,
  setColoCacheForTests,
  type ColoCache,
} from "@/lib/http/documentCacheL2.server";

const manifest = vi.hoisted(() => ({ current: null as BootManifest | null }));

vi.mock("@/lib/boot/bootManifest", () => ({
  get BOOT_MANIFEST() {
    return manifest.current;
  },
}));

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

function bootManifest(entry: string): BootManifest {
  return { entry, rootPreloads: [entry], routePreloads: {} };
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

/** Deploy = nowy izolat z nowym buildem nad TYM SAMYM magazynem kolonii. */
function deploy(colo: ColoCache, next: BootManifest | null): void {
  manifest.current = next;
  setColoCacheForTests(colo);
}

const docKeys = (colo: { urls(): string[] }) =>
  colo.urls().filter((url) => url.includes("/__nes/doc/"));

beforeEach(() => {
  vi.stubEnv("SSR", true);
});

afterEach(() => {
  manifest.current = null;
  setColoCacheForTests(undefined);
  vi.unstubAllEnvs();
});

describe("segment buildu w kluczu dokumentu L2", () => {
  it("bierze nazwę pliku wejścia klienta z mapy bootu", async () => {
    const colo = memoryColoCache();
    deploy(colo, bootManifest("/assets/index-BsLjjLsH.js"));

    await l2Put("tenant-a.eu", "tenant-a.eu::/", entry("<html>build A</html>"));

    expect(docKeys(colo)).toEqual([
      `https://nes-edge-cache.internal/__nes/doc/index-BsLjjLsH/0/0/${encodeURIComponent("tenant-a.eu::/")}`,
    ]);
    expect(l2Stats().build).toBe("index-BsLjjLsH");
    const hit = await l2Match("tenant-a.eu", "tenant-a.eu::/");
    expect(new TextDecoder().decode(hit!.body)).toBe("<html>build A</html>");
  });

  it("po deployu nowy build nie widzi HTML-a poprzedniego, a purge ścieżki trafia we własny wpis", async () => {
    const colo = memoryColoCache();
    deploy(colo, bootManifest("/assets/index-AAAAAAAA.js"));
    await l2Put("tenant-a.eu", "tenant-a.eu::/", entry("<html>stary build</html>"));

    deploy(colo, bootManifest("/assets/index-BBBBBBBB.js"));
    expect(await l2Match("tenant-a.eu", "tenant-a.eu::/")).toBeNull();

    await l2Put("tenant-a.eu", "tenant-a.eu::/", entry("<html>nowy build</html>"));
    const hit = await l2Match("tenant-a.eu", "tenant-a.eu::/");
    expect(new TextDecoder().decode(hit!.body)).toBe("<html>nowy build</html>");
    expect(await l2Delete("tenant-a.eu", "tenant-a.eu::/")).toBe(true);
    expect(await l2Match("tenant-a.eu", "tenant-a.eu::/")).toBeNull();
    // Wpis starego buildu jest nietknięty, ale nieosiągalny (wygaśnie TTL-em).
    expect(docKeys(colo).some((url) => url.includes("/index-AAAAAAAA/"))).toBe(true);
  });

  it("znaki spoza [A-Za-z0-9_-] w nazwie wejścia nie psują ścieżki klucza", async () => {
    const colo = memoryColoCache();
    deploy(colo, bootManifest("/assets/entry.v2+x.mjs"));
    await l2Put(null, "no-host::/x", entry("<html>x</html>"));
    expect(l2Stats().build).toBe("entry_v2_x");
    expect(docKeys(colo)[0]).toContain("/__nes/doc/entry_v2_x/");
  });

  it("build produkcyjny BEZ mapy bootu nie używa L2 dokumentów (brak stałego identyfikatora)", async () => {
    vi.stubEnv("PROD", true);
    const colo = memoryColoCache();
    deploy(colo, null);

    await l2Put("tenant-a.eu", "tenant-a.eu::/", entry("<html>bez buildu</html>"));
    expect(docKeys(colo)).toEqual([]);
    expect(await l2Match("tenant-a.eu", "tenant-a.eu::/")).toBeNull();
    expect(await l2Delete("tenant-a.eu", "tenant-a.eu::/")).toBe(false);
    expect(l2Stats()).toMatchObject({ build: null, stores: 0 });
  });

  it("poza buildem (vitest, dev) segment to stały napis `dev`, nie zegar", async () => {
    const colo = memoryColoCache();
    deploy(colo, null);
    await l2Put(null, "no-host::/a", entry("<html>a</html>"));
    // „Restart izolatu" w innej chwili: ten sam segment, wpis dalej osiągalny.
    deploy(colo, null);
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
