// @vitest-environment node
// ZDJĘCIE I PRZEKIEROWANIE TREŚCI W KOLONII BEZ PURGE'A (fala 3, P3.6a, MAJOR-2 recenzji).
//
// Purge publikacji działa w kolonii, która go obsłużyła. W pozostałych pierwsze trafienie po
// świeżości podaje stary dokument jako STALE i odpala odświeżenie w tle. Gdy treść zdjęto albo
// przeniesiono, odświeżenie kończy się 404/410/3xx bez zapisu - i dotąd wpis zostawał STALE do
// końca okna swr (do doby), a KAŻDY kolejny czytelnik tej kolonii dostawał zdjęty dokument.
// Teraz ostateczne 404/410/3xx odświeżenia usuwa wpis z L1 i z L2 kolonii (`l2Delete`).
//
// Suita przechodzi PRAWDZIWY potok: `src/server.ts` (driver rewalidacji, odroczony zapis, linia
// logu) -> `handleDocumentRequest` -> render podstawiany przez test, nad funkcjonalnym nazwanym
// cache'em kolonii (`caches.open`). Atrapą jest tylko wirtualne entry frameworka.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DocumentRevalidator } from "../documentCache.server";

const hoisted = vi.hoisted(() => ({
  render: null as null | ((request: Request) => Response | Promise<Response>),
  revalidator: null as DocumentRevalidator | null,
  /** Praca „za odpowiedzią" - test ją domyka, zanim sprawdzi magazyny. */
  work: [] as Promise<unknown>[],
}));

vi.mock("@/lib/http/waitUntil.server", () => ({
  runAfterResponse: (work: Promise<unknown>): void => {
    hoisted.work.push(work);
    void work.catch(() => undefined);
  },
}));

vi.mock("../requestHost", () => ({
  trustedPublicHost: async (request: Request) => new URL(request.url).hostname,
  currentTenantHost: async () => "tenant-a.eu",
}));

vi.mock("@tanstack/react-start/server-entry", async () => {
  const cache = await import("@/lib/http/documentCache.server");
  return {
    default: {
      fetch: (request: Request) =>
        cache.handleDocumentRequest(request, () => {
          if (!hoisted.render) throw new Error("test nie ustawił renderu");
          return hoisted.render(request);
        }),
    },
  };
});

vi.mock("@/lib/http/documentCache.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/http/documentCache.server")>();
  return {
    ...actual,
    setDocumentRevalidator: (revalidator: DocumentRevalidator | null): void => {
      hoisted.revalidator = revalidator;
      actual.setDocumentRevalidator(revalidator);
    },
  };
});

const { default: serverEntry } = await import("../../../server");
const {
  getDocumentCacheSnapshot,
  probeDocumentCache,
  resetDocumentCacheForTests,
  setDocumentRevalidator,
} = await import("../documentCache.server");
const { setColoCacheForTests } = await import("../documentCacheL2.server");

const MINUTE = 60_000;
const CACHEABLE = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "public, max-age=60, s-maxage=900, stale-while-revalidate=86400",
};
const NO_STORE_HTML = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "private, no-store",
};

/** Funkcjonalny nazwany cache kolonii (mapa URL -> odpowiedź) z rejestrem `delete`. */
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
    docUrls: () => [...entries.keys()].filter((url) => url.includes("/__nes/doc/")),
  };
}

let colo: ReturnType<typeof memoryCache>;

/** Domknij pracę w tle (zapis L2, odświeżenie, `l2Delete`, linie logu), także dosypywaną. */
async function drain(): Promise<void> {
  for (let round = 0; round < 20; round += 1) {
    const pending = hoisted.work.splice(0);
    if (pending.length === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (hoisted.work.length === 0) return;
      continue;
    }
    await Promise.all(pending.map((work) => work.catch(() => undefined)));
  }
}

async function visit(
  path: string,
): Promise<{ status: number; cache: string | null; body: string }> {
  const response = await serverEntry.fetch(
    new Request(`https://tenant-a.eu${path}`, {
      headers: { accept: "text/html", "x-forwarded-host": "tenant-a.eu" },
    }),
  );
  return {
    status: response.status,
    cache: response.headers.get("x-nes-cache"),
    body: await response.text(),
  };
}

/** Wpis z L1 i L2 kolonii, przesunięty poza świeżość (cap 3 min), w oknie swr. */
async function seedStale(path: string, body: string): Promise<void> {
  hoisted.render = () => new Response(body, { headers: CACHEABLE });
  expect((await visit(path)).cache).toBe("MISS");
  await drain();
  expect(colo.docUrls()).toHaveLength(1);
  vi.setSystemTime(Date.now() + 10 * MINUTE);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.spyOn(console, "log").mockImplementation(() => {});
  colo = memoryCache();
  vi.stubGlobal("caches", { default: memoryCache(), open: vi.fn(async () => colo) });
  resetDocumentCacheForTests();
  setColoCacheForTests(undefined);
  // `resetDocumentCacheForTests` zdejmuje driver - przywróć ten z `src/server.ts`.
  setDocumentRevalidator(hoisted.revalidator);
  hoisted.work.length = 0;
});

afterEach(async () => {
  await drain();
  hoisted.render = null;
  setColoCacheForTests(undefined);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("ostateczne 404/410/3xx odświeżenia usuwa wpis z L1 i L2", () => {
  it.each([
    [
      "404 (zdjęcie)",
      () => new Response("<html>nie ma</html>", { status: 404, headers: NO_STORE_HTML }),
    ],
    [
      "410 (usunięcie)",
      () => new Response("<html>gone</html>", { status: 410, headers: NO_STORE_HTML }),
    ],
    [
      "301 (nowy adres)",
      () => new Response(null, { status: 301, headers: { location: "/nowy-adres" } }),
    ],
    [
      "307 (przekierowanie trasy)",
      () => new Response(null, { status: 307, headers: { location: "/category/x" } }),
    ],
  ])("%s", async (_label, gone) => {
    expect(hoisted.revalidator).toBeTypeOf("function");
    await seedStale("/wpis", "<html>zdjety wpis</html>");

    // Pierwsze trafienie po świeżości: stary dokument jeszcze raz (STALE), odświeżenie w tle.
    hoisted.render = gone;
    const stale = await visit("/wpis");
    expect(stale).toMatchObject({ cache: "STALE", body: "<html>zdjety wpis</html>" });
    await drain();

    // Wpis zniknął z L1 tego izolatu i z L2 kolonii.
    expect(await probeDocumentCache("/wpis", "tenant-a.eu")).toMatchObject({ cached: false });
    expect(colo.delete).toHaveBeenCalledTimes(1);
    expect(colo.docUrls()).toEqual([]);
    const snapshot = getDocumentCacheSnapshot();
    expect(snapshot.goneEvictions).toBe(1);
    expect(snapshot.recent.some((decision) => decision.evicted === true)).toBe(true);

    // Kolejny czytelnik dostaje odpowiedź renderu, nie zdjęty dokument.
    const next = await visit("/wpis");
    expect(next.cache).toBe("MISS");
    expect(next.body).not.toContain("zdjety wpis");

    // Inny izolat tej kolonii też już nie ma czego podać.
    resetDocumentCacheForTests();
    setColoCacheForTests(undefined);
    setDocumentRevalidator(hoisted.revalidator);
    expect((await visit("/wpis")).cache).toBe("MISS");
  });
});

describe("odświeżenie bez ostatecznego wyniku zostawia wpis STALE", () => {
  it.each([
    [
      "zdegradowany render 200 `private, no-store`",
      () => new Response("<html>fallback</html>", { headers: NO_STORE_HTML }),
    ],
    [
      "błąd 503",
      () => new Response("<html>awaria</html>", { status: 503, headers: NO_STORE_HTML }),
    ],
    ["304 bez treści", () => new Response(null, { status: 304 })],
  ])("%s", async (_label, outcome) => {
    await seedStale("/analiza", "<html>poprawny</html>");
    hoisted.render = outcome;
    expect((await visit("/analiza")).cache).toBe("STALE");
    await drain();

    expect(colo.delete).not.toHaveBeenCalled();
    expect(colo.docUrls()).toHaveLength(1);
    expect(getDocumentCacheSnapshot().goneEvictions).toBe(0);
    expect(await visit("/analiza")).toMatchObject({
      cache: "STALE",
      body: "<html>poprawny</html>",
    });
  });

  it("render, który rzuca, nie usuwa wpisu", async () => {
    await seedStale("/raport", "<html>poprawny</html>");
    hoisted.render = () => {
      throw new Error("baza leży");
    };
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await visit("/raport")).cache).toBe("STALE");
    await drain();
    expect(colo.delete).not.toHaveBeenCalled();
    expect(colo.docUrls()).toHaveLength(1);
  });
});

describe("zasada dotyczy wyłącznie odświeżenia ISTNIEJĄCEGO wpisu", () => {
  it("zwykły MISS z 404 (np. skaner) nie dotyka Cache API", async () => {
    hoisted.render = () =>
      new Response("<html>nie ma</html>", { status: 404, headers: NO_STORE_HTML });
    expect((await visit("/wp-login")).status).toBe(404);
    await drain();
    expect(colo.delete).not.toHaveBeenCalled();
    expect(getDocumentCacheSnapshot().goneEvictions).toBe(0);
  });

  it("bez drivera (render synchroniczny po STALE) 404 też usuwa wpis", async () => {
    await seedStale("/archiwum", "<html>stary</html>");
    setDocumentRevalidator(null);
    hoisted.render = () =>
      new Response("<html>nie ma</html>", { status: 404, headers: NO_STORE_HTML });
    // Czytelnik płaci render synchronicznie i dostaje jego wynik.
    expect(await visit("/archiwum")).toMatchObject({ status: 404, cache: "MISS" });
    await drain();
    expect(colo.docUrls()).toEqual([]);
    expect(await probeDocumentCache("/archiwum", "tenant-a.eu")).toMatchObject({ cached: false });
  });
});
