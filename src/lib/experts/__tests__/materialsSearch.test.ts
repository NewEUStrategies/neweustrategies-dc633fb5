import { describe, it, expect } from "vitest";
import {
  filtersFromAuthorHubSearch,
  hasActiveMaterialFilters,
  isPaginatedAuthorHubView,
  parseAuthorHubSearch,
} from "@/lib/experts/materialsSearch";

describe("parseAuthorHubSearch", () => {
  it("returns an empty object for empty search (canonical URL stays clean)", () => {
    expect(parseAuthorHubSearch({})).toEqual({});
  });

  it("parses a full, valid set of params", () => {
    expect(
      parseAuthorHubSearch({
        page: "3",
        kind: "report",
        topic: "energia",
        region: "cee",
        program: "defence",
        year: "2025",
      }),
    ).toEqual({
      page: 3,
      kind: "report",
      topic: "energia",
      region: "cee",
      program: "defence",
      year: 2025,
    });
  });

  it("floors fractional pages and drops page < 1", () => {
    expect(parseAuthorHubSearch({ page: 2.9 })).toEqual({ page: 2 });
    expect(parseAuthorHubSearch({ page: 0 })).toEqual({});
    expect(parseAuthorHubSearch({ page: -4 })).toEqual({});
    expect(parseAuthorHubSearch({ page: "abc" })).toEqual({});
  });

  it("drops an unknown kind instead of passing it through", () => {
    expect(parseAuthorHubSearch({ kind: "pdf" })).toEqual({});
    expect(parseAuthorHubSearch({ kind: 7 })).toEqual({});
  });

  it("accepts every legal kind", () => {
    for (const kind of ["article", "report", "video", "podcast", "event"]) {
      expect(parseAuthorHubSearch({ kind })).toEqual({ kind });
    }
  });

  it("trims slugs and rejects empty / whitespace / oversized values", () => {
    expect(parseAuthorHubSearch({ topic: "  energia  " })).toEqual({ topic: "energia" });
    expect(parseAuthorHubSearch({ topic: "   " })).toEqual({});
    expect(parseAuthorHubSearch({ region: "a b" })).toEqual({});
    expect(parseAuthorHubSearch({ program: "x".repeat(201) })).toEqual({});
    expect(parseAuthorHubSearch({ program: 42 })).toEqual({});
  });

  it("bounds the year to a sane window (parity with materialYear)", () => {
    expect(parseAuthorHubSearch({ year: 1900 })).toEqual({});
    expect(parseAuthorHubSearch({ year: 1901 })).toEqual({ year: 1901 });
    expect(parseAuthorHubSearch({ year: 2101 })).toEqual({});
    expect(parseAuthorHubSearch({ year: "2025.5" })).toEqual({});
  });

  it("is idempotent (validateSearch cannot cause redirect churn)", () => {
    const once = parseAuthorHubSearch({ page: "2", kind: "video", topic: "ai" });
    const twice = parseAuthorHubSearch(once as unknown as Record<string, unknown>);
    expect(twice).toEqual(once);
  });
});

describe("filtersFromAuthorHubSearch", () => {
  it("maps absent params to nulls", () => {
    expect(filtersFromAuthorHubSearch({})).toEqual({
      kind: null,
      program: null,
      region: null,
      topic: null,
      year: null,
    });
  });

  it("projects present params onto slug filters", () => {
    expect(filtersFromAuthorHubSearch({ kind: "event", topic: "nato", year: 2024 })).toEqual({
      kind: "event",
      program: null,
      region: null,
      topic: "nato",
      year: 2024,
    });
  });
});

describe("hasActiveMaterialFilters / isPaginatedAuthorHubView", () => {
  it("page alone is not a filter, but it is a paginated view", () => {
    expect(hasActiveMaterialFilters({ page: 5 })).toBe(false);
    expect(isPaginatedAuthorHubView({ page: 5 })).toBe(true);
  });

  it("any filter marks the view as non-canonical even on page 1", () => {
    expect(hasActiveMaterialFilters({ region: "cee" })).toBe(true);
    expect(isPaginatedAuthorHubView({ region: "cee" })).toBe(true);
  });

  it("the canonical view has neither page nor filters", () => {
    expect(isPaginatedAuthorHubView({})).toBe(false);
  });
});
