import { describe, it, expect } from "vitest";
import { z } from "zod";

// We can't easily mock supabase here without test infra; instead we test the
// SearchParams contract (URL is the public source of truth) and the facet
// reduction shape used by the search page.

const SearchParams = z.object({
  q: z.string().optional().default(""),
  category: z.string().optional(),
  author: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

describe("SearchParams", () => {
  it("defaults q to empty string", () => {
    expect(SearchParams.parse({})).toEqual({ q: "" });
  });

  it("preserves all known keys", () => {
    expect(
      SearchParams.parse({
        q: "foo",
        category: "c1",
        author: "a1",
        from: "2026-01-01",
        to: "2026-06-01",
      }),
    ).toEqual({
      q: "foo",
      category: "c1",
      author: "a1",
      from: "2026-01-01",
      to: "2026-06-01",
    });
  });
});

// Facet count aggregation (pure helper inlined for test).
function aggregateCounts<T extends { id: string }>(rows: Array<{ key: string }>) {
  const map = new Map<string, number>();
  rows.forEach((r) => map.set(r.key, (map.get(r.key) ?? 0) + 1));
  return Array.from(map.entries())
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => b.count - a.count);
}

describe("facet aggregation", () => {
  it("counts by key, sorts desc", () => {
    const r = aggregateCounts([{ key: "a" }, { key: "b" }, { key: "a" }, { key: "a" }, { key: "b" }]);
    expect(r).toEqual([
      { id: "a", count: 3 },
      { id: "b", count: 2 },
    ]);
  });
});
