// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BOOTSTRAP_SNAPSHOT_MAX_AGE_MS,
  readBootstrapSnapshot,
  writeBootstrapSnapshot,
} from "../bootstrapCache.server";
import { setColoCacheForTests } from "../documentCacheL2.server";

const isStrings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");
const entries = new Map<string, Response>();
const put = vi.fn(async (request: Request, response: Response) => {
  entries.set(request.url, response.clone());
});
const match = vi.fn(async (request: Request) => entries.get(request.url)?.clone());

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-06T12:00:00Z"));
  vi.stubEnv("SUPABASE_URL", "https://project-a.supabase.co");
  entries.clear();
  vi.clearAllMocks();
  setColoCacheForTests({ match, put });
});
afterEach(() => {
  setColoCacheForTests(undefined);
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("routing metadata across Worker isolates", () => {
  // Do 2026-09-20 ten przypadek przypinał odrzucenie wpisu NA granicy TTL
  // i `max-age` równe TTL. To była właśnie wada F01: migawka nie istniała po
  // ciszy dłuższej niż minuta, więc zimny izolat płacił dwa odczyty bazy przed
  // cache dokumentów. Nowy kontrakt rozdziela ŚWIEŻOŚĆ (TTL -> `stale`) od
  // PRZETRWANIA (`maxAgeMs`, domyślnie doba -> null).
  it("preserves the original timestamp and flips to stale at the exact TTL boundary", async () => {
    const snapshot = { at: Date.now(), value: ["tenant-a"] };
    await writeBootstrapSnapshot("tenants", snapshot, 60_000);
    vi.advanceTimersByTime(59_999);
    expect(await readBootstrapSnapshot("tenants", 60_000, isStrings)).toEqual({
      ...snapshot,
      stale: false,
    });
    vi.advanceTimersByTime(1);
    expect(await readBootstrapSnapshot("tenants", 60_000, isStrings)).toEqual({
      ...snapshot,
      stale: true,
    });
    expect([...entries.values()][0].headers.get("cache-control")).toBe(
      `public, max-age=${BOOTSTRAP_SNAPSHOT_MAX_AGE_MS / 1000}`,
    );
  });

  it("survives silence longer than the TTL and dies at the exact maxAge boundary", async () => {
    const snapshot = { at: Date.now(), value: ["tenant-a"] };
    await writeBootstrapSnapshot("tenants", snapshot, 60_000);
    vi.advanceTimersByTime(BOOTSTRAP_SNAPSHOT_MAX_AGE_MS - 1);
    expect(await readBootstrapSnapshot("tenants", 60_000, isStrings)).toEqual({
      ...snapshot,
      stale: true,
    });
    vi.advanceTimersByTime(1);
    expect(await readBootstrapSnapshot("tenants", 60_000, isStrings)).toBeNull();
  });

  it("honours a caller-supplied maxAge for both the read and the Cache API entry", async () => {
    // Konsument z własnym oknem serve-stale (edgeTtlCache: 5 x TTL) podaje
    // maxAge jawnie - ten sam wpis ma być odrzucony po 5 minutach, nie po dobie.
    const snapshot = { at: Date.now(), value: ["k"] };
    await writeBootstrapSnapshot("edge:k", snapshot, 60_000, { maxAgeMs: 300_000 });
    expect([...entries.values()][0].headers.get("cache-control")).toBe("public, max-age=300");
    vi.advanceTimersByTime(299_999);
    expect(await readBootstrapSnapshot("edge:k", 60_000, isStrings, { maxAgeMs: 300_000 })).toEqual(
      { ...snapshot, stale: true },
    );
    vi.advanceTimersByTime(1);
    expect(
      await readBootstrapSnapshot("edge:k", 60_000, isStrings, { maxAgeMs: 300_000 }),
    ).toBeNull();
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "falls back to the default maxAge for an unusable value: %s",
    async (maxAgeMs) => {
      await writeBootstrapSnapshot("x", { at: Date.now(), value: [] }, 1000, { maxAgeMs });
      expect([...entries.values()][0].headers.get("cache-control")).toBe(
        `public, max-age=${BOOTSTRAP_SNAPSHOT_MAX_AGE_MS / 1000}`,
      );
      vi.advanceTimersByTime(3_600_000);
      expect(await readBootstrapSnapshot("x", 1000, isStrings, { maxAgeMs })).toEqual({
        at: Date.now() - 3_600_000,
        value: [],
        stale: true,
      });
    },
  );

  it("never lets maxAge undercut the TTL (a fresh entry cannot be rejected)", async () => {
    await writeBootstrapSnapshot("x", { at: Date.now(), value: [] }, 60_000, { maxAgeMs: 1_000 });
    expect([...entries.values()][0].headers.get("cache-control")).toBe("public, max-age=60");
    vi.advanceTimersByTime(59_999);
    expect(await readBootstrapSnapshot("x", 60_000, isStrings, { maxAgeMs: 1_000 })).toMatchObject({
      stale: false,
    });
    vi.advanceTimersByTime(1);
    expect(await readBootstrapSnapshot("x", 60_000, isStrings, { maxAgeMs: 1_000 })).toBeNull();
  });

  it("separates database projects, metadata kinds and tenants", async () => {
    await writeBootstrapSnapshot("redirects:a", { at: Date.now(), value: ["/a"] }, 30_000);
    expect(await readBootstrapSnapshot("redirects:b", 30_000, isStrings)).toBeNull();
    expect(await readBootstrapSnapshot("tenants", 30_000, isStrings)).toBeNull();
    vi.stubEnv("SUPABASE_URL", "https://project-b.supabase.co");
    expect(await readBootstrapSnapshot("redirects:a", 30_000, isStrings)).toBeNull();
  });

  it.each(["", "not a URL", "data:text/plain,x"])(
    "does no cache I/O without a valid project: %s",
    async (url) => {
      vi.stubEnv("SUPABASE_URL", url);
      await writeBootstrapSnapshot("tenants", { at: Date.now(), value: [] }, 1000);
      expect(await readBootstrapSnapshot("tenants", 1000, isStrings)).toBeNull();
      expect(put).not.toHaveBeenCalled();
      expect(match).not.toHaveBeenCalled();
    },
  );

  it("works without Cloudflare Cache API", async () => {
    setColoCacheForTests(null);
    await writeBootstrapSnapshot("tenants", { at: Date.now(), value: [] }, 1000);
    expect(await readBootstrapSnapshot("tenants", 1000, isStrings)).toBeNull();
  });

  it.each([
    null,
    "bad",
    {},
    { at: "yesterday", value: [] },
    // `at: 1` to wiek ~56 lat - dalej niż doba przetrwania, więc odrzucony.
    { at: 1, value: [] },
    { at: 9e15, value: [] },
    { at: 1788696000000, value: [12] },
  ])("rejects malformed, expired or invalid snapshots: %j", async (value) => {
    setColoCacheForTests({ put, match: async () => Response.json(value) });
    expect(await readBootstrapSnapshot("tenants", 1000, isStrings)).toBeNull();
  });

  it.each([new Response("invalid JSON"), new Response("unavailable", { status: 503 })])(
    "treats a broken cache response as a miss",
    async (response) => {
      setColoCacheForTests({ put, match: async () => response.clone() });
      expect(await readBootstrapSnapshot("tenants", 1000, isStrings)).toBeNull();
    },
  );

  it("contains read/write failures and rounds a short maxAge to one second", async () => {
    await writeBootstrapSnapshot("short", { at: Date.now(), value: [] }, 5, { maxAgeMs: 5 });
    expect([...entries.values()][0].headers.get("cache-control")).toBe("public, max-age=1");
    setColoCacheForTests({
      match: async () => {
        throw new Error("cache offline");
      },
      put: async () => {
        throw new Error("cache full");
      },
    });
    await expect(
      writeBootstrapSnapshot("x", { at: Date.now(), value: [] }, 1000),
    ).resolves.toBeUndefined();
    expect(await readBootstrapSnapshot("x", 1000, isStrings)).toBeNull();
  });
});
