// Pure helpers for the universal public resolver route (src/routes/$.tsx).
// Kept in their own module (no React, no router imports) so the critical-path
// logic that turns a URL splat into content lookups - and derives the SEO meta
// description - is unit-testable in isolation.
import { SERP_DESCRIPTION_FONT_PX, SERP_DESCRIPTION_LIMIT_PX, truncateToPx } from "@/lib/seo/serp";

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
 * strip tags, collapse whitespace, trim, and fit Google's PIXEL budget for the
 * snippet (~960 px), cutting at a word boundary with an ellipsis. Falls back to
 * the provided fallback (typically the title) when nothing usable remains.
 *
 * Do 2026-10-11 było tu twarde `slice(0, 160)`: 160 znaków polskiego tekstu to
 * ~1 100-1 150 px, więc niemal każdy wpis z dłuższą zajawką dostawał w panelu
 * ostrzeżenie „zostanie ucięty w Google" (i toast przy każdym zapisie), a do
 * wyników szedł opis urwany w pół słowa.
 */
export function metaDescription(raw: string | null | undefined, fallback: string): string {
  const clean = (raw ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return clean
    ? truncateToPx(clean, SERP_DESCRIPTION_FONT_PX, SERP_DESCRIPTION_LIMIT_PX)
    : fallback;
}
