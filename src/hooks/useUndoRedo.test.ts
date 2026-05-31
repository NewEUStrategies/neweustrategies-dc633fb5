import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useUndoRedo } from "./useUndoRedo";

describe("useUndoRedo", () => {
  it("initial state and flags", () => {
    const { result } = renderHook(() => useUndoRedo({ n: 0 }));
    expect(result.current.state.n).toBe(0);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });

  it("set pushes history and supports undo/redo", () => {
    const { result } = renderHook(() => useUndoRedo({ n: 0 }));
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
    const { result } = renderHook(() => useUndoRedo({ n: 0 }));
    act(() => result.current.set((p) => ({ n: p.n + 5 })));
    expect(result.current.state.n).toBe(5);
  });

  it("coalesce merges into present without growing history", () => {
    const { result } = renderHook(() => useUndoRedo({ s: "" }));
    act(() => result.current.set({ s: "a" }));
    act(() => result.current.set({ s: "ab" }, { coalesce: true }));
    act(() => result.current.set({ s: "abc" }, { coalesce: true }));
    expect(result.current.state.s).toBe("abc");
    act(() => result.current.undo());
    // single history step created; undo returns to initial
    expect(result.current.state.s).toBe("");
  });

  it("reset clears history", () => {
    const { result } = renderHook(() => useUndoRedo({ n: 0 }));
    act(() => result.current.set({ n: 1 }));
    act(() => result.current.reset({ n: 99 }));
    expect(result.current.state.n).toBe(99);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });
});
