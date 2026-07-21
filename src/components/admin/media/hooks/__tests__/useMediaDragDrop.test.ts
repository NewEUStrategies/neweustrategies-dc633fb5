import { describe, it, expect, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { DragEvent as ReactDragEvent } from "react";
import { useMediaDragDrop } from "../useMediaDragDrop";

interface DataTransferStub {
  files: File[];
  types: string[];
  store: Record<string, string>;
  effectAllowed: string;
  getData: (type: string) => string;
  setData: (type: string, value: string) => void;
}

function makeEvent(opts: {
  files?: File[];
  types?: string[];
  data?: Record<string, string>;
}): ReactDragEvent {
  const store: Record<string, string> = { ...(opts.data ?? {}) };
  const dt: DataTransferStub = {
    files: opts.files ?? [],
    types: opts.types ?? [],
    store,
    effectAllowed: "",
    getData: (type: string) => store[type] ?? "",
    setData: (type: string, value: string) => {
      store[type] = value;
    },
  };
  return {
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    dataTransfer: dt,
  } as unknown as ReactDragEvent;
}

function setup(selected: string[] = []) {
  const uploadFiles = vi.fn();
  const doMove = vi.fn();
  const setSelectedIds = vi.fn();
  const { result } = renderHook(() =>
    useMediaDragDrop({
      currentPath: "/",
      selectedIds: new Set(selected),
      setSelectedIds,
      uploadFiles,
      doMove,
    }),
  );
  return { result, uploadFiles, doMove, setSelectedIds };
}

describe("useMediaDragDrop", () => {
  it("uploads OS files dropped on a folder", () => {
    const { result, uploadFiles } = setup();
    const file = new File(["x"], "a.png", { type: "image/png" });
    act(() => result.current.onFolderDrop("/press/")(makeEvent({ files: [file] })));
    expect(uploadFiles).toHaveBeenCalledWith([file], "/press/");
  });

  it("moves serialised media ids dropped on a folder", () => {
    const { result, doMove } = setup();
    const ev = makeEvent({ data: { "application/x-media-ids": JSON.stringify(["a", "b"]) } });
    act(() => result.current.onFolderDrop("/press/")(ev));
    expect(doMove).toHaveBeenCalledWith(["a", "b"], "/press/");
  });

  it("ignores a malformed move payload without throwing", () => {
    const { result, doMove } = setup();
    const ev = makeEvent({ data: { "application/x-media-ids": "{not json" } });
    expect(() => act(() => result.current.onFolderDrop("/press/")(ev))).not.toThrow();
    expect(doMove).not.toHaveBeenCalled();
  });

  it("drops non-string entries from the move payload", () => {
    const { result, doMove } = setup();
    const ev = makeEvent({ data: { "application/x-media-ids": JSON.stringify(["a", 1, null]) } });
    act(() => result.current.onFolderDrop("/press/")(ev));
    expect(doMove).toHaveBeenCalledWith(["a"], "/press/");
  });

  it("serialises the dragged id and selects it when not already selected", () => {
    const { result, setSelectedIds } = setup([]);
    const ev = makeEvent({});
    act(() => result.current.onItemDragStart("x")(ev));
    expect(setSelectedIds).toHaveBeenCalledWith(new Set(["x"]));
    expect(ev.dataTransfer.getData("application/x-media-ids")).toBe(JSON.stringify(["x"]));
  });

  it("drags the whole selection when the item is already selected", () => {
    const { result, setSelectedIds } = setup(["x", "y"]);
    const ev = makeEvent({});
    act(() => result.current.onItemDragStart("x")(ev));
    expect(setSelectedIds).not.toHaveBeenCalled();
    const payload = JSON.parse(ev.dataTransfer.getData("application/x-media-ids")) as string[];
    expect(new Set(payload)).toEqual(new Set(["x", "y"]));
  });

  it("uploads files dropped on the canvas", () => {
    const { result, uploadFiles } = setup();
    const file = new File(["x"], "b.png", { type: "image/png" });
    act(() => result.current.onCanvasDrop(makeEvent({ files: [file], types: ["Files"] })));
    expect(uploadFiles).toHaveBeenCalledWith([file], "/");
  });
});
