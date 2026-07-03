// Pure helpers for the universal public resolver route (src/routes/$.tsx).
// Kept in their own module (no React, no router imports) so the critical-path
// logic that turns a URL splat into content lookups - and derives the SEO meta
// description - is unit-testable in isolation.

/**
 * Split a router splat ("a/b/c") into clean path segments, dropping empty parts
 * from leading/trailing/duplicate slashes. An empty or slash-only splat yields
 * an empty array (the resolver treats that as "no content" → 404).
 */
export function splatToSegments(splat: string): string[] {
  return splat.split("/").filter(Boolean);
}

/**
 * Derive a meta-description string from raw content (an excerpt or body HTML):
 * strip tags, collapse whitespace, trim, and cap at 160 chars. Falls back to the
 * provided fallback (typically the title) when nothing usable remains.
 */
export function metaDescription(raw: string | null | undefined, fallback: string): string {
  const clean = (raw ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return clean ? clean.slice(0, 160) : fallback;
}
