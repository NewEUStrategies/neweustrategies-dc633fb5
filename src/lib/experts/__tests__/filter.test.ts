import { describe, it, expect } from "vitest";
import {
  applyMaterialFilters,
  availableYears,
  kindCounts,
  materialYear,
} from "@/lib/experts/filter";
import { EMPTY_MATERIAL_FILTERS, type ExpertMaterial } from "@/lib/experts/types";

function mat(partial: Partial<ExpertMaterial>): ExpertMaterial {
  return {
    id: partial.id ?? Math.random().toString(36).slice(2),
    kind: partial.kind ?? "article",
    title_pl: partial.title_pl ?? "PL",
    title_en: partial.title_en ?? "EN",
    excerpt_pl: partial.excerpt_pl ?? null,
    excerpt_en: partial.excerpt_en ?? null,
    cover_url: partial.cover_url ?? null,
    date: partial.date ?? null,
    href: partial.href ?? "#",
    programIds: partial.programIds ?? [],
    regionIds: partial.regionIds ?? [],
    categoryIds: partial.categoryIds ?? [],
    isCoauthor: partial.isCoauthor ?? false,
  };
}

const SAMPLE: ExpertMaterial[] = [
  mat({
    id: "a",
    kind: "article",
    date: "2026-05-01",
    programIds: ["p1"],
    regionIds: ["r1"],
    categoryIds: ["c1"],
  }),
  mat({
    id: "b",
    kind: "report",
    date: "2025-11-20",
    programIds: ["p2"],
    regionIds: ["r1"],
    categoryIds: ["c2"],
  }),
  mat({ id: "c", kind: "podcast", date: "2026-01-15", programIds: ["p1"], regionIds: ["r2"] }),
  mat({ id: "d", kind: "event", date: "2024-09-09", programIds: [], regionIds: ["r2"] }),
  mat({ id: "e", kind: "video", date: null, programIds: ["p2"] }),
];

describe("materialYear", () => {
  it("extracts the year from an ISO date", () => {
    expect(materialYear(mat({ date: "2026-05-01T10:00:00Z" }))).toBe(2026);
  });
  it("returns null when there is no date", () => {
    expect(materialYear(mat({ date: null }))).toBeNull();
  });
});

describe("applyMaterialFilters", () => {
  it("returns everything with empty filters", () => {
    expect(applyMaterialFilters(SAMPLE, EMPTY_MATERIAL_FILTERS)).toHaveLength(5);
  });

  it("filters by kind", () => {
    const out = applyMaterialFilters(SAMPLE, { ...EMPTY_MATERIAL_FILTERS, kind: "report" });
    expect(out.map((m) => m.id)).toEqual(["b"]);
  });

  it("filters by program membership", () => {
    const out = applyMaterialFilters(SAMPLE, { ...EMPTY_MATERIAL_FILTERS, programId: "p1" });
    expect(out.map((m) => m.id).sort()).toEqual(["a", "c"]);
  });

  it("filters by region", () => {
    const out = applyMaterialFilters(SAMPLE, { ...EMPTY_MATERIAL_FILTERS, regionId: "r2" });
    expect(out.map((m) => m.id).sort()).toEqual(["c", "d"]);
  });

  it("filters by category", () => {
    const out = applyMaterialFilters(SAMPLE, { ...EMPTY_MATERIAL_FILTERS, categoryId: "c2" });
    expect(out.map((m) => m.id)).toEqual(["b"]);
  });

  it("filters by year (and excludes date-less materials)", () => {
    const out = applyMaterialFilters(SAMPLE, { ...EMPTY_MATERIAL_FILTERS, year: 2026 });
    expect(out.map((m) => m.id).sort()).toEqual(["a", "c"]);
  });

  it("combines filters with AND semantics", () => {
    const out = applyMaterialFilters(SAMPLE, {
      ...EMPTY_MATERIAL_FILTERS,
      programId: "p1",
      regionId: "r1",
    });
    expect(out.map((m) => m.id)).toEqual(["a"]);
  });

  it("returns nothing when a filter matches no material", () => {
    const out = applyMaterialFilters(SAMPLE, { ...EMPTY_MATERIAL_FILTERS, programId: "nope" });
    expect(out).toHaveLength(0);
  });
});

describe("availableYears", () => {
  it("returns distinct years newest-first, ignoring date-less items", () => {
    expect(availableYears(SAMPLE)).toEqual([2026, 2025, 2024]);
  });
});

describe("kindCounts", () => {
  it("counts materials per kind across every kind key", () => {
    expect(kindCounts(SAMPLE)).toEqual({
      article: 1,
      report: 1,
      video: 1,
      podcast: 1,
      event: 1,
    });
  });

  it("returns zeroes for an empty list", () => {
    expect(kindCounts([])).toEqual({ article: 0, report: 0, video: 0, podcast: 0, event: 0 });
  });
});
