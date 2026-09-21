// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  rows: { tenants: [] as unknown[], redirects: [] as unknown[] },
  from: vi.fn(),
  background: [] as Promise<unknown>[],
}));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: h.from } }));
vi.mock("@/lib/http/waitUntil.server", () => ({
  runAfterResponse: (work: Promise<unknown>) => h.background.push(work),
}));
const entries = new Map<string, Response>();
const tenant = { id: "tenant-a", slug: "a", domain: "a.example", is_default: true };
const rule = { id: "r-a", source_path: "/old", target_path: "/new", status_code: 301 };

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv("SUPABASE_URL", "https://routing.supabase.co");
  entries.clear();
  h.background = [];
  h.rows = { tenants: [tenant], redirects: [rule] };
  h.from.mockImplementation((table: keyof typeof h.rows) => {
    const query = {
      select: () => query,
      eq: () => query,
      limit: async () => ({ data: h.rows[table], error: null }),
    };
    return query;
  });
  vi.stubGlobal("caches", {
    default: {
      match: async (request: Request) => entries.get(request.url)?.clone(),
      put: async (request: Request, response: Response) => {
        entries.set(request.url, response.clone());
      },
    },
  });
});
afterEach(async () => {
  await Promise.all(h.background);
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("first document on a new Worker", () => {
  it("backs off database retries without publishing stale data as fresh in L2", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-06T12:00:00Z"));
    const redirects = await import("@/lib/seo/redirects.server");
    const request = new Request("https://a.example/old");
    await redirects.resolveRedirectForRequest(request);
    await Promise.all(h.background);
    const snapshots = [...entries.values()].map((entry) => entry.clone().text());
    h.from.mockImplementation(() => {
      throw new Error("database unavailable");
    });
    vi.advanceTimersByTime(60_000);
    expect(await redirects.resolveRedirectForRequest(request)).toEqual({
      target: "/new",
      status: 301,
    });
    await Promise.all(h.background);
    const calls = h.from.mock.calls.length;
    expect(await redirects.resolveRedirectForRequest(request)).toEqual({
      target: "/new",
      status: 301,
    });
    expect(h.from.mock.calls).toHaveLength(calls);
    expect(await Promise.all([...entries.values()].map((entry) => entry.clone().text()))).toEqual(
      await Promise.all(snapshots),
    );
  });

  it.each([
    null,
    {},
    [null],
    [{ id: 12 }],
    [{ id: "x", slug: 12 }],
    [{ id: "x", slug: "x", domain: 12, isDefault: true }],
    [{ id: "x", slug: "x", domain: null, isDefault: "yes" }],
    Array(501).fill(tenant),
  ])(
    "rejects an invalid shared tenant directory and reloads the database (case %#)",
    async (value) => {
      const snapshots = await import("@/lib/http/bootstrapCache.server");
      await snapshots.writeBootstrapSnapshot("tenants", { at: Date.now(), value }, 60_000);
      const tenants = await import("@/lib/server/tenant.server");
      expect((await tenants.getTenantDirectory()).defaultTenant?.id).toBe("tenant-a");
      expect(h.from).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    null,
    {},
    [null],
    [{ id: 12 }],
    [{ id: "x", source_path: 12 }],
    [{ id: "x", source_path: "/x", target_path: 12 }],
    [{ ...rule, status_code: "301" }],
    [{ ...rule, status_code: 200 }],
    Array(5001).fill(rule),
  ])("rejects malformed shared redirect rules (case %#)", async (value) => {
    const snapshots = await import("@/lib/http/bootstrapCache.server");
    await snapshots.writeBootstrapSnapshot("redirects:tenant-a", { at: Date.now(), value }, 30_000);
    const redirects = await import("@/lib/seo/redirects.server");
    expect(await redirects.resolveRedirectForRequest(new Request("https://a.example/old"))).toEqual(
      { target: "/new", status: 301 },
    );
    expect(h.from).toHaveBeenCalledTimes(2);
  });

  it("restores the same tenant and redirect without either database round trip", async () => {
    const first = await import("@/lib/seo/redirects.server");
    const request = new Request("https://a.example/old");
    expect(await first.resolveRedirectForRequest(request)).toEqual({ target: "/new", status: 301 });
    await Promise.all(h.background);
    expect(h.from).toHaveBeenCalledTimes(2);

    vi.resetModules(); // New isolate; only the colo cache survives.
    h.from.mockClear();
    const next = await import("@/lib/seo/redirects.server");
    expect(await next.resolveRedirectForRequest(request)).toEqual({ target: "/new", status: 301 });
    expect(h.from).not.toHaveBeenCalled();
    const tenants = await import("@/lib/server/tenant.server");
    expect(
      await tenants.resolveTrustedRequestHost(new Request("https://unknown.example/")),
    ).toBeNull();
  });

  it("keeps explicit invalidation effective while a shared snapshot is fresh", async () => {
    const tenants = await import("@/lib/server/tenant.server");
    const redirects = await import("@/lib/seo/redirects.server");
    await redirects.resolveRedirectForRequest(new Request("https://a.example/old"));
    await Promise.all(h.background);
    h.rows.tenants = [{ ...tenant, domain: "b.example" }];
    h.rows.redirects = [{ ...rule, target_path: "/updated" }];
    tenants.invalidateTenantDirectoryCache();
    redirects.invalidateRedirectCache();
    expect(await tenants.resolveTrustedRequestHost(new Request("https://a.example/"))).toBeNull();
    expect(await redirects.resolveRedirectForRequest(new Request("https://b.example/old"))).toEqual(
      { target: "/updated", status: 301 },
    );
    expect(h.from).toHaveBeenCalledTimes(4);
  });

  // ŚWIEŻOŚĆ vs PRZETRWANIE (audyt F01). Do 2026-09-20 migawka umierała
  // razem z TTL (60 s / 30 s), więc po dłuższej ciszy zimny izolat płacił dwa
  // SZEREGOWE odczyty planu service-role (po 1 500 ms terminu) PRZED cache
  // dokumentów - także na trafieniu. Teraz nieświeża migawka serwuje od ręki,
  // a odświeżenie biegnie za odpowiedzią.
  describe("cold isolate after a long silence (stale shared snapshot)", () => {
    const SILENCE_MS = 6 * 60 * 60 * 1000;

    /** Rozstrzygnięcie jako FLAGA - `await` na wiszącej obietnicy zawiesiłby przebieg. */
    function watch<T>(promise: Promise<T>): { settled: () => boolean; value: () => T | undefined } {
      let done = false;
      let result: T | undefined;
      void promise.then((value) => {
        done = true;
        result = value;
      });
      return { settled: () => done, value: () => result };
    }

    async function warmSnapshots(): Promise<void> {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-09-06T12:00:00Z"));
      const first = await import("@/lib/seo/redirects.server");
      await first.resolveRedirectForRequest(new Request("https://a.example/old"));
      await Promise.all(h.background);
      expect(h.from).toHaveBeenCalledTimes(2);
      vi.advanceTimersByTime(SILENCE_MS);
      vi.resetModules(); // Nowy izolat; przeżywa wyłącznie Cache API kolonii.
      h.from.mockClear();
      h.background = [];
    }

    it("answers from the stale snapshot with ZERO blocking database reads", async () => {
      await warmSnapshots();
      // Baza WISI. Gdyby zimny izolat na nią czekał, ta odpowiedź nigdy by nie
      // wróciła - to jest kontrola negatywna „zero blokującego odczytu".
      h.from.mockImplementation(() => {
        const query = {
          select: () => query,
          eq: () => query,
          limit: () => new Promise(() => {}),
        };
        return query;
      });
      const next = await import("@/lib/seo/redirects.server");
      const pending = watch(next.resolveRedirectForRequest(new Request("https://a.example/old")));
      await vi.advanceTimersByTimeAsync(0);
      expect(pending.settled(), "odpowiedź musi wrócić bez czekania na bazę").toBe(true);
      expect(pending.value()).toEqual({ target: "/new", status: 301 });
      // Odświeżenie WYSTARTOWAŁO za odpowiedzią (katalog + indeks), nie przed nią.
      expect(h.from).toHaveBeenCalledTimes(2);
      // Tło domyka się terminem planu service-role, nie na ścieżce czytelnika,
      // a zejście po terminie zostawia nieświeży katalog zamiast pustego.
      await vi.advanceTimersByTimeAsync(1_501);
      await Promise.all(h.background);
      const tenants = await import("@/lib/server/tenant.server");
      expect((await tenants.resolveTenantForHost("a.example"))?.id).toBe("tenant-a");
    });

    it("refreshes both snapshots behind the response and republishes them with a new `at`", async () => {
      await warmSnapshots();
      const before = new Map<string, number>();
      for (const [key, entry] of entries) {
        before.set(key, ((await entry.clone().json()) as { at: number }).at);
      }
      h.rows.redirects = [{ ...rule, target_path: "/renewed" }];

      const next = await import("@/lib/seo/redirects.server");
      const request = new Request("https://a.example/old");
      // Pierwsza odpowiedź: nieświeże reguły, od ręki.
      expect(await next.resolveRedirectForRequest(request)).toEqual({
        target: "/new",
        status: 301,
      });
      await Promise.all(h.background);
      expect(h.from).toHaveBeenCalledTimes(2);
      // Druga: już po odświeżeniu w tle - bez kolejnego round-tripu.
      expect(await next.resolveRedirectForRequest(request)).toEqual({
        target: "/renewed",
        status: 301,
      });
      expect(h.from).toHaveBeenCalledTimes(2);
      // Migawki w kolonii mają nowy znacznik czasu - następny zimny izolat
      // dostanie je ŚWIEŻE, a `max-age` znów obejmuje pełną dobę.
      for (const [key, entry] of entries) {
        expect(((await entry.clone().json()) as { at: number }).at).toBe(Date.now());
        expect(before.get(key)).toBe(Date.now() - SILENCE_MS);
        expect(entry.headers.get("cache-control")).toBe("public, max-age=86400");
      }
    });

    it("still blocks once and reads the database when the snapshot is older than a day", async () => {
      await warmSnapshots();
      vi.advanceTimersByTime(24 * 60 * 60 * 1000 - SILENCE_MS);
      const next = await import("@/lib/seo/redirects.server");
      expect(await next.resolveRedirectForRequest(new Request("https://a.example/old"))).toEqual({
        target: "/new",
        status: 301,
      });
      expect(h.from).toHaveBeenCalledTimes(2);
    });
  });

  it("does not extend freshness by copying a snapshot into a new isolate", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-06T12:00:00Z"));
    const first = await import("@/lib/server/tenant.server");
    await first.getTenantDirectory();
    await Promise.all(h.background);
    vi.advanceTimersByTime(59_000);
    vi.resetModules();
    const next = await import("@/lib/server/tenant.server");
    await next.getTenantDirectory();
    expect(h.from).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    await next.getTenantDirectory();
    await Promise.all(h.background);
    expect(h.from).toHaveBeenCalledTimes(2);
  });
});
