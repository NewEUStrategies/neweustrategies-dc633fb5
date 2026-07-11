import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  requestOverlaySlot,
  cancelOverlayRequest,
  setConsentOverlayVisible,
  __resetOverlayCoordinator,
} from "@/lib/overlayCoordinator";

describe("overlayCoordinator", () => {
  beforeEach(() => {
    vi.useFakeTimers();
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
});
