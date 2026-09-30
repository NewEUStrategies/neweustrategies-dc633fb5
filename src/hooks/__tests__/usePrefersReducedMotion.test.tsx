import { act, cleanup, renderHook } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePrefersReducedMotion } from "../usePrefersReducedMotion";

function mediaPreference(initial: boolean) {
  let matches = initial;
  const listeners = new Set<(event: { matches: boolean }) => void>();
  const matchMedia = vi.fn((query: string) => ({
    get matches() {
      return matches;
    },
    media: query,
    addEventListener: (_type: string, listener: (event: { matches: boolean }) => void) =>
      listeners.add(listener),
    removeEventListener: (_type: string, listener: (event: { matches: boolean }) => void) =>
      listeners.delete(listener),
  }));
  vi.stubGlobal("matchMedia", matchMedia);
  return {
    matchMedia,
    listeners,
    change(next: boolean) {
      matches = next;
      act(() => listeners.forEach((listener) => listener({ matches })));
    },
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("usePrefersReducedMotion", () => {
  it("keeps observing by default and responds to live accessibility changes", () => {
    const media = mediaPreference(true);
    const { result, unmount } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(true);
    expect(media.listeners.size).toBe(1);
    media.change(false);
    expect(result.current).toBe(false);
    media.change(true);
    expect(result.current).toBe(true);
    unmount();
    expect(media.listeners.size).toBe(0);
  });

  it("observes only while enabled and reads fresh preferences when re-enabled", () => {
    const media = mediaPreference(true);
    const { result, rerender } = renderHook((enabled) => usePrefersReducedMotion(enabled), {
      initialProps: false,
    });
    expect(result.current).toBe(false);
    expect(media.matchMedia).not.toHaveBeenCalled();
    rerender(true);
    expect(result.current).toBe(true);
    expect(media.listeners.size).toBe(1);
    rerender(false);
    expect(result.current).toBe(false);
    expect(media.listeners.size).toBe(0);
    media.change(false);
    rerender(true);
    expect(result.current).toBe(false);
    expect(media.listeners.size).toBe(1);
    media.change(true);
    expect(result.current).toBe(true);
  });

  it("starts with the same snapshot on the server and first client render", () => {
    const media = mediaPreference(true);
    function Probe() {
      return <span>{String(usePrefersReducedMotion())}</span>;
    }
    expect(renderToString(<Probe />)).toBe("<span>false</span>");
    expect(media.matchMedia).not.toHaveBeenCalled();
    const renders: boolean[] = [];
    renderHook(() => renders.push(usePrefersReducedMotion()));
    expect(renders[0]).toBe(false);
    expect(renders.at(-1)).toBe(true);
  });

  it("works when media queries are unavailable", () => {
    vi.stubGlobal("matchMedia", undefined);
    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(false);
  });
});
