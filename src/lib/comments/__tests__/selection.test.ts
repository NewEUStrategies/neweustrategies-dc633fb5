import { describe, expect, it } from "vitest";
import {
  retainExisting,
  selectAllState,
  toggleSelectAll,
  toggleSelected,
} from "@/lib/comments/selection";

const set = (...ids: string[]) => new Set(ids);

describe("selectAllState", () => {
  it("is none for an empty visible list", () => {
    expect(selectAllState([], set("a"))).toBe("none");
  });
  it("is none / some / all as coverage of visible grows", () => {
    expect(selectAllState(["a", "b", "c"], set())).toBe("none");
    expect(selectAllState(["a", "b", "c"], set("a"))).toBe("some");
    expect(selectAllState(["a", "b", "c"], set("a", "b", "c"))).toBe("all");
  });
  it("ignores selected ids that are not currently visible", () => {
    // "z" is selected but off-page; visible coverage is still partial.
    expect(selectAllState(["a", "b"], set("a", "z"))).toBe("some");
  });
});

describe("toggleSelected", () => {
  it("adds then removes without mutating the input", () => {
    const base = set("a");
    const added = toggleSelected(base, "b");
    expect([...added].sort()).toEqual(["a", "b"]);
    expect([...base]).toEqual(["a"]); // input untouched
    expect([...toggleSelected(added, "a")]).toEqual(["b"]);
  });
});

describe("toggleSelectAll", () => {
  it("selects all visible when some/none are selected", () => {
    expect([...toggleSelectAll(["a", "b"], set())].sort()).toEqual(["a", "b"]);
    expect([...toggleSelectAll(["a", "b"], set("a"))].sort()).toEqual(["a", "b"]);
  });
  it("clears visible when all visible are selected, keeping off-page picks", () => {
    const next = toggleSelectAll(["a", "b"], set("a", "b", "z"));
    expect([...next]).toEqual(["z"]);
  });
});

describe("retainExisting", () => {
  it("drops selected ids no longer present after a refetch/filter change", () => {
    expect([...retainExisting(set("a", "b", "c"), ["a", "c"])].sort()).toEqual(["a", "c"]);
  });
  it("returns an empty set when nothing remains", () => {
    expect([...retainExisting(set("a"), ["x", "y"])]).toEqual([]);
  });
});
