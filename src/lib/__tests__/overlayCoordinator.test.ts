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
    vi.useRealTimers();
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
