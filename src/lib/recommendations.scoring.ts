// Pure scoring logic for post recommendations.
// Extracted from recommendations.functions.ts so it can be unit-tested
// without a Supabase context and reused by other feeds.
//
// Weights:
//   +4 per followed author match (strong signal - explicit "I want more from X")
//   +3 per followed category match
//   +2 per followed tag match
//   +1 per category/tag overlap with recently read posts
//   +1 recency bonus if published within 30 days
export const SCORE_WEIGHTS = {
  followedAuthor: 4,
  followedCategory: 3,
  followedTag: 2,
  historyCategory: 1,
  historyTag: 1,
  recency: 1,
} as const;

export interface ScoreCandidate {
  id: string;
  author_id: string | null;
  published_at: string | null;
  categoryIds: string[];
  tagIds: string[];
}

export interface ScoringSignals {
  followedAuthors: ReadonlySet<string>;
  followedCategories: ReadonlySet<string>;
  followedTags: ReadonlySet<string>;
  historyCategories: ReadonlySet<string>;
  historyTags: ReadonlySet<string>;
  now?: number;
}

export function scorePost(candidate: ScoreCandidate, signals: ScoringSignals): number {
  let score = 0;
  if (candidate.author_id && signals.followedAuthors.has(candidate.author_id)) {
    score += SCORE_WEIGHTS.followedAuthor;
  }
  for (const c of candidate.categoryIds) {
    if (signals.followedCategories.has(c)) score += SCORE_WEIGHTS.followedCategory;
    else if (signals.historyCategories.has(c)) score += SCORE_WEIGHTS.historyCategory;
  }
  for (const t of candidate.tagIds) {
    if (signals.followedTags.has(t)) score += SCORE_WEIGHTS.followedTag;
    else if (signals.historyTags.has(t)) score += SCORE_WEIGHTS.historyTag;
  }
  if (candidate.published_at) {
    const now = signals.now ?? Date.now();
    const ageDays = (now - new Date(candidate.published_at).getTime()) / 86_400_000;
    if (ageDays < 30) score += SCORE_WEIGHTS.recency;
  }
  return score;
}
