// Kontrakt debounce: seria szybkich zmian daje JEDNĄ aktualizację (ostatnią
// wartością) po pełnej pauzie; pierwszy render zwraca wartość natychmiast.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useDebouncedValue } from "./useDebouncedValue";

describe("useDebouncedValue", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the initial value immediately", () => {
    const { result } = renderHook(() => useDebouncedValue("nato", 200));
    expect(result.current).toBe("nato");
  });

  it("holds the old value until the delay elapses, then flips", () => {
    const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v, 200), {
      initialProps: { v: "na" },
    });
    rerender({ v: "nat" });
    expect(result.current).toBe("na");

    act(() => {
      vi.advanceTimersByTime(199);
    });
    expect(result.current).toBe("na");

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe("nat");
  });

  it("collapses a typing burst into a single trailing update", () => {
    const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v, 200), {
      initialProps: { v: "u" },
    });
    for (const v of ["uk", "ukr", "ukra", "ukrai"]) {
      rerender({ v });
      act(() => {
        vi.advanceTimersByTime(100); // krócej niż delay - timer się przesuwa
      });
    }
    expect(result.current).toBe("u");
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current).toBe("ukrai");
  });
});
