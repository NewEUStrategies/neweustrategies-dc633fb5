import { describe, it, expect } from "vitest";
import {
  EXPERT_MATERIALS_PAGE_SIZE,
  filterMaterialsBySlugs,
  mapExpertMaterialsPayload,
  materialsTotalPages,
  paginateMaterials,
  resolveFilterSlugs,
} from "@/lib/experts/materialsPage";
import { applyMaterialFilters } from "@/lib/experts/filter";
import {
  EMPTY_MATERIAL_FILTERS,
  EMPTY_MATERIAL_FILTER_SLUGS,
  type ExpertHubData,
  type ExpertMaterial,
} from "@/lib/experts/types";

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
    tagIds: partial.tagIds ?? [],
    isCoauthor: partial.isCoauthor ?? false,
  };
}

const FACETS: ExpertHubData["facets"] = {
  programs: [
    {
      id: "p1",
      slug: "defence",
      name_pl: "Obronność",
      name_en: "Defence",
      kind: "program",
      description_pl: null,
      description_en: null,
      role_pl: null,
      role_en: null,
    },
  ],
  regions: [{ id: "r1", slug: "cee", name_pl: "Europa Środkowa", name_en: "Central Europe" }],
  categories: [{ id: "c1", slug: "analizy", name_pl: "Analizy", name_en: "Analyses" }],
  tags: [{ id: "t1", slug: "energia", name: "Energia" }],
};

const MATERIALS: ExpertMaterial[] = [
  mat({ id: "a", kind: "article", date: "2026-05-01", programIds: ["p1"], tagIds: ["t1"] }),
  mat({ id: "b", kind: "report", date: "2025-11-20", regionIds: ["r1"] }),
  mat({ id: "c", kind: "podcast", date: "2026-01-15", programIds: ["p1"] }),
  mat({ id: "d", kind: "event", date: "2024-09-09" }),
];

describe("materialsTotalPages", () => {
  it("rounds up and never returns less than one page", () => {
    expect(materialsTotalPages(0, 9)).toBe(1);
    expect(materialsTotalPages(9, 9)).toBe(1);
    expect(materialsTotalPages(10, 9)).toBe(2);
    expect(materialsTotalPages(27, 9)).toBe(3);
  });
});

describe("resolveFilterSlugs / filterMaterialsBySlugs", () => {
  it("resolves slugs to facet ids and matches applyMaterialFilters output", () => {
    const resolved = resolveFilterSlugs(FACETS, {
      ...EMPTY_MATERIAL_FILTER_SLUGS,
      program: "defence",
    });
    expect(resolved).toEqual({ ...EMPTY_MATERIAL_FILTERS, programId: "p1" });
    const viaSlugs = filterMaterialsBySlugs(MATERIALS, FACETS, {
      ...EMPTY_MATERIAL_FILTER_SLUGS,
      program: "defence",
    });
    const viaIds = applyMaterialFilters(MATERIALS, { ...EMPTY_MATERIAL_FILTERS, programId: "p1" });
    expect(viaSlugs).toEqual(viaIds);
    expect(viaSlugs.map((m) => m.id)).toEqual(["a", "c"]);
  });

  it("passes kind and year through without facet resolution", () => {
    const out = filterMaterialsBySlugs(MATERIALS, FACETS, {
      ...EMPTY_MATERIAL_FILTER_SLUGS,
      kind: "report",
      year: 2025,
    });
    expect(out.map((m) => m.id)).toEqual(["b"]);
  });

  it("rozwiązuje KAŻDY wymiar osobno - region też, nie tylko program i temat", () => {
    // Trzy wyszukiwania po fasetach mają identyczny kształt, więc łatwo
    // przepiąć jedno z nich na złą listę: filtr regionu zacząłby wtedy szukać
    // wśród programów i cicho zwracał pustkę dla poprawnego sluga.
    expect(resolveFilterSlugs(FACETS, { ...EMPTY_MATERIAL_FILTER_SLUGS, region: "cee" })).toEqual({
      ...EMPTY_MATERIAL_FILTERS,
      regionId: "r1",
    });
    expect(
      resolveFilterSlugs(FACETS, { ...EMPTY_MATERIAL_FILTER_SLUGS, topic: "energia" }),
    ).toEqual({ ...EMPTY_MATERIAL_FILTERS, tagId: "t1" });
    expect(
      filterMaterialsBySlugs(MATERIALS, FACETS, {
        ...EMPTY_MATERIAL_FILTER_SLUGS,
        region: "cee",
      }).map((m) => m.id),
    ).toEqual(["b"]);
  });

  it("nieznany slug REGIONU też daje zbiór pusty, nie pełny", () => {
    expect(
      resolveFilterSlugs(FACETS, { ...EMPTY_MATERIAL_FILTER_SLUGS, region: "nope" }),
    ).toBeNull();
    expect(
      resolveFilterSlugs(FACETS, { ...EMPTY_MATERIAL_FILTER_SLUGS, program: "nope" }),
    ).toBeNull();
  });

  it("returns an empty set for an unknown slug (parity with the RPC)", () => {
    expect(
      resolveFilterSlugs(FACETS, { ...EMPTY_MATERIAL_FILTER_SLUGS, topic: "nope" }),
    ).toBeNull();
    expect(
      filterMaterialsBySlugs(MATERIALS, FACETS, {
        ...EMPTY_MATERIAL_FILTER_SLUGS,
        topic: "nope",
      }),
    ).toEqual([]);
  });
});

describe("paginateMaterials", () => {
  const many = Array.from({ length: 21 }, (_, i) => mat({ id: `m${i}` }));

  it("slices the requested window and reports the full total", () => {
    const page2 = paginateMaterials(many, 2, 9);
    expect(page2.total).toBe(21);
    expect(page2.page).toBe(2);
    expect(page2.pageSize).toBe(9);
    expect(page2.materials.map((m) => m.id)).toEqual(
      Array.from({ length: 9 }, (_, i) => `m${i + 9}`),
    );
  });

  it("returns the remainder on the last page", () => {
    expect(paginateMaterials(many, 3, 9).materials).toHaveLength(3);
  });

  it("keeps the true total for an out-of-range page (SQL LIMIT/OFFSET parity)", () => {
    const beyond = paginateMaterials(many, 9, 9);
    expect(beyond.materials).toEqual([]);
    expect(beyond.total).toBe(21);
  });

  it("clamps a nonsensical page down to one", () => {
    expect(paginateMaterials(many, -3, 9).page).toBe(1);
  });
});

describe("mapExpertMaterialsPayload", () => {
  const payload = {
    found: true,
    total: 12,
    page: 2,
    page_size: EXPERT_MATERIALS_PAGE_SIZE,
    items: [
      {
        source: "podcast",
        is_coauthor: false,
        row: {
          id: "pod1",
          slug: "odcinek-1",
          title_pl: "Odcinek",
          title_en: "Episode",
          excerpt_pl: null,
          excerpt_en: null,
          cover_image_url: null,
          published_at: "2026-03-01T00:00:00+00:00",
          program_id: "p1",
          region_id: null,
        },
      },
      {
        source: "post",
        is_coauthor: true,
        row: {
          id: "post1",
          slug: "wpis",
          title_pl: "Wpis",
          title_en: "Post",
          excerpt_pl: "PL",
          excerpt_en: "EN",
          cover_image_url: null,
          published_at: "2026-02-01T00:00:00+00:00",
          post_format: "report",
          author_id: "someone-else",
        },
      },
      {
        source: "event",
        is_coauthor: false,
        row: {
          id: "ev1",
          slug: "debata",
          title_pl: "Debata",
          title_en: "Debate",
          description_pl: null,
          description_en: null,
          cover_url: null,
          starts_at: "2026-01-01T00:00:00+00:00",
          program_id: null,
          region_id: "r1",
          host_user_id: "host",
        },
      },
    ],
    post_categories: [{ post_id: "post1", category_id: "c1" }],
    post_programs: [{ post_id: "post1", program_id: "p1" }],
    post_regions: [],
    post_tags: [{ post_id: "post1", tag_id: "t1" }],
  };

  it("maps items preserving the SQL window order (no re-sort)", () => {
    const out = mapExpertMaterialsPayload(payload);
    expect(out.kind).toBe("ok");
    if (out.kind !== "ok") return;
    expect(out.page.total).toBe(12);
    expect(out.page.page).toBe(2);
    expect(out.page.materials.map((m) => `${m.kind}:${m.id}`)).toEqual([
      "podcast:pod1",
      "report:post1",
      "event:ev1",
    ]);
  });

  it("attaches page-scoped pivots and the coauthor flag to post rows", () => {
    const out = mapExpertMaterialsPayload(payload);
    if (out.kind !== "ok") throw new Error("expected ok");
    const post = out.page.materials.find((m) => m.id === "post1");
    expect(post?.isCoauthor).toBe(true);
    expect(post?.categoryIds).toEqual(["c1"]);
    expect(post?.programIds).toEqual(["p1"]);
    expect(post?.tagIds).toEqual(["t1"]);
    expect(post?.href).toBe("/post/wpis");
  });

  it("maps found=false to not-found (profile gate intact)", () => {
    expect(mapExpertMaterialsPayload({ found: false })).toEqual({ kind: "not-found" });
  });

  it("treats malformed payloads as invalid (caller falls back to legacy)", () => {
    expect(mapExpertMaterialsPayload(null).kind).toBe("invalid");
    expect(mapExpertMaterialsPayload("x").kind).toBe("invalid");
    expect(mapExpertMaterialsPayload({ found: true, total: "??" }).kind).toBe("invalid");
    expect(mapExpertMaterialsPayload({ total: 3 }).kind).toBe("invalid");
  });

  it("skips unknown item sources instead of crashing", () => {
    const out = mapExpertMaterialsPayload({
      found: true,
      total: 1,
      page: 1,
      page_size: 9,
      items: [{ source: "webinar", row: { id: "x" } }, "garbage"],
      post_categories: [],
      post_programs: [],
      post_regions: [],
      post_tags: [],
    });
    if (out.kind !== "ok") throw new Error("expected ok");
    expect(out.page.materials).toEqual([]);
  });
});
