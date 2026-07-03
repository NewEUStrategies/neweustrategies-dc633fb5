// blockQueryOptionsList is the SSR-prefetch contract of the blocks engine:
// same block.data inputs must map to the same queryKey the views resolve, or
// the loader warms a cache entry nobody reads (and crawlers get skeletons).
import { describe, expect, it } from "vitest";
import type { BlocksDoc } from "@/lib/blocks/types";
import {
  blockQueryOptionsList,
  calendarTarget,
  latestPostsBlockQueryOptions,
  morePostsBlockQueryOptions,
  queryLoopBlockQueryOptions,
  relatedPostsBlockQueryOptions,
} from "@/lib/queries/blocks";

function docWith(blocks: BlocksDoc["blocks"]): BlocksDoc {
  return { version: 1, blocks };
}

describe("blockQueryOptionsList", () => {
  it("maps latest-posts with the same clamped inputs the renderer uses", () => {
    const doc = docWith([
      { id: "a", type: "latest-posts", data: { count: 999, category: "europa" } },
    ]);
    const [opts] = blockQueryOptionsList(doc, "pl");
    expect(opts?.queryKey).toEqual(
      latestPostsBlockQueryOptions({ count: 50, category: "europa" }).queryKey,
    );
  });

  it("covers taxonomy, tags, navigation and calendar blocks", () => {
    const doc = docWith([
      { id: "a", type: "categories-list", data: {} },
      { id: "b", type: "archives", data: {} },
      { id: "c", type: "tag-cloud", data: { count: 12 } },
      { id: "d", type: "navigation", data: {} },
      { id: "e", type: "calendar", data: { month: "2026-06" } },
    ]);
    const keys = blockQueryOptionsList(doc, "en").map((o) => o.queryKey);
    expect(keys).toContainEqual(["public", "blocks", "categories", "en"]);
    expect(keys).toContainEqual(["public", "blocks", "archives", "en"]);
    expect(keys).toContainEqual(["public", "blocks", "tags", { limit: 12 }]);
    expect(keys).toContainEqual(["public", "blocks", "navigation"]);
    expect(keys).toContainEqual(["public", "blocks", "calendar", { year: 2026, month: 6 }]);
  });

  it("threads the current-post context into related/more-posts/neighbor", () => {
    const doc = docWith([
      { id: "a", type: "related-posts", data: { strategy: "tag", limit: 4 } },
      { id: "b", type: "more-posts", data: { strategy: "category", limit: 6 } },
      { id: "c", type: "post-navigation-link", data: { direction: "prev" } },
    ]);
    const ctx = {
      postId: "post-1",
      publishedAt: "2026-06-01T10:00:00Z",
      authorId: "author-1",
      categorySlugs: ["europa"],
      tagSlugs: ["ue"],
    };
    const keys = blockQueryOptionsList(doc, "pl", ctx).map((o) => o.queryKey);
    expect(keys).toContainEqual(
      relatedPostsBlockQueryOptions({
        currentId: "post-1",
        strategy: "tag",
        categorySlugs: ["europa"],
        tagSlugs: ["ue"],
        authorId: "author-1",
        limit: 4,
      }).queryKey,
    );
    expect(keys).toContainEqual(
      morePostsBlockQueryOptions({ strategy: "category", limit: 6, categorySlug: "europa" })
        .queryKey,
    );
    expect(keys).toContainEqual([
      "public",
      "blocks",
      "post-neighbor",
      { currentId: "post-1", publishedAt: "2026-06-01T10:00:00Z", direction: "prev" },
    ]);
  });

  it("skips context-dependent blocks when the context is missing (pages)", () => {
    const doc = docWith([
      { id: "a", type: "post-navigation-link", data: {} },
      { id: "b", type: "author-bio", data: {} },
    ]);
    expect(blockQueryOptionsList(doc, "pl", {})).toHaveLength(0);
  });

  it("ignores presentational blocks", () => {
    const doc = docWith([
      { id: "a", type: "paragraph", data: { text: "hej" } },
      { id: "b", type: "heading", data: { level: 2 } },
    ]);
    expect(blockQueryOptionsList(doc, "pl")).toHaveLength(0);
  });

  it("query-loop key matches the view's inputs", () => {
    const doc = docWith([
      { id: "a", type: "query-loop", data: { categorySlug: "swiat", limit: 9, orderBy: "title" } },
    ]);
    const [opts] = blockQueryOptionsList(doc, "en");
    expect(opts?.queryKey).toEqual(
      queryLoopBlockQueryOptions({ categorySlug: "swiat", limit: 9, orderBy: "title", lang: "en" })
        .queryKey,
    );
  });
});

describe("calendarTarget", () => {
  it("parses YYYY-MM and falls back to the current month", () => {
    expect(calendarTarget("2026-02")).toEqual({ year: 2026, month: 2 });
    const now = new Date();
    expect(calendarTarget("")).toEqual({ year: now.getFullYear(), month: now.getMonth() + 1 });
  });
});
