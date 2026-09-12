import { afterEach, expect, it } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { clearNoteContext, setNoteContext, useNoteContext } from "../noteContext";

afterEach(() => {
  cleanup();
  clearNoteContext();
});

it("notifies subscribers only on a changed context and ignores stale route cleanup", () => {
  let renders = 0;
  const { result, unmount } = renderHook(() => {
    renders++;
    return useNoteContext();
  });
  const first = { entityType: "post" as const, entityId: "post-1", title: "First", url: "/first" };
  act(() => setNoteContext(first));
  expect(result.current).toEqual(first);
  const before = renders;
  act(() => setNoteContext({ ...first }));
  expect(renders).toBe(before);
  for (const next of [
    { ...first, entityType: "page" as const },
    { ...first, entityId: "post-2" },
    { ...first, title: "Updated" },
    { ...first, url: "/updated" },
  ]) {
    act(() => setNoteContext(next));
    expect(result.current).toEqual(next);
  }
  act(() => clearNoteContext("old-page"));
  expect(result.current?.url).toBe("/updated");
  act(() => clearNoteContext("post-1"));
  expect(result.current).toBeNull();
  unmount();
  const stopped = renders;
  act(() => setNoteContext(first));
  expect(renders).toBe(stopped);
});

it("server rendering never exposes another request's in-memory note context", () => {
  setNoteContext({ entityType: "post", entityId: "private", title: "Private", url: null });
  function Label() {
    const context = useNoteContext();
    return <span>{context?.title ?? "empty"}</span>;
  }
  expect(renderToString(<Label />)).toBe("<span>empty</span>");
});
