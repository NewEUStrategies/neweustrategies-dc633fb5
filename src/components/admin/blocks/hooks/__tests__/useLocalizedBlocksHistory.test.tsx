// Regression tests for the "dead undo" bug: the parent's echo of a doc the
// editor itself propagated must NOT reset the undo/redo stacks. The harness
// mimics the real wiring (admin.posts.$slug): onChange stores the value in
// parent state, which flows back down as `value` on the next render.
import { describe, it, expect } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import type { BlocksDoc, LocalizedBlocks } from "@/lib/blocks/types";
import { useLocalizedBlocksHistory } from "../useLocalizedBlocksHistory";

function doc(text: string): BlocksDoc {
  return {
    version: 1,
    blocks: [{ id: "b1", type: "paragraph", data: { text } }],
  };
}

/** Parent + hook in one harness: onChange feeds straight back into `value`. */
function useHarness(initial: LocalizedBlocks | null) {
  const [value, setValue] = useState<LocalizedBlocks | null>(initial);
  const localized = useLocalizedBlocksHistory(value, setValue);
  return { ...localized, value };
}

const INITIAL: LocalizedBlocks = { pl: doc("start"), en: doc("start-en") };

describe("useLocalizedBlocksHistory", () => {
  it("keeps undo history across the parent echo (dead-undo regression)", () => {
    const { result } = renderHook(() => useHarness(INITIAL));

    act(() => result.current.history.setDoc(doc("edit-1"), true));
    // Parent state now holds the propagated doc; the echo re-rendered the hook.
    expect(result.current.value?.pl).toBe(result.current.history.doc);
    expect(result.current.history.canUndo).toBe(true);

    act(() => result.current.history.setDoc(doc("edit-2"), true));
    expect(result.current.history.canUndo).toBe(true);

    act(() => result.current.history.undo());
    expect(result.current.history.doc.blocks[0]?.data).toEqual({ text: "edit-1" });
    // Undo also propagates upstream so the form saves the restored content.
    expect(result.current.value?.pl).toBe(result.current.history.doc);
    expect(result.current.history.canRedo).toBe(true);

    act(() => result.current.history.redo());
    expect(result.current.history.doc.blocks[0]?.data).toEqual({ text: "edit-2" });
  });

  it("undoes back to the initial doc", () => {
    const { result } = renderHook(() => useHarness(INITIAL));
    act(() => result.current.history.setDoc(doc("edit-1"), true));
    act(() => result.current.history.undo());
    expect(result.current.history.doc.blocks[0]?.data).toEqual({ text: "start" });
    expect(result.current.history.canUndo).toBe(false);
  });

  it("switching language swaps stacks and does not leak edits across languages", () => {
    const { result } = renderHook(() => useHarness(INITIAL));

    act(() => result.current.history.setDoc(doc("pl-edit"), true));
    act(() => result.current.setLang("en"));
    // EN tab starts from the EN doc with a fresh stack.
    expect(result.current.history.doc.blocks[0]?.data).toEqual({ text: "start-en" });
    expect(result.current.history.canUndo).toBe(false);
    // PL edit is preserved in the parent value.
    expect(result.current.value?.pl.blocks[0]?.data).toEqual({ text: "pl-edit" });

    act(() => result.current.history.setDoc(doc("en-edit"), true));
    expect(result.current.value?.en.blocks[0]?.data).toEqual({ text: "en-edit" });
    expect(result.current.value?.pl.blocks[0]?.data).toEqual({ text: "pl-edit" });
  });

  it("an external value replacement resets the stack", () => {
    const { result, rerender } = renderHook(
      ({ external }: { external: LocalizedBlocks | null }) => {
        const [value, setValue] = useState<LocalizedBlocks | null>(INITIAL);
        const effective = external ?? value;
        const localized = useLocalizedBlocksHistory(effective, setValue);
        return { ...localized, value: effective };
      },
      { initialProps: { external: null as LocalizedBlocks | null } },
    );

    act(() => result.current.history.setDoc(doc("edit-1"), true));
    expect(result.current.history.canUndo).toBe(true);

    // Simulates a revision restore / reload: brand-new object from outside.
    const restored: LocalizedBlocks = { pl: doc("restored"), en: doc("restored-en") };
    rerender({ external: restored });

    expect(result.current.history.doc.blocks[0]?.data).toEqual({ text: "restored" });
    expect(result.current.history.canUndo).toBe(false);
    expect(result.current.history.canRedo).toBe(false);
  });
});
