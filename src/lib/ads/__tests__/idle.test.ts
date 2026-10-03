import { describe, it, expect, vi, afterEach } from "vitest";
import { whenIdle } from "@/lib/ads/idle";

type MutableGlobal = Record<string, unknown>;

afterEach(() => {
  vi.restoreAllMocks();
  // happy-dom ships a native requestIdleCallback that `delete` cannot remove,
  // so reset to undefined to put whenIdle back on a known footing.
  (window as unknown as MutableGlobal).requestIdleCallback = undefined;
  (window as unknown as MutableGlobal).cancelIdleCallback = undefined;
});

describe("whenIdle", () => {
  it("uses requestIdleCallback when available and cancels through cancelIdleCallback", () => {
    const scheduled: Array<() => void> = [];
    const ric = vi.fn((cb: () => void) => {
      scheduled.push(cb);
      return 7;
    });
    const cic = vi.fn();
    (window as unknown as MutableGlobal).requestIdleCallback = ric;
    (window as unknown as MutableGlobal).cancelIdleCallback = cic;

    const onIdle = vi.fn();
    const cancel = whenIdle(onIdle, 1000);

    expect(ric).toHaveBeenCalledTimes(1);
    expect(onIdle).not.toHaveBeenCalled();

    scheduled[0]();
    expect(onIdle).toHaveBeenCalledTimes(1);

    cancel();
    expect(cic).toHaveBeenCalledWith(7);
  });

  it("falls back to a short setTimeout (not the full idle timeout) when requestIdleCallback is missing", () => {
    (window as unknown as MutableGlobal).requestIdleCallback = undefined;
    const setSpy = vi
      .spyOn(window, "setTimeout")
      .mockReturnValue(123 as unknown as ReturnType<typeof setTimeout>);

    const onIdle = vi.fn();
    whenIdle(onIdle, 1000);

    expect(setSpy).toHaveBeenCalledTimes(1);
    // The fallback yields one macrotask (~32ms), never the full idle timeout.
    expect(setSpy.mock.calls[0][1]).toBe(32);

    const scheduled = setSpy.mock.calls[0][0] as () => void;
    expect(typeof scheduled).toBe("function");
    expect(onIdle).not.toHaveBeenCalled();

    scheduled();
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it("cancel() clears the fallback timeout", () => {
    (window as unknown as MutableGlobal).requestIdleCallback = undefined;
    vi.spyOn(window, "setTimeout").mockReturnValue(777 as unknown as ReturnType<typeof setTimeout>);
    const clearSpy = vi.spyOn(window, "clearTimeout");

    const cancel = whenIdle(vi.fn(), 1000);
    cancel();

    expect(clearSpy).toHaveBeenCalledWith(777);
  });

  it("defaults the idle deadline to 2500ms when no timeout is given", () => {
    const ric = vi.fn((_cb: () => void, _options?: { timeout?: number }) => 1);
    (window as unknown as MutableGlobal).requestIdleCallback = ric;
    (window as unknown as MutableGlobal).cancelIdleCallback = vi.fn();

    whenIdle(vi.fn());

    expect(ric.mock.calls[0][1]).toEqual({ timeout: 2500 });
  });

  it("without requestIdleCallback the default deadline still yields only one short macrotask", () => {
    (window as unknown as MutableGlobal).requestIdleCallback = undefined;
    const setSpy = vi
      .spyOn(window, "setTimeout")
      .mockReturnValue(5 as unknown as ReturnType<typeof setTimeout>);

    whenIdle(vi.fn());

    expect(setSpy.mock.calls[0][1]).toBe(32);
  });

  it("on the server (no window) it never runs the callback and returns a safe no-op canceller", () => {
    const onIdle = vi.fn();
    vi.stubGlobal("window", undefined);
    let cancel: () => void = () => {
      throw new Error("test: whenIdle did not return a canceller");
    };
    try {
      cancel = whenIdle(onIdle, 10);
      expect(typeof cancel).toBe("function");
      expect(() => cancel()).not.toThrow();
    } finally {
      vi.unstubAllGlobals();
    }

    expect(onIdle).not.toHaveBeenCalled();
    // Calling the SSR canceller again after hydration must stay harmless too.
    expect(() => cancel()).not.toThrow();
  });
});
