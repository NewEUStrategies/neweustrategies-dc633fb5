import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { afterPageLoad } from "../afterPageLoad";

const idle = vi.hoisted(() => ({ schedule: vi.fn(), cancel: vi.fn() }));
vi.mock("@/lib/ads/idle", () => ({ whenIdle: idle.schedule }));
let frame: FrameRequestCallback | undefined;
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(document, "readyState", "get").mockReturnValue("loading");
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
    frame = cb;
    return 1;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {
    frame = undefined;
  });
  idle.schedule.mockReset().mockReturnValue(idle.cancel);
  idle.cancel.mockReset();
  frame = undefined;
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("does not schedule optional imports while critical resources are loading", () => {
  const work = vi.fn();
  const cancel = afterPageLoad(work);
  vi.advanceTimersByTime(3000);
  expect(idle.schedule).not.toHaveBeenCalled();
  window.dispatchEvent(new Event("load"));
  expect(idle.schedule).not.toHaveBeenCalled();
  frame?.(0);
  const callback = idle.schedule.mock.calls[0][0];
  callback();
  expect(work).toHaveBeenCalledOnce();
  cancel();
});

it("runs once after an already-completed load, with a bounded fallback for stalled loads", () => {
  vi.spyOn(document, "readyState", "get").mockReturnValue("complete");
  const cancel = afterPageLoad(vi.fn());
  frame?.(0);
  vi.advanceTimersByTime(20_000);
  window.dispatchEvent(new Event("load"));
  expect(idle.schedule).toHaveBeenCalledOnce();
  cancel();
});

it("recovers from a hanging resource after ten seconds", () => {
  const cancel = afterPageLoad(vi.fn());
  vi.advanceTimersByTime(10_000);
  frame?.(0);
  expect(idle.schedule).toHaveBeenCalledOnce();
  cancel();
});

it("cancels a pending callback when its owner unmounts", () => {
  const work = vi.fn();
  const cancel = afterPageLoad(work);
  window.dispatchEvent(new Event("load"));
  frame?.(0);
  cancel();
  idle.schedule.mock.calls[0][0]();
  expect(idle.cancel).toHaveBeenCalledOnce();
  expect(work).not.toHaveBeenCalled();
});
