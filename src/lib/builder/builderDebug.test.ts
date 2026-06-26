import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  useBuilderDebug,
  toggleBuilderDebug,
  readInitialDebug,
  __resetBuilderDebugForTests,
} from "./builderDebug";

describe("builderDebug store", () => {
  beforeEach(() => {
    __resetBuilderDebugForTests();
    try {
      window.localStorage.removeItem("builder-debug");
    } catch {
      /* ignore */
    }
  });
  afterEach(() => __resetBuilderDebugForTests());

  it("reads the persisted flag from localStorage", () => {
    window.localStorage.setItem("builder-debug", "1");
    expect(readInitialDebug()).toBe(true);
    window.localStorage.setItem("builder-debug", "0");
    expect(readInitialDebug()).toBe(false);
  });

  it("starts disabled and shares the toggled flag across all instances", () => {
    const a = renderHook(() => useBuilderDebug());
    const b = renderHook(() => useBuilderDebug());

    expect(a.result.current.debug).toBe(false);
    expect(b.result.current.debug).toBe(false);

    act(() => toggleBuilderDebug());

    expect(a.result.current.debug).toBe(true);
    expect(b.result.current.debug).toBe(true);
    expect(window.localStorage.getItem("builder-debug")).toBe("1");
  });

  it("designates exactly one primary across multiple mounted renderers", () => {
    const a = renderHook(() => useBuilderDebug());
    const b = renderHook(() => useBuilderDebug());
    const c = renderHook(() => useBuilderDebug());

    const primaries = [a, b, c].filter((h) => h.result.current.isPrimary);
    expect(primaries).toHaveLength(1);
  });

  it("re-assigns the primary when the current owner unmounts", () => {
    const a = renderHook(() => useBuilderDebug());
    const b = renderHook(() => useBuilderDebug());

    // Unmount whichever instance currently owns the overlay; the sole survivor
    // must become primary (the overlay never disappears while a renderer lives).
    if (a.result.current.isPrimary) {
      a.unmount();
      expect(b.result.current.isPrimary).toBe(true);
    } else {
      b.unmount();
      expect(a.result.current.isPrimary).toBe(true);
    }
  });
});
