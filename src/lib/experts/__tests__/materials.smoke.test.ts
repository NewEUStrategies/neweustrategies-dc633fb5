import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ExpertHubData, ExpertMaterial, ExpertMaterialsPage } from "@/lib/experts/types";

// Klient Supabase jest tworzony eagernie przy imporcie modułu i bez zmiennych
// środowiskowych rzuca - mockujemy go, żeby przetestować kontrakt warstwy
// danych (kształt klucza, argumenty RPC, fallback legacy) bez sieci.
const rpcMock = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (fn: string, args: Record<string, unknown>) => rpcMock(fn, args),
    from: () => ({ select: () => ({ eq: () => ({}) }) }),
  },
}));

// Hub dla ścieżki legacy - mock zamiast fan-outu zapytań.
const hubMock = vi.fn();
vi.mock("@/lib/experts/queries", () => ({
  fetchExpertHubCached: (slugOrId: string) => hubMock(slugOrId),
}));

function mat(partial: Partial<ExpertMaterial>): ExpertMaterial {
  return {
    id: partial.id ?? Math.random().toString(36).slice(2),
    kind: partial.kind ?? "article",
    title_pl: partial.title_pl ?? "PL",
    title_en: partial.title_en ?? "EN",
    excerpt_pl: null,
    excerpt_en: null,
    cover_url: null,
    date: partial.date ?? null,
    href: "#",
    programIds: partial.programIds ?? [],
    regionIds: partial.regionIds ?? [],
    categoryIds: partial.categoryIds ?? [],
    tagIds: partial.tagIds ?? [],
    isCoauthor: false,
  };
}

const NULL_FILTERS = { kind: null, program: null, region: null, topic: null, year: null } as const;

async function runQuery(
  slug: string,
  params: { page: number; filters: typeof NULL_FILTERS | Record<string, unknown> },
): Promise<ExpertMaterialsPage | null> {
  const { expertMaterialsQueryOptions } = await import("@/lib/experts/materials");
  const opts = expertMaterialsQueryOptions(
    slug,
    params as Parameters<typeof expertMaterialsQueryOptions>[1],
  );
  const queryFn = opts.queryFn as unknown as () => Promise<ExpertMaterialsPage | null>;
  return queryFn();
}

describe("expertMaterialsQueryOptions (smoke + fallback)", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    hubMock.mockReset();
  });

  it("builds a fully parameterized, stable query key", async () => {
    const { expertMaterialsQueryOptions } = await import("@/lib/experts/materials");
    const opts = expertMaterialsQueryOptions("emily-harding", {
      page: 2,
      filters: { ...NULL_FILTERS, kind: "report", topic: "energia" },
    });
    expect(opts.queryKey).toEqual([
      "public",
      "expert-materials",
      "emily-harding",
      {
        page: 2,
        pageSize: 9,
        kind: "report",
        program: null,
        region: null,
        topic: "energia",
        year: null,
      },
    ]);
    expect(typeof opts.queryFn).toBe("function");
  });

  it("calls the RPC with slug filters and maps the returned window", async () => {
    rpcMock.mockResolvedValue({
      data: {
        found: true,
        total: 10,
        page: 2,
        page_size: 9,
        items: [
          {
            source: "post",
            is_coauthor: false,
            row: {
              id: "post1",
              slug: "wpis",
              title_pl: "Wpis",
              title_en: "Post",
              published_at: "2026-02-01T00:00:00+00:00",
              post_format: "standard",
              author_id: "e1",
            },
          },
        ],
        post_categories: [],
        post_programs: [],
        post_regions: [],
        post_tags: [],
      },
      error: null,
    });

    const page = await runQuery("jan-kowalski", {
      page: 2,
      filters: { ...NULL_FILTERS, topic: "energia", year: 2026 },
    });

    expect(rpcMock).toHaveBeenCalledWith("get_expert_materials", {
      _slug_or_id: "jan-kowalski",
      _kind: undefined,
      _program_slug: undefined,
      _region_slug: undefined,
      _tag_slug: "energia",
      _year: 2026,
      _page: 2,
      _page_size: 9,
    });
    expect(page?.total).toBe(10);
    expect(page?.materials.map((m) => m.id)).toEqual(["post1"]);
    expect(hubMock).not.toHaveBeenCalled();
  });

  it("maps found=false to null (route renders 404, not an empty archive)", async () => {
    rpcMock.mockResolvedValue({ data: { found: false }, error: null });
    await expect(runQuery("ghost", { page: 1, filters: NULL_FILTERS })).resolves.toBeNull();
    expect(hubMock).not.toHaveBeenCalled();
  });

  it("falls back to the hub filter+slice path when the RPC is missing", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "function does not exist" } });
    const materials = [
      mat({ id: "m1", kind: "report", date: "2026-01-01", tagIds: ["t1"] }),
      mat({ id: "m2", kind: "article", date: "2025-06-01", tagIds: ["t1"] }),
      mat({ id: "m3", kind: "report", date: "2024-01-01" }),
    ];
    const hub = {
      materials,
      facets: {
        programs: [],
        regions: [],
        categories: [],
        tags: [{ id: "t1", slug: "energia", name: "Energia" }],
      },
    } as unknown as ExpertHubData;
    hubMock.mockResolvedValue(hub);

    const page = await runQuery("legacy-window", {
      page: 1,
      filters: { ...NULL_FILTERS, topic: "energia" },
    });

    expect(hubMock).toHaveBeenCalledWith("legacy-window");
    expect(page?.total).toBe(2);
    expect(page?.materials.map((m) => m.id)).toEqual(["m1", "m2"]);
  });

  it("legacy path keeps SQL parity for an out-of-range page", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "missing" } });
    hubMock.mockResolvedValue({
      materials: [mat({ id: "only" })],
      facets: { programs: [], regions: [], categories: [], tags: [] },
    } as unknown as ExpertHubData);

    const page = await runQuery("legacy-window-2", { page: 5, filters: NULL_FILTERS });
    expect(page?.materials).toEqual([]);
    expect(page?.total).toBe(1);
  });
});
