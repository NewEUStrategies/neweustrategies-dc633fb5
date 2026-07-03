import { describe, it, expect } from "vitest";
import {
  mergeRelatedConfig,
  rankRelated,
  RELATED_POSTS_DEFAULTS,
  scoreRelated,
  type RelatedPostsConfig,
} from "@/lib/relatedPosts";
import type { BlogListItem } from "@/lib/queries/public";

const NOW = new Date("2026-06-24T00:00:00Z").getTime();

function makePost(over: Partial<BlogListItem> = {}): BlogListItem {
  return {
    id: "p1",
    slug: "s",
    title_pl: "t",
    title_en: "t",
    excerpt_pl: null,
    excerpt_en: null,
    cover_image_url: null,
    published_at: "2026-06-20T00:00:00Z",
    parent_page_id: "pp",
    href: "/blog/s",
    ...over,
  };
}

describe("mergeRelatedConfig", () => {
  it("returns defaults when both inputs empty", () => {
    expect(mergeRelatedConfig(null, null)).toEqual(RELATED_POSTS_DEFAULTS);
  });

  it("global overrides defaults, per-post overrides global", () => {
    const merged = mergeRelatedConfig({ items_limit: 9, layout: "list" }, { items_limit: 4 });
    expect(merged.items_limit).toBe(4);
    expect(merged.layout).toBe("list");
    expect(merged.columns).toBe(RELATED_POSTS_DEFAULTS.columns);
  });

  it("null/undefined override values do not clobber global", () => {
    const merged = mergeRelatedConfig(
      { layout: "slider" },
      {
        layout: undefined as any,
      },
    );
    expect(merged.layout).toBe("slider");
  });
});

describe("scoreRelated", () => {
  const cfg: Pick<RelatedPostsConfig, "source_strategy" | "recency_boost_days"> = {
    source_strategy: "both",
    recency_boost_days: 30,
  };
  const current = {
    categoryIds: new Set(["c1", "c2"]),
    tagIds: new Set(["t1"]),
    authorId: "u1",
  };

  it("awards +3 per shared category, +2 per shared tag", () => {
    const s = scoreRelated(
      current,
      {
        categoryIds: new Set(["c1"]),
        tagIds: new Set(["t1", "t9"]),
        authorId: null,
      },
      cfg,
      "2026-06-23T00:00:00Z",
      NOW,
    );
    // +3 (c1) +2 (t1) +1 recency = 6
    expect(s).toBe(6);
  });

  it("ignores tags when strategy is 'categories'", () => {
    const s = scoreRelated(
      current,
      { categoryIds: new Set(), tagIds: new Set(["t1"]), authorId: null },
      { source_strategy: "categories", recency_boost_days: 0 },
      null,
      NOW,
    );
    expect(s).toBe(0);
  });

  it("author strategy awards +4 on author match", () => {
    const s = scoreRelated(
      current,
      { categoryIds: new Set(), tagIds: new Set(), authorId: "u1" },
      { source_strategy: "author", recency_boost_days: 0 },
      null,
      NOW,
    );
    expect(s).toBe(4);
  });

  it("recency boost respects window", () => {
    const old = scoreRelated(
      current,
      { categoryIds: new Set(["c1"]), tagIds: new Set(), authorId: null },
      cfg,
      "2025-01-01T00:00:00Z",
      NOW,
    );
    expect(old).toBe(3); // category only, no recency
  });
});

describe("rankRelated", () => {
  it("filters zero scores, sorts by score then recency, applies limit", () => {
    const items = [
      { post: makePost({ id: "a", published_at: "2026-06-20" }), score: 5 },
      { post: makePost({ id: "b", published_at: "2026-06-22" }), score: 5 },
      { post: makePost({ id: "c" }), score: 8 },
      { post: makePost({ id: "d" }), score: 0 },
    ];
    const ranked = rankRelated(items, 2);
    expect(ranked.map((r) => r.post.id)).toEqual(["c", "b"]);
  });
});
