import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useHistory } from "./useHistory";

describe("useHistory", () => {
  it("initial state and flags", () => {
    const { result } = renderHook(() => useHistory({ n: 0 }));
    expect(result.current.state.n).toBe(0);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });

  it("set pushes history and supports undo/redo", () => {
    const { result } = renderHook(() => useHistory({ n: 0 }));
    act(() => result.current.set({ n: 1 }));
    act(() => result.current.set({ n: 2 }));
    expect(result.current.state.n).toBe(2);
    expect(result.current.canUndo).toBe(true);

    act(() => result.current.undo());
    expect(result.current.state.n).toBe(1);
    act(() => result.current.undo());
    expect(result.current.state.n).toBe(0);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(true);

    act(() => result.current.redo());
    expect(result.current.state.n).toBe(1);
  });

  it("functional updater", () => {
    const { result } = renderHook(() => useHistory({ n: 0 }));
    act(() => result.current.set((p) => ({ n: p.n + 5 })));
    expect(result.current.state.n).toBe(5);
  });

  it("coalesces same-key changes into one history step", () => {
    const { result } = renderHook(() => useHistory({ s: "" }));
    act(() => result.current.set({ s: "a" }, { coalesceKey: "s" }));
    act(() => result.current.set({ s: "ab" }, { coalesceKey: "s" }));
    act(() => result.current.set({ s: "abc" }, { coalesceKey: "s" }));
    expect(result.current.state.s).toBe("abc");
    act(() => result.current.undo());
    // one step for the whole run of same-key edits; undo returns to initial
    expect(result.current.state.s).toBe("");
  });

  it("keeps different coalesce keys as separate undo steps", () => {
    const { result } = renderHook(() => useHistory({ title: "", body: "" }));
    act(() => result.current.set((p) => ({ ...p, title: "t" }), { coalesceKey: "title" }));
    act(() => result.current.set((p) => ({ ...p, body: "b" }), { coalesceKey: "body" }));
    // A key change must NOT fold the two edits into one step (the old bug).
    act(() => result.current.undo());
    expect(result.current.state).toEqual({ title: "t", body: "" });
  });

  it("reset clears history", () => {
    const { result } = renderHook(() => useHistory({ n: 0 }));
    act(() => result.current.set({ n: 1 }));
    act(() => result.current.reset({ n: 99 }));
    expect(result.current.state.n).toBe(99);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });

  it("clear wipes history but keeps current state", () => {
    const { result } = renderHook(() => useHistory({ n: 0 }));
    act(() => result.current.set({ n: 1 }));
    act(() => result.current.clear());
    expect(result.current.state.n).toBe(1);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });

  it("tracks labels for undo/redo toasts", () => {
    const { result } = renderHook(() => useHistory({ n: 0 }));
    act(() => result.current.set({ n: 1 }, { label: "step one" }));
    expect(result.current.lastLabel).toBe("step one");
    act(() => result.current.undo());
    expect(result.current.nextLabel).toBe("step one");
  });

  it("calls onChange on set/undo/redo", () => {
    const onChange = vi.fn();
    const { result } = renderHook(() => useHistory({ n: 0 }, { onChange }));
    act(() => result.current.set({ n: 1 }));
    expect(onChange).toHaveBeenLastCalledWith({ n: 1 });
    act(() => result.current.undo());
    expect(onChange).toHaveBeenLastCalledWith({ n: 0 });
    act(() => result.current.redo());
    expect(onChange).toHaveBeenLastCalledWith({ n: 1 });
  });

  it("syncExternal resyncs present when initial changes without recording history", () => {
    const { result, rerender } = renderHook(({ initial }) => useHistory(initial, { syncExternal: true }), {
      initialProps: { initial: { n: 0 } },
    });
    act(() => result.current.set({ n: 1 }));
    rerender({ initial: { n: 42 } });
    // Present resyncs to the external value; existing history stacks are
    // untouched (matches the original builder behavior - only `reset()`
    // clears past/future).
    expect(result.current.state.n).toBe(42);
  });
});
