// Regression tests for the autosave contract: the hook must actually SAVE
// after the idle delay (the original bug marked the editor "dirty" forever
// and only a manual flush persisted anything - navigating away lost work).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useAutosave } from "./useAutosave";

describe("useAutosave", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("auto-saves after the idle delay without a manual flush", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result, rerender } = renderHook(
      ({ value }: { value: string }) => useAutosave({ value, save, delayMs: 500 }),
      { initialProps: { value: "a" } },
    );
    expect(result.current.status).toBe("idle");
    expect(result.current.isDirty).toBe(false);

    rerender({ value: "ab" });
    expect(result.current.status).toBe("dirty");
    expect(result.current.isDirty).toBe(true);
    expect(save).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("ab");
    expect(result.current.status).toBe("saved");
    expect(result.current.isDirty).toBe(false);
  });

  it("debounces a typing burst into one save of the freshest value", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderHook(
      ({ value }: { value: string }) => useAutosave({ value, save, delayMs: 500 }),
      { initialProps: { value: "a" } },
    );
    rerender({ value: "ab" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    rerender({ value: "abc" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    rerender({ value: "abcd" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("abcd");
  });

  it("does not save on mount", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    renderHook(() => useAutosave({ value: "initial", save, delayMs: 100 }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(save).not.toHaveBeenCalled();
  });

  it("surfaces save errors and stays dirty", async () => {
    const save = vi.fn().mockRejectedValue(new Error("boom"));
    const { result, rerender } = renderHook(
      ({ value }: { value: string }) => useAutosave({ value, save, delayMs: 100 }),
      { initialProps: { value: "a" } },
    );
    rerender({ value: "ab" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(result.current.status).toBe("error");
    expect(result.current.error).toBe("boom");
    expect(result.current.isDirty).toBe(true);
  });

  it("flush persists immediately and cancels the pending timer", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result, rerender } = renderHook(
      ({ value }: { value: string }) => useAutosave({ value, save, delayMs: 10_000 }),
      { initialProps: { value: "a" } },
    );
    rerender({ value: "ab" });
    await act(async () => {
      await result.current.flush();
    });
    expect(save).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(save).toHaveBeenCalledTimes(1);
  });
});
