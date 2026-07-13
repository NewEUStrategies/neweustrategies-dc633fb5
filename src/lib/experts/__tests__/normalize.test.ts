import { describe, it, expect } from "vitest";
import {
  buildExpertProfile,
  compareMaterialsByDateDesc,
  eventRowToMaterial,
  groupPivot,
  mapExpertiseAreaRows,
  mapMediaMentionRows,
  mapProgramMembers,
  parseOrgFunctions,
  podcastRowToMaterial,
  postFormatToKind,
  postRowToMaterial,
  reduceFacets,
  type PostPivots,
} from "@/lib/experts/normalize";
import type { ExpertMaterial } from "@/lib/experts/types";

const NO_PIVOTS: PostPivots = {
  categories: new Map(),
  programs: new Map(),
  regions: new Map(),
};

function mat(partial: Partial<ExpertMaterial>): ExpertMaterial {
  return {
    id: partial.id ?? "x",
    kind: partial.kind ?? "article",
    title_pl: "",
    title_en: "",
    excerpt_pl: null,
    excerpt_en: null,
    cover_url: null,
    date: partial.date ?? null,
    href: "#",
    programIds: partial.programIds ?? [],
    regionIds: partial.regionIds ?? [],
    categoryIds: partial.categoryIds ?? [],
    isCoauthor: false,
  };
}

describe("postFormatToKind", () => {
  it("maps video/report explicitly and everything else to article", () => {
    expect(postFormatToKind("video")).toBe("video");
    expect(postFormatToKind("report")).toBe("report");
    expect(postFormatToKind("standard")).toBe("article");
    expect(postFormatToKind("gallery")).toBe("article");
    expect(postFormatToKind(null)).toBe("article");
    expect(postFormatToKind(undefined)).toBe("article");
  });
});

describe("parseOrgFunctions", () => {
  it("keeps well-formed entries and coerces missing sides to empty string", () => {
    expect(
      parseOrgFunctions([
        { pl: "Dyrektorka", en: "Director" },
        { pl: "Członkini zarządu" },
      ]),
    ).toEqual([
      { pl: "Dyrektorka", en: "Director" },
      { pl: "Członkini zarządu", en: "" },
    ]);
  });

  it("drops entries with no text on either side", () => {
    expect(parseOrgFunctions([{ pl: "", en: "" }, { pl: "X", en: "" }])).toEqual([
      { pl: "X", en: "" },
    ]);
  });

  it("returns [] for non-array / junk input", () => {
    expect(parseOrgFunctions(null)).toEqual([]);
    expect(parseOrgFunctions("nope")).toEqual([]);
    expect(parseOrgFunctions([null, 42, "s"])).toEqual([]);
  });
});

describe("compareMaterialsByDateDesc", () => {
  it("orders newest first and pushes date-less items to the end", () => {
    const items = [
      mat({ id: "old", date: "2024-01-01" }),
      mat({ id: "none", date: null }),
      mat({ id: "new", date: "2026-06-01" }),
    ];
    const sorted = [...items].sort(compareMaterialsByDateDesc).map((m) => m.id);
    expect(sorted).toEqual(["new", "old", "none"]);
  });

  it("treats two date-less items as equal", () => {
    expect(compareMaterialsByDateDesc(mat({ date: null }), mat({ date: null }))).toBe(0);
  });
});

describe("reduceFacets", () => {
  const taxonomy = {
    programs: [
      {
        id: "p1",
        slug: "a",
        name_pl: "A",
        name_en: "A",
        kind: "program" as const,
        description_pl: null,
        description_en: null,
        role_pl: null,
        role_en: null,
      },
      {
        id: "p2",
        slug: "b",
        name_pl: "B",
        name_en: "B",
        kind: "program" as const,
        description_pl: null,
        description_en: null,
        role_pl: null,
        role_en: null,
      },
    ],
    regions: [
      { id: "r1", slug: "eu", name_pl: "UE", name_en: "EU" },
      { id: "r2", slug: "us", name_pl: "USA", name_en: "US" },
    ],
    categories: [
      { id: "c1", slug: "sec", name_pl: "Bezp.", name_en: "Security" },
    ],
  };

  it("keeps only taxonomy entries present in the materials", () => {
    const materials = [
      mat({ programIds: ["p1"], regionIds: ["r2"], categoryIds: [] }),
      mat({ programIds: [], regionIds: [], categoryIds: ["c1"] }),
    ];
    const facets = reduceFacets(materials, taxonomy);
    expect(facets.programs.map((p) => p.id)).toEqual(["p1"]);
    expect(facets.regions.map((r) => r.id)).toEqual(["r2"]);
    expect(facets.categories.map((c) => c.id)).toEqual(["c1"]);
  });

  it("returns empty facet lists when nothing is referenced", () => {
    const facets = reduceFacets([mat({})], taxonomy);
    expect(facets.programs).toEqual([]);
    expect(facets.regions).toEqual([]);
    expect(facets.categories).toEqual([]);
  });
});

describe("buildExpertProfile", () => {
  it("merges profiles + author_profiles and derives is_expert from badges", () => {
    const expert = buildExpertProfile(
      {
        id: "u1",
        slug: "jan-kowalski",
        display_name: "Jan Kowalski",
        bio_pl: "Krótkie bio",
        verified_at: "2026-01-01",
        website_url: "https://profiles.example/jan",
        twitter_url: "https://x.com/jan",
      },
      {
        job_title: "Analityk",
        company: "NES",
        full_bio_pl: "<p>Pełne bio</p>",
        org_functions: [{ pl: "Dyrektor", en: "Director" }],
        contact_email: "jan@nes.test",
        media_contact_email: "media@nes.test",
        website_url: null,
      },
      ["expert", "verified"],
    );
    expect(expert.id).toBe("u1");
    expect(expert.is_expert).toBe(true);
    expect(expert.job_title).toBe("Analityk");
    expect(expert.full_bio_pl).toBe("<p>Pełne bio</p>");
    expect(expert.org_functions).toEqual([{ pl: "Dyrektor", en: "Director" }]);
    expect(expert.media_contact_email).toBe("media@nes.test");
    // author_profiles.website_url null → fallback do profiles.website_url
    expect(expert.website_url).toBe("https://profiles.example/jan");
    // twitter tylko w profiles (author_profiles.x_url brak) → fallback
    expect(expert.twitter_url).toBe("https://x.com/jan");
  });

  it("handles a missing author_profiles row (all hub fields null)", () => {
    const expert = buildExpertProfile({ id: "u2", display_name: "Anna" }, null, []);
    expect(expert.is_expert).toBe(false);
    expect(expert.job_title).toBeNull();
    expect(expert.org_functions).toEqual([]);
    expect(expert.media_contact_email).toBeNull();
  });
});

describe("mapProgramMembers", () => {
  it("maps nested program with role, dropping rows whose program is null", () => {
    const out = mapProgramMembers([
      {
        role_pl: "Dyrektorka",
        role_en: "Director",
        program: {
          id: "p1",
          slug: "sec",
          name_pl: "Bezpieczeństwo",
          name_en: "Security",
          kind: "program",
          description_pl: null,
          description_en: null,
        },
      },
      { role_pl: "x", role_en: "y", program: null },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: "p1", role_pl: "Dyrektorka", kind: "program" });
  });

  it("defaults kind to program when missing", () => {
    const out = mapProgramMembers([
      { role_pl: null, role_en: null, program: { id: "p", slug: "s", name_pl: "N", name_en: "N" } },
    ]);
    expect(out[0].kind).toBe("program");
  });
});

describe("mapExpertiseAreaRows / mapMediaMentionRows", () => {
  it("unwraps nested area rows", () => {
    const out = mapExpertiseAreaRows([
      { area: { id: "a1", slug: "sec", name_pl: "Bezp.", name_en: "Security" } },
      { area: null },
    ]);
    expect(out).toEqual([{ id: "a1", slug: "sec", name_pl: "Bezp.", name_en: "Security" }]);
  });

  it("maps media mentions and defaults kind to quote", () => {
    const out = mapMediaMentionRows([
      {
        id: "m1",
        outlet: "Politico",
        title: "T",
        url: "https://x",
        kind: "interview",
        language: "en",
        published_on: "2026-05-01",
      },
      { id: "m2", outlet: "TOK FM", title: "R", url: null, published_on: "2026-04-01" },
    ]);
    expect(out[0].kind).toBe("interview");
    expect(out[1].kind).toBe("quote");
    expect(out[1].url).toBeNull();
  });
});

describe("row → material converters", () => {
  it("postRowToMaterial derives kind and pivots, and marks coauthor", () => {
    const pivots: PostPivots = {
      categories: new Map([["post1", ["c1"]]]),
      programs: new Map([["post1", ["p1", "p2"]]]),
      regions: new Map(),
    };
    const m = postRowToMaterial(
      {
        id: "post1",
        slug: "my-post",
        title_pl: "T",
        post_format: "report",
        published_at: "2026-05-01",
      },
      true,
      pivots,
    );
    expect(m).toMatchObject({
      id: "post1",
      kind: "report",
      href: "/post/my-post",
      programIds: ["p1", "p2"],
      categoryIds: ["c1"],
      regionIds: [],
      isCoauthor: true,
    });
  });

  it("podcastRowToMaterial and eventRowToMaterial build correct hrefs and single-id pivots", () => {
    const pod = podcastRowToMaterial({
      id: "pod1",
      slug: "ep-1",
      title_pl: "Odcinek",
      program_id: "p1",
      region_id: null,
      published_at: "2026-03-01",
    });
    expect(pod).toMatchObject({
      kind: "podcast",
      href: "/podcast/ep-1",
      programIds: ["p1"],
      regionIds: [],
    });

    const ev = eventRowToMaterial({
      id: "ev1",
      slug: "briefing",
      title_pl: "Briefing",
      description_pl: "Opis",
      starts_at: "2026-07-01",
      region_id: "r1",
    });
    expect(ev).toMatchObject({
      kind: "event",
      href: "/events/briefing",
      excerpt_pl: "Opis",
      regionIds: ["r1"],
      programIds: [],
    });
  });
});

describe("groupPivot", () => {
  it("groups values by post_id", () => {
    const g = groupPivot(
      [
        { post_id: "a", program_id: "p1" },
        { post_id: "a", program_id: "p2" },
        { post_id: "b", program_id: "p3" },
      ],
      "program_id",
    );
    expect(g.get("a")).toEqual(["p1", "p2"]);
    expect(g.get("b")).toEqual(["p3"]);
  });

  it("uses NO_PIVOTS shape safely for a post with no pivots", () => {
    const m = postRowToMaterial({ id: "z", slug: "z", title_pl: "Z" }, false, NO_PIVOTS);
    expect(m.programIds).toEqual([]);
    expect(m.categoryIds).toEqual([]);
  });
});
