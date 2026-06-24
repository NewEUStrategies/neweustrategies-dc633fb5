// Related posts: shared types, defaults, merge helper, and pure scoring
// algorithm used by the public query layer and unit tests.
import type { BlogListItem } from "@/lib/queries/public";

export type RelatedPosition = "end" | "sidebar" | "after_paragraph";
export type RelatedLayout = "grid" | "list" | "slider";
export type RelatedSource = "categories" | "tags" | "both" | "author";

export interface RelatedPostsConfig {
  enabled: boolean;
  position: RelatedPosition;
  after_paragraph: number;
  layout: RelatedLayout;
  columns: 2 | 3 | 4;
  items_limit: number;
  source_strategy: RelatedSource;
  show_excerpt: boolean;
  show_meta: boolean;
  show_cover: boolean;
  recency_boost_days: number;
  slider_autoplay: boolean;
  slider_interval_ms: number;
  title_pl: string;
  title_en: string;
}

export type RelatedPostsOverride = Partial<RelatedPostsConfig>;

export const RELATED_POSTS_DEFAULTS: RelatedPostsConfig = {
  enabled: true,
  position: "end",
  after_paragraph: 3,
  layout: "grid",
  columns: 3,
  items_limit: 6,
  source_strategy: "both",
  show_excerpt: true,
  show_meta: true,
  show_cover: true,
  recency_boost_days: 30,
  slider_autoplay: false,
  slider_interval_ms: 5000,
  title_pl: "Powiązane wpisy",
  title_en: "Related posts",
};

export function mergeRelatedConfig(
  global: Partial<RelatedPostsConfig> | null | undefined,
  override: RelatedPostsOverride | null | undefined,
): RelatedPostsConfig {
  const base: RelatedPostsConfig = { ...RELATED_POSTS_DEFAULTS, ...(global ?? {}) };
  if (!override) return base;
  // Only spread defined override keys so `null`/missing values don't clobber the global.
  const cleaned: RelatedPostsOverride = {};
  (Object.keys(override) as Array<keyof RelatedPostsOverride>).forEach((k) => {
    const v = override[k];
    if (v !== undefined && v !== null) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (cleaned as any)[k] = v;
    }
  });
  return { ...base, ...cleaned };
}

// -- Scoring algorithm -------------------------------------------------------

export interface RelatedCandidateMeta {
  categoryIds: ReadonlySet<string>;
  tagIds: ReadonlySet<string>;
  authorId: string | null;
}

export interface CurrentPostMeta {
  categoryIds: ReadonlySet<string>;
  tagIds: ReadonlySet<string>;
  authorId: string | null;
}

// Returns score 0+ for a candidate; tie-broken by publish recency outside.
export function scoreRelated(
  current: CurrentPostMeta,
  cand: RelatedCandidateMeta,
  cfg: Pick<RelatedPostsConfig, "source_strategy" | "recency_boost_days">,
  publishedAt: string | null,
  now: number = Date.now(),
): number {
  let score = 0;
  if (cfg.source_strategy === "categories" || cfg.source_strategy === "both") {
    cand.categoryIds.forEach((id) => {
      if (current.categoryIds.has(id)) score += 3;
    });
  }
  if (cfg.source_strategy === "tags" || cfg.source_strategy === "both") {
    cand.tagIds.forEach((id) => {
      if (current.tagIds.has(id)) score += 2;
    });
  }
  if (cfg.source_strategy === "author") {
    if (cand.authorId && current.authorId && cand.authorId === current.authorId) {
      score += 4;
    }
  } else if (cand.authorId && current.authorId && cand.authorId === current.authorId) {
    // minor author match bonus for non-author strategies
    score += 1;
  }
  if (publishedAt && cfg.recency_boost_days > 0) {
    const ageDays = (now - new Date(publishedAt).getTime()) / 86400000;
    if (ageDays >= 0 && ageDays < cfg.recency_boost_days) score += 1;
  }
  return score;
}

export interface ScoredRelated {
  post: BlogListItem;
  score: number;
}

export function rankRelated<T extends { post: BlogListItem; score: number }>(
  items: T[],
  limit: number,
): T[] {
  return items
    .filter((i) => i.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (b.post.published_at ?? "").localeCompare(a.post.published_at ?? "");
    })
    .slice(0, limit);
}
