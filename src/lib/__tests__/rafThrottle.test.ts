import { afterEach, describe, expect, it, vi } from "vitest";

import { rafThrottle } from "../rafThrottle";

type FrameCallback = (time: number) => void;

function stubRaf() {
  const queue: FrameCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameCallback): number => queue.push(cb));
  vi.stubGlobal("cancelAnimationFrame", (handle: number): void => {
    queue[handle - 1] = () => undefined;
  });
  return {
    flush: (): void => {
      const pending = queue.splice(0, queue.length);
      for (const cb of pending) cb(0);
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("rafThrottle", () => {
  it("coalesces a burst of calls into one invocation with the latest args", () => {
    const raf = stubRaf();
    const fn = vi.fn<(value: number) => void>();
    const throttled = rafThrottle(fn);

    throttled(1);
    throttled(2);
    throttled(3);
    expect(fn).not.toHaveBeenCalled();

    raf.flush();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(3);

    throttled(4);
    raf.flush();
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenLastCalledWith(4);
  });

  it("cancel() drops the scheduled frame (unmount safety)", () => {
    const raf = stubRaf();
    const fn = vi.fn<() => void>();
    const throttled = rafThrottle(fn);

    throttled();
    throttled.cancel();
    raf.flush();
    expect(fn).not.toHaveBeenCalled();
  });
});
