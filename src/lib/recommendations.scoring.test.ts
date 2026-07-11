import { describe, it, expect } from "vitest";
import { scorePost, SCORE_WEIGHTS } from "./recommendations.scoring";

const emptySignals = {
  followedAuthors: new Set<string>(),
  followedCategories: new Set<string>(),
  followedTags: new Set<string>(),
  historyCategories: new Set<string>(),
  historyTags: new Set<string>(),
  now: new Date("2026-07-11").getTime(),
};

describe("scorePost", () => {
  it("returns 0 when no signals overlap", () => {
    expect(
      scorePost(
        { id: "p1", author_id: "a1", published_at: null, categoryIds: [], tagIds: [] },
        emptySignals,
      ),
    ).toBe(0);
  });

  it("adds +4 for followed author", () => {
    expect(
      scorePost(
        { id: "p1", author_id: "a1", published_at: null, categoryIds: [], tagIds: [] },
        { ...emptySignals, followedAuthors: new Set(["a1"]) },
      ),
    ).toBe(SCORE_WEIGHTS.followedAuthor);
  });

  it("prefers followed category over history category", () => {
    const signals = {
      ...emptySignals,
      followedCategories: new Set(["c1"]),
      historyCategories: new Set(["c1"]),
    };
    expect(
      scorePost(
        { id: "p", author_id: null, published_at: null, categoryIds: ["c1"], tagIds: [] },
        signals,
      ),
    ).toBe(SCORE_WEIGHTS.followedCategory);
  });

  it("stacks author + category + tag + recency", () => {
    const signals = {
      ...emptySignals,
      followedAuthors: new Set(["a1"]),
      followedCategories: new Set(["c1"]),
      followedTags: new Set(["t1"]),
    };
    const recent = new Date(emptySignals.now - 5 * 86_400_000).toISOString();
    expect(
      scorePost(
        { id: "p", author_id: "a1", published_at: recent, categoryIds: ["c1"], tagIds: ["t1"] },
        signals,
      ),
    ).toBe(
      SCORE_WEIGHTS.followedAuthor +
        SCORE_WEIGHTS.followedCategory +
        SCORE_WEIGHTS.followedTag +
        SCORE_WEIGHTS.recency,
    );
  });

  it("skips recency bonus for posts older than 30 days", () => {
    const old = new Date(emptySignals.now - 60 * 86_400_000).toISOString();
    expect(
      scorePost(
        { id: "p", author_id: null, published_at: old, categoryIds: [], tagIds: [] },
        emptySignals,
      ),
    ).toBe(0);
  });
});
