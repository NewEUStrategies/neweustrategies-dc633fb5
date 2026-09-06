// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readBootstrapSnapshot, writeBootstrapSnapshot } from "../bootstrapCache.server";
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
  it("preserves the original timestamp and expires at the exact TTL boundary", async () => {
    const snapshot = { at: Date.now(), value: ["tenant-a"] };
    await writeBootstrapSnapshot("tenants", snapshot, 60_000);
    vi.advanceTimersByTime(59_999);
    expect(await readBootstrapSnapshot("tenants", 60_000, isStrings)).toEqual(snapshot);
    vi.advanceTimersByTime(1);
    expect(await readBootstrapSnapshot("tenants", 60_000, isStrings)).toBeNull();
    expect([...entries.values()][0].headers.get("cache-control")).toBe("public, max-age=60");
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

  it("contains read/write failures and rounds a short TTL to one second", async () => {
    await writeBootstrapSnapshot("short", { at: Date.now(), value: [] }, 5);
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
