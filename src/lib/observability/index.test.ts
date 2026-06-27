import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/webVitals", () => ({ initWebVitals: vi.fn() }));
import { initWebVitals } from "@/lib/webVitals";
import { initObservability } from "./index";

describe("initObservability", () => {
  let addSpy: ReturnType<typeof vi.spyOn>;
  let removeSpy: ReturnType<typeof vi.spyOn>;
  let cleanup: (() => void) | undefined;
  const originalBeacon = navigator.sendBeacon;

  beforeEach(() => {
    vi.mocked(initWebVitals).mockClear();
    addSpy = vi.spyOn(window, "addEventListener");
    removeSpy = vi.spyOn(window, "removeEventListener");
    // Error capture now beacons by default (internal endpoint), so stub the
    // transport to keep the test off the network.
    Object.defineProperty(navigator, "sendBeacon", { value: vi.fn(() => true), configurable: true, writable: true });
  });
  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
    addSpy.mockRestore();
    removeSpy.mockRestore();
    Object.defineProperty(navigator, "sendBeacon", { value: originalBeacon, configurable: true, writable: true });
  });

  it("starts web vitals and wires global error listeners once", () => {
    cleanup = initObservability();
    expect(initWebVitals).toHaveBeenCalledTimes(1);
    const events = (addSpy.mock.calls as unknown[][]).map((c) => c[0]);
    expect(events).toContain("error");
    expect(events).toContain("unhandledrejection");
  });

  it("is idempotent until cleaned up", () => {
    cleanup = initObservability();
    const noop = initObservability(); // already started → no-op
    expect(initWebVitals).toHaveBeenCalledTimes(1);
    noop(); // no-op cleanup is harmless

    // After the real cleanup, listeners are removed and init can run again.
    cleanup();
    cleanup = undefined;
    expect((removeSpy.mock.calls as unknown[][]).map((c) => c[0])).toEqual(
      expect.arrayContaining(["error", "unhandledrejection"]),
    );
    cleanup = initObservability();
    expect(initWebVitals).toHaveBeenCalledTimes(2);
  });

  it("error and rejection events are handled without throwing", () => {
    cleanup = initObservability();
    expect(() => window.dispatchEvent(new ErrorEvent("error", { error: new Error("x") }))).not.toThrow();
    expect(() =>
      window.dispatchEvent(
        new (class extends Event {
          reason = new Error("r");
        })("unhandledrejection") as Event,
      ),
    ).not.toThrow();
  });
});
