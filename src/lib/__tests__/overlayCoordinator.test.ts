import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  requestOverlaySlot,
  cancelOverlayRequest,
  setConsentOverlayVisible,
  setMarketingConsent,
  __resetOverlayCoordinator,
} from "@/lib/overlayCoordinator";

describe("overlayCoordinator", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Pin a realistic non-zero base time so the persisted budget's "last shown"
    // timestamp behaves as it would in production (Date.now() is never 0 there).
    vi.setSystemTime(new Date("2026-07-11T10:00:00Z"));
    __resetOverlayCoordinator();
  });
  afterEach(() => {
    __resetOverlayCoordinator();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("keeps SSR usable without browser storage", async () => {
    vi.stubGlobal("window", undefined);
    const release = await requestOverlaySlot("ssr", { marketing: true });
    expect(release).toBeTypeOf("function");
    release();
    __resetOverlayCoordinator();
  });
  it.each([
    { day: 7, count: "bad", lastTs: "bad" },
    { day: "2026-07-10", count: 3, lastTs: 0 },
  ])("recovers from stale or malformed persisted budgets: %j", async (budget) => {
    window.localStorage.setItem("overlay:budget:v1", JSON.stringify(budget));
    await requestOverlaySlot("new-day", { marketing: true });
    expect(JSON.parse(window.localStorage.getItem("overlay:budget:v1")!)).toMatchObject({
      day: "2026-07-11",
      count: 1,
    });
  });
  it("suppresses the fourth marketing interruption even after the minimum gap", async () => {
    window.localStorage.setItem(
      "overlay:budget:v1",
      JSON.stringify({ day: "2026-07-11", count: 3, lastTs: 0 }),
    );
    const opened = vi.fn();
    void requestOverlaySlot("fourth", { marketing: true }).then(opened);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(opened).not.toHaveBeenCalled();
    cancelOverlayRequest("fourth");
  });
  it("preserves FIFO at equal priority and ignores a stale double release", async () => {
    setConsentOverlayVisible(true);
    const first = requestOverlaySlot("first", { priority: 10 });
    const second = vi.fn();
    void requestOverlaySlot("second", { priority: 10 }).then(second);
    setConsentOverlayVisible(false);
    const release = await first;
    expect(second).not.toHaveBeenCalled();
    release();
    release();
    // Re-pumping a cooldown must not schedule a second timer.
    setConsentOverlayVisible(false);
    expect(vi.getTimerCount()).toBe(1);
    __resetOverlayCoordinator();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("grants the first request immediately", async () => {
    const granted = vi.fn();
    void requestOverlaySlot("a").then(granted);
    await vi.runOnlyPendingTimersAsync();
    expect(granted).toHaveBeenCalledTimes(1);
  });

  it("holds marketing overlays while the consent banner is visible", async () => {
    setConsentOverlayVisible(true);
    const granted = vi.fn();
    void requestOverlaySlot("a").then(granted);
    await vi.advanceTimersByTimeAsync(1000);
    expect(granted).not.toHaveBeenCalled();
    setConsentOverlayVisible(false);
    await vi.runOnlyPendingTimersAsync();
    expect(granted).toHaveBeenCalledTimes(1);
  });

  it("never grants two overlays at once and applies a cooldown after release", async () => {
    let releaseA: (() => void) | null = null;
    const grantedB = vi.fn();
    void requestOverlaySlot("a").then((r) => {
      releaseA = r;
    });
    void requestOverlaySlot("b").then(grantedB);
    await vi.runOnlyPendingTimersAsync();
    expect(releaseA).not.toBeNull();
    expect(grantedB).not.toHaveBeenCalled();

    releaseA!();
    // Still inside the cooldown window - b must wait.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(grantedB).not.toHaveBeenCalled();
    // After the cooldown lapses, b is granted.
    await vi.advanceTimersByTimeAsync(31_000);
    expect(grantedB).toHaveBeenCalledTimes(1);
  });

  it("cancelOverlayRequest removes a pending request", async () => {
    setConsentOverlayVisible(true);
    const granted = vi.fn();
    void requestOverlaySlot("a").then(granted);
    cancelOverlayRequest("a");
    setConsentOverlayVisible(false);
    await vi.runOnlyPendingTimersAsync();
    expect(granted).not.toHaveBeenCalled();
  });

  it("grants the highest-priority waiter first, not FIFO", async () => {
    const order: string[] = [];
    // Hold the queue until both are enqueued, then release.
    setConsentOverlayVisible(true);
    void requestOverlaySlot("low", { priority: 0 }).then(() => order.push("low"));
    void requestOverlaySlot("high", { priority: 5 }).then(() => order.push("high"));
    setConsentOverlayVisible(false);
    await vi.runOnlyPendingTimersAsync();
    expect(order).toEqual(["high"]);
  });

  it("suppresses marketing overlays when marketing consent is denied", async () => {
    setMarketingConsent(false);
    const granted = vi.fn();
    void requestOverlaySlot("newsletter", { marketing: true }).then(granted);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(granted).not.toHaveBeenCalled();
    // Granting marketing consent releases it.
    setMarketingConsent(true);
    await vi.runOnlyPendingTimersAsync();
    expect(granted).toHaveBeenCalledTimes(1);
  });

  it("still grants non-marketing coordinated overlays when marketing is denied", async () => {
    setMarketingConsent(false);
    const granted = vi.fn();
    void requestOverlaySlot("app-dialog", { marketing: false }).then(granted);
    await vi.runOnlyPendingTimersAsync();
    expect(granted).toHaveBeenCalledTimes(1);
  });

  it("enforces a minimum gap between marketing overlays across the budget", async () => {
    setMarketingConsent(true);
    let releaseA: (() => void) | null = null;
    void requestOverlaySlot("nl-a", { marketing: true }).then((r) => {
      releaseA = r;
    });
    await vi.runOnlyPendingTimersAsync();
    expect(releaseA).not.toBeNull();
    releaseA!();
    // Past the 30s in-memory cooldown but well inside the 20-minute marketing gap.
    await vi.advanceTimersByTimeAsync(35_000);
    const grantedB = vi.fn();
    void requestOverlaySlot("nl-b", { marketing: true }).then(grantedB);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(grantedB).not.toHaveBeenCalled();
  });
});
