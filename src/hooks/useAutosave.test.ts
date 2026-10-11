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

  it("flush REJECTS when the save fails (never a silent success)", async () => {
    const save = vi.fn().mockRejectedValue(new Error("server_down"));
    const { result, rerender } = renderHook(
      ({ value }: { value: string }) => useAutosave({ value, save, delayMs: 10_000 }),
      { initialProps: { value: "a" } },
    );
    rerender({ value: "ab" });
    await act(async () => {
      await expect(result.current.flush()).rejects.toThrow("server_down");
    });
    // Caller must be able to see this was NOT saved: still dirty, status error.
    expect(result.current.status).toBe("error");
    expect(result.current.isDirty).toBe(true);
  });

  it("flush resolves on success and exposes the last-saved value", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result, rerender } = renderHook(
      ({ value }: { value: string }) => useAutosave({ value, save, delayMs: 10_000 }),
      { initialProps: { value: "a" } },
    );
    rerender({ value: "ab" });
    await act(async () => {
      await result.current.flush();
    });
    expect(save).toHaveBeenCalledWith("ab");
    expect(result.current.status).toBe("saved");
    expect(result.current.isDirty).toBe(false);
    expect(result.current.lastSaved).toBe("ab");
  });

  it("persists the latest value even when it changed while a save was in flight", async () => {
    let resolveFirst: () => void = () => {};
    const save = vi
      .fn()
      .mockImplementationOnce(() => new Promise<void>((r) => (resolveFirst = r)))
      .mockResolvedValue(undefined);
    const { result, rerender } = renderHook(
      ({ value }: { value: string }) => useAutosave({ value, save, delayMs: 100 }),
      { initialProps: { value: "a" } },
    );
    rerender({ value: "ab" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenLastCalledWith("ab");

    // Edit again while the first save is still pending, then flush.
    rerender({ value: "abc" });
    await act(async () => {
      const flushed = result.current.flush();
      resolveFirst();
      await flushed;
    });
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith("abc");
    expect(result.current.lastSaved).toBe("abc");
    expect(result.current.isDirty).toBe(false);
  });

  it("a timer that fires after the value returned to the baseline does not stall later saves", async () => {
    // The drain chain settles SYNCHRONOUSLY when there is nothing to save; it
    // used to stay registered as "in flight" and answer every later drain()
    // without saving - autosave went silent until the editor remounted.
    const save = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderHook(
      ({ value }: { value: string }) => useAutosave({ value, save, delayMs: 100 }),
      { initialProps: { value: "a" } },
    );
    rerender({ value: "ab" });
    rerender({ value: "a" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    expect(save).not.toHaveBeenCalled();

    rerender({ value: "abc" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    expect(save).toHaveBeenCalledWith("abc");
  });

  describe("resetKey - switching to another record", () => {
    type Props = { value: string; id: string };

    it("re-baselines on the new record's value without saving it", async () => {
      const save = vi.fn().mockResolvedValue(undefined);
      const { result, rerender } = renderHook(
        ({ value, id }: Props) => useAutosave({ value, save, delayMs: 100, resetKey: id }),
        { initialProps: { value: "post A", id: "a" } },
      );

      rerender({ value: "post B", id: "b" });
      // Clean in the very render that carries the new key - the navigation
      // guard must not flash "unsaved changes" for a record nobody edited.
      expect(result.current.isDirty).toBe(false);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });

      expect(save).not.toHaveBeenCalled();
      expect(result.current.lastSaved).toBe("post B");
      expect(result.current.status).toBe("idle");
    });

    it("drops the previous record's pending debounced save", async () => {
      const save = vi.fn().mockResolvedValue(undefined);
      const { rerender } = renderHook(
        ({ value, id }: Props) => useAutosave({ value, save, delayMs: 100, resetKey: id }),
        { initialProps: { value: "post A", id: "a" } },
      );
      rerender({ value: "post A edited", id: "a" });
      rerender({ value: "post B", id: "b" });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });

      expect(save).not.toHaveBeenCalled();
    });

    it("a save still in flight for the previous record never becomes the new lastSaved", async () => {
      // `discardToSaved` resets the editor to `lastSaved` - if record A's
      // snapshot landed there after switching, "discard" restored A into B.
      let resolveA: () => void = () => {};
      const save = vi
        .fn()
        .mockImplementationOnce(() => new Promise<void>((r) => (resolveA = r)))
        .mockResolvedValue(undefined);
      const { result, rerender } = renderHook(
        ({ value, id }: Props) => useAutosave({ value, save, delayMs: 100, resetKey: id }),
        { initialProps: { value: "post A", id: "a" } },
      );
      rerender({ value: "post A edited", id: "a" });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(150);
      });
      expect(save).toHaveBeenCalledWith("post A edited");

      rerender({ value: "post B", id: "b" });
      await act(async () => {
        resolveA();
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(result.current.lastSaved).toBe("post B");
      expect(result.current.status).toBe("idle");
      expect(result.current.isDirty).toBe(false);
      expect(save).toHaveBeenCalledTimes(1);

      // The detached chain does not block the new record's own saves.
      rerender({ value: "post B edited", id: "b" });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(150);
      });
      expect(save).toHaveBeenCalledTimes(2);
      expect(save).toHaveBeenLastCalledWith("post B edited");
      expect(result.current.lastSaved).toBe("post B edited");
    });

    it("a failed save of the previous record does not mark the new one as errored", async () => {
      let rejectA: (e: Error) => void = () => {};
      const save = vi
        .fn()
        .mockImplementationOnce(() => new Promise<void>((_r, j) => (rejectA = j)))
        .mockResolvedValue(undefined);
      const { result, rerender } = renderHook(
        ({ value, id }: Props) => useAutosave({ value, save, delayMs: 100, resetKey: id }),
        { initialProps: { value: "post A", id: "a" } },
      );
      rerender({ value: "post A edited", id: "a" });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(150);
      });

      rerender({ value: "post B", id: "b" });
      await act(async () => {
        rejectA(new Error("A failed"));
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(result.current.status).toBe("idle");
      expect(result.current.error).toBeNull();
    });
  });
});
