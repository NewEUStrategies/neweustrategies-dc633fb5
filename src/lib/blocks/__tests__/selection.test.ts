import { describe, it, expect } from "vitest";
import { blockRange, toggleInSelection } from "@/lib/blocks/selection";

const IDS = ["a", "b", "c", "d", "e"] as const;

describe("blockRange", () => {
  it("returns an inclusive range in document order (forward)", () => {
    expect(blockRange(IDS, "b", "d")).toEqual(["b", "c", "d"]);
  });

  it("returns the same range when clicking backwards", () => {
    expect(blockRange(IDS, "d", "b")).toEqual(["b", "c", "d"]);
  });

  it("collapses to a single block when anchor === target", () => {
    expect(blockRange(IDS, "c", "c")).toEqual(["c"]);
  });

  it("degrades gracefully when an id is missing", () => {
    expect(blockRange(IDS, "zz", "c")).toEqual(["c"]);
    expect(blockRange(IDS, "c", "zz")).toEqual(["c"]);
    expect(blockRange(IDS, "zz", "yy")).toEqual([]);
  });
});

describe("toggleInSelection", () => {
  it("adds a block preserving document order", () => {
    expect(toggleInSelection(IDS, ["d", "b"], "c")).toEqual(["b", "c", "d"]);
  });

  it("removes an already selected block", () => {
    expect(toggleInSelection(IDS, ["b", "c", "d"], "c")).toEqual(["b", "d"]);
  });

  it("works from an empty selection", () => {
    expect(toggleInSelection(IDS, [], "e")).toEqual(["e"]);
  });
});
