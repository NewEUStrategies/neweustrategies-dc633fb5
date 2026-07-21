import { describe, it, expect } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useMediaSelection } from "../useMediaSelection";
import type { MediaRow } from "../../types";

function makeRow(id: string): MediaRow {
  return {
    id,
    tenant_id: "tenant-1",
    storage_path: `tenant-1/u/${id}.png`,
    public_url: `https://cdn.example/${id}.png`,
    filename: `${id}.png`,
    mime_type: "image/png",
    size_bytes: 100,
    uploader_id: "u",
    created_at: "2026-01-01T00:00:00.000Z",
    folder_path: "/",
    alt_text: null,
  };
}

const files = [makeRow("a"), makeRow("b"), makeRow("c"), makeRow("d")];

/** Minimal typed mouse-event stub carrying only the modifier flags. */
function mouse(mods: { meta?: boolean; ctrl?: boolean; shift?: boolean }): ReactMouseEvent {
  return {
    metaKey: mods.meta ?? false,
    ctrlKey: mods.ctrl ?? false,
    shiftKey: mods.shift ?? false,
  } as unknown as ReactMouseEvent;
}

describe("useMediaSelection", () => {
  it("plain click selects only that item", () => {
    const { result } = renderHook(() => useMediaSelection(files));
    act(() => result.current.toggleSelect("b"));
    expect([...result.current.selectedIds]).toEqual(["b"]);
    act(() => result.current.toggleSelect("d"));
    expect([...result.current.selectedIds]).toEqual(["d"]);
  });

  it("meta/ctrl click toggles membership", () => {
    const { result } = renderHook(() => useMediaSelection(files));
    act(() => result.current.toggleSelect("a", mouse({ meta: true })));
    act(() => result.current.toggleSelect("c", mouse({ ctrl: true })));
    expect(new Set(result.current.selectedIds)).toEqual(new Set(["a", "c"]));
    act(() => result.current.toggleSelect("a", mouse({ meta: true })));
    expect([...result.current.selectedIds]).toEqual(["c"]);
  });

  it("shift click extends a contiguous range from the anchor", () => {
    const { result } = renderHook(() => useMediaSelection(files));
    act(() => result.current.toggleSelect("a"));
    act(() => result.current.toggleSelect("c", mouse({ shift: true })));
    expect(new Set(result.current.selectedIds)).toEqual(new Set(["a", "b", "c"]));
  });

  it("shift range works backwards too", () => {
    const { result } = renderHook(() => useMediaSelection(files));
    act(() => result.current.toggleSelect("d"));
    act(() => result.current.toggleSelect("b", mouse({ shift: true })));
    expect(new Set(result.current.selectedIds)).toEqual(new Set(["b", "c", "d"]));
  });

  it("selectAll selects every file in order scope", () => {
    const { result } = renderHook(() => useMediaSelection(files));
    act(() => result.current.selectAll());
    expect(new Set(result.current.selectedIds)).toEqual(new Set(["a", "b", "c", "d"]));
  });

  it("selectOnly replaces the selection and sets the anchor", () => {
    const { result } = renderHook(() => useMediaSelection(files));
    act(() => result.current.selectAll());
    act(() => result.current.selectOnly("b"));
    expect([...result.current.selectedIds]).toEqual(["b"]);
    expect(result.current.lastAnchorId).toBe("b");
  });

  it("clearSelection empties the set and the anchor", () => {
    const { result } = renderHook(() => useMediaSelection(files));
    act(() => result.current.selectAll());
    act(() => result.current.clearSelection());
    expect(result.current.selectedIds.size).toBe(0);
    expect(result.current.lastAnchorId).toBeNull();
  });
});
