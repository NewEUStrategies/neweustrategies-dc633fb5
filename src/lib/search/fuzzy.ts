// Tiny fuzzy matcher. Sublime-style: subsequence match with bonuses for
// consecutive hits, word boundaries, and prefix. Returns a score (higher
// = better) plus the matched character indexes for highlighting.
//
// Designed to be allocation-light enough to run synchronously on a list of
// a few thousand items during typing.

export interface FuzzyMatch {
  score: number;
  indexes: number[];
}

/**
 * Match `query` against `target` (case-insensitive). Returns null if any
 * character of the query is not present in order.
 */
export function fuzzyMatch(query: string, target: string): FuzzyMatch | null {
  const q = query.trim().toLowerCase();
  if (!q) return { score: 0, indexes: [] };
  const t = target.toLowerCase();
  const indexes: number[] = [];
  let score = 0;
  let qi = 0;
  let prev = -2;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] !== q[qi]) continue;
    let bonus = 1;
    if (i === 0)
      bonus += 8; // start of string
    else {
      const before = t[i - 1];
      if (before === " " || before === "-" || before === "_" || before === "/" || before === ".")
        bonus += 6;
      if (before !== before.toLowerCase() && t[i] === t[i].toLowerCase()) bonus += 2;
    }
    if (i === prev + 1) bonus += 5; // consecutive
    score += bonus;
    indexes.push(i);
    prev = i;
    qi++;
  }
  if (qi < q.length) return null;
  // Penalize long targets so a short exact-ish hit beats a long match.
  score -= Math.max(0, t.length - q.length) * 0.05;
  return { score, indexes };
}

export interface RankableItem {
  /** Single string used for matching. Combine label + keywords + path. */
  haystack: string;
}

export function rankItems<T extends RankableItem>(
  items: readonly T[],
  query: string,
  limit = 50,
): T[] {
  const q = query.trim();
  if (!q) return items.slice(0, limit);
  const scored: Array<{ item: T; score: number }> = [];
  for (const item of items) {
    const m = fuzzyMatch(q, item.haystack);
    if (m) scored.push({ item, score: m.score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.item);
}
