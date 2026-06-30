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
});
