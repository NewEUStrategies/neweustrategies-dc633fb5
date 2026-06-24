import { describe, it, expect } from "vitest";
import { fuzzyMatch, rankItems } from "../fuzzy";

describe("fuzzyMatch", () => {
  it("returns null when characters not in order", () => {
    expect(fuzzyMatch("xyz", "Admin Pages")).toBeNull();
  });
  it("matches subsequence case-insensitively", () => {
    const m = fuzzyMatch("apa", "Admin Pages");
    expect(m).not.toBeNull();
    expect(m!.indexes.length).toBe(3);
  });
  it("scores prefix higher than mid-string", () => {
    const a = fuzzyMatch("pag", "Pages")!;
    const b = fuzzyMatch("pag", "Settings · Pages")!;
    expect(a.score).toBeGreaterThan(b.score);
  });
  it("returns empty match for empty query", () => {
    expect(fuzzyMatch("", "Anything")).toEqual({ score: 0, indexes: [] });
  });
});

describe("rankItems", () => {
  const items = [
    { id: "1", haystack: "Pages admin pages" },
    { id: "2", haystack: "Posts admin posts" },
    { id: "3", haystack: "Pricing public pricing" },
    { id: "4", haystack: "Settings - permalinks" },
  ];
  it("returns all items for empty query", () => {
    expect(rankItems(items, "")).toHaveLength(4);
  });
  it("filters and ranks by query", () => {
    const r = rankItems(items, "pri");
    expect(r[0].id).toBe("3");
  });
  it("respects limit", () => {
    expect(rankItems(items, "", 2)).toHaveLength(2);
  });
});
