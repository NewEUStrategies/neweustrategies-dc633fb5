// @vitest-environment node
//
// edgeTtlCache scopes every entry by the request host (re-audit N2): an entry
// warmed while rendering tenant A's domain must never be served on tenant
// B's domain. Node environment = no window, so the server code path runs.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearEdgeTtlCache, edgeTtlCache, invalidateEdgeTtlCache } from "@/lib/ssrCache";

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

  it("serves stale within the serve-stale window and refreshes in the background", async () => {
    vi.useFakeTimers();
    state.host = "a.example";
    await edgeTtlCache("k", 1_000, () => Promise.resolve("v1"));
    vi.advanceTimersByTime(1_500);
    // Stale hit (po TTL, w oknie 5x TTL): nieświeża wartość wraca NATYCHMIAST,
    // a odświeżenie startuje w tle - render SSR nie blokuje się na fetchu.
    let release!: (v: string) => void;
    const gate = new Promise<string>((r) => (release = r));
    const refresher = vi.fn().mockReturnValue(gate);
    await expect(edgeTtlCache("k", 1_000, refresher)).resolves.toBe("v1");
    expect(refresher).toHaveBeenCalledTimes(1);
    // Drugi stale-hit w trakcie TRWAJĄCEGO odświeżania nie startuje drugiego
    // fetcha i nadal serwuje nieświeżą wartość.
    const dup = vi.fn().mockResolvedValue("v2-dup");
    await expect(edgeTtlCache("k", 1_000, dup)).resolves.toBe("v1");
    expect(dup).not.toHaveBeenCalled();
    // Po rozstrzygnięciu odświeżenia (mikrotaski) kolejny odczyt widzi v2.
    release("v2");
    for (let i = 0; i < 10; i++) await Promise.resolve();
    await expect(edgeTtlCache("k", 1_000, () => Promise.resolve("MISS"))).resolves.toBe("v2");
  });

  it("hard-expires entries beyond the serve-stale window (blocking refetch)", async () => {
    vi.useFakeTimers();
    state.host = "a.example";
    await edgeTtlCache("k", 1_000, () => Promise.resolve("v1"));
    // Powyżej STALE_FACTOR (5x TTL) wpis jest twardym missem.
    vi.advanceTimersByTime(5_500);
    await expect(edgeTtlCache("k", 1_000, () => Promise.resolve("v2"))).resolves.toBe("v2");
  });

  it("dedupes concurrent cold misses into a single fetch (single-flight)", async () => {
    state.host = "a.example";
    let release!: (v: string) => void;
    const gate = new Promise<string>((r) => (release = r));
    const fetcher = vi.fn().mockReturnValue(gate);
    const p1 = edgeTtlCache("sf", 60_000, fetcher);
    const p2 = edgeTtlCache("sf", 60_000, fetcher);
    release("shared");
    await expect(p1).resolves.toBe("shared");
    await expect(p2).resolves.toBe("shared");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("a read after invalidation does not join a pre-invalidation in-flight fetch", async () => {
    state.host = "a.example";
    let releaseOld!: (v: string) => void;
    const oldGate = new Promise<string>((r) => (releaseOld = r));
    const preInvalidation = edgeTtlCache("inv2", 60_000, () => oldGate);
    await invalidateEdgeTtlCache("inv2");
    // Odczyt PO invalidacji startuje świeży fetch zamiast dołączyć do lotu
    // sprzed niej - inaczej dostałby sprzed-operatorskie dane.
    const fresh = vi.fn().mockResolvedValue("fresh");
    const postInvalidation = edgeTtlCache("inv2", 60_000, fresh);
    releaseOld("pre-invalidation");
    await expect(preInvalidation).resolves.toBe("pre-invalidation");
    await expect(postInvalidation).resolves.toBe("fresh");
    expect(fresh).toHaveBeenCalledTimes(1);
  });

  it("a fetch started before invalidation cannot store pre-invalidation data", async () => {
    state.host = "a.example";
    let release!: (v: string) => void;
    const gate = new Promise<string>((r) => (release = r));
    const p = edgeTtlCache("inv", 60_000, () => gate);
    // Operator unieważnia wpis, gdy fetch jeszcze wisi w locie.
    await invalidateEdgeTtlCache("inv");
    release("pre-invalidation");
    // Wołający dostaje swoje dane...
    await expect(p).resolves.toBe("pre-invalidation");
    // ...ale magazyn NIE został zatruty: kolejny odczyt fetchuje od nowa.
    const refetch = vi.fn().mockResolvedValue("fresh");
    await expect(edgeTtlCache("inv", 60_000, refetch)).resolves.toBe("fresh");
    expect(refetch).toHaveBeenCalledTimes(1);
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
