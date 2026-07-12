// Recent reader search queries, persisted in localStorage. Surfaced on focus
// when the query box is empty so returning readers can re-run a past search.
// SSR- and error-safe (degrades to an empty list when storage is unavailable).
const KEY = "recent-searches:v1";
const MAX = 6;

export function getRecentSearches(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr.filter((x): x is string => typeof x === "string").slice(0, MAX);
  } catch {
    return [];
  }
}

export function addRecentSearch(query: string): void {
  if (typeof window === "undefined") return;
  const q = query.trim();
  if (q.length < 2) return;
  try {
    const prev = getRecentSearches().filter((x) => x.toLowerCase() !== q.toLowerCase());
    const next = [q, ...prev].slice(0, MAX);
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable */
  }
}

export function clearRecentSearches(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
