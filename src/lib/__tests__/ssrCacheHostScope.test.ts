// @vitest-environment node
//
// edgeTtlCache scopes every entry by the request host (re-audit N2): an entry
// warmed while rendering tenant A's domain must never be served on tenant
// B's domain. Node environment = no window, so the server code path runs.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearEdgeTtlCache, edgeTtlCache } from "@/lib/ssrCache";

const state = vi.hoisted(() => ({ host: null as string | null }));

vi.mock("@/lib/http/requestHost", () => ({
  currentTenantHost: () => Promise.resolve(state.host),
  requestPublicHost: () => state.host,
}));

beforeEach(() => {
  clearEdgeTtlCache();
  state.host = null;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("edgeTtlCache host scoping", () => {
  it("caches within the TTL for one host", async () => {
    state.host = "a.example";
    const fetcher = vi.fn().mockResolvedValue("data-a");
    await expect(edgeTtlCache("k", 60_000, fetcher)).resolves.toBe("data-a");
    await expect(edgeTtlCache("k", 60_000, fetcher)).resolves.toBe("data-a");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("never serves one host's entry to another host (same key)", async () => {
    state.host = "a.example";
    await edgeTtlCache("home", 60_000, () => Promise.resolve("tenant-a-home"));

    state.host = "b.example";
    const forB = await edgeTtlCache("home", 60_000, () => Promise.resolve("tenant-b-home"));
    expect(forB).toBe("tenant-b-home");

    state.host = "a.example";
    const backOnA = await edgeTtlCache("home", 60_000, () => Promise.resolve("MISS"));
    expect(backOnA).toBe("tenant-a-home");
  });

  it("requests without a host share the no-host scope, separate from real hosts", async () => {
    state.host = null;
    await edgeTtlCache("k", 60_000, () => Promise.resolve("no-host-data"));

    state.host = "a.example";
    const forA = await edgeTtlCache("k", 60_000, () => Promise.resolve("a-data"));
    expect(forA).toBe("a-data");

    state.host = null;
    await expect(edgeTtlCache("k", 60_000, () => Promise.resolve("MISS"))).resolves.toBe(
      "no-host-data",
    );
  });

  it("expires entries after the TTL", async () => {
    vi.useFakeTimers();
    state.host = "a.example";
    await edgeTtlCache("k", 1_000, () => Promise.resolve("v1"));
    vi.advanceTimersByTime(1_500);
    await expect(edgeTtlCache("k", 1_000, () => Promise.resolve("v2"))).resolves.toBe("v2");
  });

  it("bounds the store and evicts the oldest entries beyond the cap (isolate-OOM guard)", async () => {
    state.host = "a.example";
    const MAX = 500;
    // Fill past the cap with distinct keys (the unbounded-growth scenario:
    // many hosts x per-slug keys over an isolate's lifetime).
    for (let i = 0; i < MAX + 50; i++) {
      await edgeTtlCache(`k${i}`, 60_000, () => Promise.resolve(`v${i}`));
    }

    // The oldest key must have been evicted -> a re-fetch misses and re-runs.
    const oldest = vi.fn().mockResolvedValue("k0-refetched");
    await expect(edgeTtlCache("k0", 60_000, oldest)).resolves.toBe("k0-refetched");
    expect(oldest).toHaveBeenCalledTimes(1);

    // A recent key is still cached -> fetcher never runs.
    const recent = vi.fn().mockResolvedValue("MISS");
    await expect(edgeTtlCache(`k${MAX + 49}`, 60_000, recent)).resolves.toBe(`v${MAX + 49}`);
    expect(recent).not.toHaveBeenCalled();
  });
});
