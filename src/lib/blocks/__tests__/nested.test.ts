import { describe, it, expect } from "vitest";
import {
  readChildBlocks,
  withChildBlocks,
  insertChildAt,
  removeChildAt,
  moveChild,
  updateChild,
  replaceChildWith,
} from "@/lib/blocks/nested";
import type { Block, Json } from "@/lib/blocks/types";

const child = (id: string): Block => ({ id, type: "paragraph", data: { html: id } });
const kids = [child("a"), child("b"), child("c")];

describe("readChildBlocks / withChildBlocks", () => {
  it("reads only well-shaped blocks and tolerates garbage", () => {
    const data: Record<string, Json> = {
      children: [child("a") as unknown as Json, null, "x", { type: "no-id" }],
    };
    const out = readChildBlocks(data, "children");
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("a");
    expect(readChildBlocks({}, "children")).toEqual([]);
  });

  it("writes children under the requested key without touching other data", () => {
    const group: Block = { id: "g", type: "group", data: { background: "#fff", children: [] } };
    const next = withChildBlocks(group, "children", kids);
    expect(next.data.background).toBe("#fff");
    expect(readChildBlocks(next.data, "children").map((b) => b.id)).toEqual(["a", "b", "c"]);
    expect(group.data.children).toEqual([]); // immutability
  });
});

describe("child array ops", () => {
  it("insertChildAt clamps the index", () => {
    expect(insertChildAt(kids, 99, child("z")).map((b) => b.id)).toEqual(["a", "b", "c", "z"]);
    expect(insertChildAt(kids, -5, child("z")).map((b) => b.id)).toEqual(["z", "a", "b", "c"]);
  });

  it("removeChildAt / updateChild / replaceChildWith", () => {
    expect(removeChildAt(kids, 1).map((b) => b.id)).toEqual(["a", "c"]);
    expect(updateChild(kids, "b", child("B"))[1].id).toBe("B");
    expect(replaceChildWith(kids, "b", [child("x"), child("y")]).map((b) => b.id)).toEqual([
      "a",
      "x",
      "y",
      "c",
    ]);
    expect(replaceChildWith(kids, "missing", [child("x")]).map((b) => b.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("moveChild reorders within bounds", () => {
    expect(moveChild(kids, 0, 2).map((b) => b.id)).toEqual(["b", "c", "a"]);
    expect(moveChild(kids, 2, 0).map((b) => b.id)).toEqual(["c", "a", "b"]);
    expect(moveChild(kids, 0, 99).map((b) => b.id)).toEqual(["b", "c", "a"]);
    expect(moveChild(kids, 5, 0).map((b) => b.id)).toEqual(["a", "b", "c"]);
  });
});
