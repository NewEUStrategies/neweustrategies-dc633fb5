// @vitest-environment node
// TELEMETRIA L2 I DEGRADACJI W LINII `kind:"doc"` (fala 3, P3.6a, R7 b i c diagnozy
// `faza3/diagnoza/cache-dokumentu.md`).
//
// Hosting zdejmuje `Server-Timing` i `x-nes-cache`, więc linia logu dokumentu to jedyne miejsce,
// w którym da się potwierdzić działanie L2 i policzyć degradacje. Bez `l2Verified` brak
// `layer: "L2"` nie odróżnia martwego magazynu od braku wpisu, a samo `degraded: true` nie mówi,
// na którym etapie polityka zapisu odmówiła (`loader` / `handler` / `stream`). Suita idzie przez
// prawdziwy `src/server.ts` (atrapą jest tylko wirtualne entry frameworka).
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

const hoisted = vi.hoisted(() => ({
  render: null as null | ((request: Request) => Response | Promise<Response>),
  /** Dyrektywa zawężona ZA middleware cache'u (granica handlera). */
  tighten: false,
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
      fetch: async (request: Request) => {
        const result = await cache.handleDocumentRequest(request, () => {
          if (!hoisted.render) throw new Error("test nie ustawił renderu");
          return hoisted.render(request);
        });
        if (hoisted.tighten && result instanceof Response) {
          result.headers.set("cache-control", "private, no-store");
        }
        return result;
      },
    },
  };
});

const { default: serverEntry } = await import("../../../server");
const { resetDocumentCacheForTests } = await import("../documentCache.server");
const { setColoCacheForTests } = await import("../documentCacheL2.server");

const CACHEABLE = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "public, max-age=60, s-maxage=900, stale-while-revalidate=86400",
};

let log: MockInstance<typeof console.log>;

function docLines(): Record<string, unknown>[] {
  return log.mock.calls
    .map((call) => String(call[0]))
    .filter((line) => line.startsWith('{"kind":"doc"'))
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

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

async function visit(path: string): Promise<Record<string, unknown>> {
  const before = docLines().length;
  const response = await serverEntry.fetch(
    new Request(`https://tenant-a.eu${path}`, { headers: { "x-forwarded-host": "tenant-a.eu" } }),
  );
  await response.text();
  await drain();
  const lines = docLines();
  expect(lines).toHaveLength(before + 1);
  return lines[lines.length - 1]!;
}

function memoryCache() {
  const entries = new Map<string, { body: Uint8Array; headers: Headers }>();
  return {
    match: async (request: Request) => {
      const hit = entries.get(request.url);
      return hit
        ? new Response(hit.body.slice(), { headers: new Headers(hit.headers) })
        : undefined;
    },
    put: async (request: Request, response: Response) => {
      entries.set(request.url, {
        body: new Uint8Array(await response.arrayBuffer()),
        headers: new Headers(response.headers),
      });
    },
  };
}

/** Magazyn, który przyjmuje zapis i nic nie oddaje (jak martwe `caches.default` w produkcji). */
function inertCache() {
  return { match: async () => undefined, put: async () => {} };
}

beforeEach(() => {
  log = vi.spyOn(console, "log").mockImplementation(() => {});
  resetDocumentCacheForTests();
  setColoCacheForTests(undefined);
  hoisted.tighten = false;
  hoisted.work.length = 0;
});

afterEach(async () => {
  await drain();
  hoisted.render = null;
  setColoCacheForTests(undefined);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("R7c: etap degradacji w linii dokumentu", () => {
  it("czysty MISS nie ma etapu", async () => {
    hoisted.render = () => new Response("<html>ok</html>", { headers: CACHEABLE });
    const line = await visit("/czysty");
    expect(line).toMatchObject({ cache: "MISS", degraded: false, store: "stored" });
    expect(line).not.toHaveProperty("degradedAt");
  });

  it("`loader`: `private, no-store` widoczne już w middleware", async () => {
    hoisted.render = () =>
      new Response("<html>fallback</html>", {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "private, no-store",
        },
      });
    expect(await visit("/loader")).toMatchObject({
      cache: "MISS",
      degraded: true,
      degradedAt: "loader",
    });
  });

  it("`handler`: dyrektywa zawężona za middleware - decyzja magazynu `degraded` z etapem", async () => {
    hoisted.render = () => new Response("<html>ok</html>", { headers: CACHEABLE });
    hoisted.tighten = true;
    expect(await visit("/handler")).toMatchObject({
      cache: "MISS",
      degraded: true,
      degradedAt: "handler",
      store: "degraded",
    });
  });

  it("HIT nie ma ani `degraded`, ani etapu", async () => {
    hoisted.render = () => new Response("<html>ok</html>", { headers: CACHEABLE });
    await visit("/hit");
    const hit = await visit("/hit");
    expect(hit).toMatchObject({ cache: "HIT" });
    expect(hit).not.toHaveProperty("degraded");
    expect(hit).not.toHaveProperty("degradedAt");
  });
});

describe("R7b: wynik samotestu L2 izolatu w linii dokumentu", () => {
  it("bez Cache API (Node, harness) linia nie ma `l2Verified`", async () => {
    hoisted.render = () => new Response("<html>ok</html>", { headers: CACHEABLE });
    expect(await visit("/bez-l2")).not.toHaveProperty("l2Verified");
  });

  it("nazwany cache przeszedł samotest: `l2Verified: true`", async () => {
    vi.stubGlobal("caches", { default: inertCache(), open: async () => memoryCache() });
    hoisted.render = () => new Response("<html>ok</html>", { headers: CACHEABLE });
    // Pierwsze żądanie izolatu uruchamia samotest; jego wynik niesie już kolejna linia.
    await visit("/l2");
    expect(await visit("/l2-druga")).toMatchObject({ l2Verified: true });
  });

  it("magazyn, który nic nie oddaje, oblewa samotest: `l2Verified: false`", async () => {
    vi.stubGlobal("caches", { default: inertCache(), open: async () => inertCache() });
    hoisted.render = () => new Response("<html>ok</html>", { headers: CACHEABLE });
    await visit("/martwe");
    expect(await visit("/martwe-druga")).toMatchObject({ l2Verified: false });
  });
});
