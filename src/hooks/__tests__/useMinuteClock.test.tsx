// Zegar minutowy - CO TEN PLIK DOWODZI.
//
// Lista wydarzeń dzieli wiersze na „Najbliższe" i „Archiwum" po jednym znaczniku
// czasu, a licznik zakładek liczy się w bazie funkcją `now()`. Znacznik zamrożony
// na montaż widoku (recenzja PR 285, P2) rozjeżdża jedno z drugim: zakładka mówi
// 12, lista pod nią ma 13 wierszy. Reguły, których pilnujemy:
//   1. wartość jest ZRÓWNANA DO PEŁNEJ MINUTY - dwa widoki zamontowane w różnych
//      sekundach mają identyczny klucz zapytania, więc cache trafia;
//   2. wartość PRZESUWA SIĘ na granicy minuty, a nie 60 s po montażu;
//   3. referencja jest STABILNA w obrębie minuty - inaczej każdy tik unieważniałby
//      `useMemo` konsumentów;
//   4. powrót do karty odświeża granicę, bo uśpiona karta nie tyka.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useMinuteClock } from "@/hooks/useMinuteClock";

/** 15 lipca 2026, 10:30:37.500 UTC - celowo w środku minuty. */
const START = new Date("2026-07-15T10:30:37.500Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useMinuteClock", () => {
  it("floors the initial value to the whole minute", () => {
    const { result } = renderHook(() => useMinuteClock());
    expect(result.current.toISOString()).toBe("2026-07-15T10:30:00.000Z");
  });

  it("advances exactly on the minute boundary, not 60 s after mount", () => {
    const { result } = renderHook(() => useMinuteClock());

    // 22 s zostało do 10:31 - o 21 s jeszcze nic.
    act(() => {
      vi.advanceTimersByTime(21_000);
    });
    expect(result.current.toISOString()).toBe("2026-07-15T10:30:00.000Z");

    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(result.current.toISOString()).toBe("2026-07-15T10:31:00.000Z");
  });

  it("keeps the same object reference within one minute", () => {
    const { result } = renderHook(() => useMinuteClock());
    const first = result.current;

    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(result.current).toBe(first);
  });

  it("resyncs when the tab becomes visible again", () => {
    const { result } = renderHook(() => useMinuteClock());

    // Karta w tle: czas leci, licznik nie tyka. Symulujemy to przesunięciem
    // zegara systemowego BEZ przepuszczania zaplanowanych timerów.
    vi.setSystemTime(new Date("2026-07-15T11:45:10.000Z"));
    expect(result.current.toISOString()).toBe("2026-07-15T10:30:00.000Z");

    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(result.current.toISOString()).toBe("2026-07-15T11:45:00.000Z");
  });

  it("resyncs on window focus", () => {
    const { result } = renderHook(() => useMinuteClock());
    vi.setSystemTime(new Date("2026-07-15T12:00:00.000Z"));

    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(result.current.toISOString()).toBe("2026-07-15T12:00:00.000Z");
  });

  it("stops its timer on unmount", () => {
    const clearSpy = vi.spyOn(window, "clearTimeout");
    const { unmount } = renderHook(() => useMinuteClock());
    unmount();
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });
});
