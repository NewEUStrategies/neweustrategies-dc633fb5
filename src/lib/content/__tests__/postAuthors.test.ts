import { describe, it, expect } from "vitest";
import {
  normalizeAuthorOrder,
  moveAuthor,
  removeAuthor,
  splitAuthors,
} from "@/lib/content/postAuthors";

describe("postAuthors ordering helpers", () => {
  it("dedupes preserving order and drops empties", () => {
    expect(normalizeAuthorOrder(["a", "b", "a", "", "  ", "c"])).toEqual(["a", "b", "c"]);
  });

  it("moves an author up and down", () => {
    expect(moveAuthor(["a", "b", "c"], 2, -1)).toEqual(["a", "c", "b"]);
    expect(moveAuthor(["a", "b", "c"], 0, 1)).toEqual(["b", "a", "c"]);
  });

  it("ignores out-of-range moves", () => {
    expect(moveAuthor(["a", "b"], 0, -1)).toEqual(["a", "b"]);
    expect(moveAuthor(["a", "b"], 1, 1)).toEqual(["a", "b"]);
  });

  it("never empties the author list", () => {
    expect(removeAuthor(["a", "b"], "a")).toEqual(["b"]);
    expect(removeAuthor(["a"], "a")).toEqual(["a"]);
  });

  it("treats the first entry as the main author", () => {
    expect(splitAuthors(["a", "b", "b", "c"])).toEqual({ main: "a", coAuthors: ["b", "c"] });
    expect(splitAuthors([])).toEqual({ main: null, coAuthors: [] });
  });
});
