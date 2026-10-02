// Pure layout core of the OG-card generator (1200x630 social images). Text
// wrapping and font sizing are computed against an injected measure function,
// so the exact same layout drives the browser canvas renderer AND the unit
// tests (which inject a deterministic measurer). Brand palette mirrors the
// site tokens in styles.css.

export const OG_CARD_WIDTH = 1200;
export const OG_CARD_HEIGHT = 630;

/** Brand palette (styles.css: --brand / --brand-foreground dark theme). */
export const OG_CARD_COLORS = {
  background: "#141414",
  accent: "#FA9346",
  title: "#FFFFFF",
  kicker: "#FA9346",
  footer: "#B9C0CC",
} as const;

export const OG_CARD_PADDING = 80;
/** Text budget of one line: card width minus the left and right padding. */
export const OG_CARD_MAX_TEXT_WIDTH = OG_CARD_WIDTH - OG_CARD_PADDING * 2;

export interface OgCardInput {
  /** Headline (post/page title). */
  title: string;
  /** Small uppercase kicker above the title (section/category). */
  kicker?: string | null;
  /** Footer brand line (site name). */
  siteName: string;
}

export interface OgCardTitleLayout {
  fontSize: number;
  lineHeight: number;
  lines: string[];
}

export type MeasureFn = (text: string, fontSizePx: number) => number;

/**
 * Greedy word wrap against a pixel budget. Words longer than the budget are
 * hard-truncated with an ellipsis rather than overflowing the canvas.
 */
export function wrapText(
  text: string,
  maxWidthPx: number,
  fontSizePx: number,
  measure: MeasureFn,
): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (measure(candidate, fontSizePx) <= maxWidthPx) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    if (measure(word, fontSizePx) <= maxWidthPx) {
      current = word;
    } else {
      let clipped = word;
      while (clipped.length > 1 && measure(`${clipped}…`, fontSizePx) > maxWidthPx) {
        clipped = clipped.slice(0, -1);
      }
      lines.push(`${clipped}…`);
      current = "";
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * Split text into user-perceived characters (grapheme clusters), so a cut
 * never lands inside a ZWJ sequence (👨‍👩‍👧), a flag (🇵🇱), a keycap or an
 * emoji with a skin-tone/VS16 modifier. `Intl.Segmenter` exists in every
 * browser that has the canvas this card is drawn on; without it we fall back
 * to code points (no lone surrogates, but such sequences CAN be split).
 */
function splitGraphemes(text: string): string[] {
  const Segmenter = typeof Intl === "undefined" ? undefined : Intl.Segmenter;
  if (typeof Segmenter !== "function") return Array.from(text);
  return Array.from(
    new Segmenter(undefined, { granularity: "grapheme" }).segment(text),
    (s) => s.segment,
  );
}

/**
 * A trailing unit dropped before the "…": whitespace, , ; : . and - only in
 * the code-point fallback - a dangling ZWJ (U+200D) or VS16 (U+FE0F). Tested
 * per WHOLE unit, so a grapheme like "❤️" (U+2764 U+FE0F) is never stripped
 * of its own selector.
 */
const DANGLING_UNIT = /^(?:[,;:.\s]|\u200D|\uFE0F)+$/u;

/**
 * Fit text into ONE line of `maxWidthPx`: unchanged when it fits, otherwise the
 * longest prefix of whole grapheme clusters (see splitGraphemes) plus an
 * ellipsis, with dangling whitespace/punctuation dropped before the "…". Used
 * for the kicker, which - unlike the title - has a single line and comes from
 * content (section/category name), so its length is set by the newsroom, not
 * by code. Binary search: O(log n) measurements instead of one per removed
 * character. Returns "" when not even "…" fits.
 */
export function fitSingleLine(
  text: string,
  maxWidthPx: number,
  fontSizePx: number,
  measure: MeasureFn,
): string {
  if (measure(text, fontSizePx) <= maxWidthPx) return text;
  const units = splitGraphemes(text);
  const candidate = (n: number) => {
    let end = n;
    while (end > 0 && DANGLING_UNIT.test(units[end - 1])) end--;
    return `${units.slice(0, end).join("")}…`;
  };
  let best = "";
  let lo = 0;
  let hi = units.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const line = candidate(mid);
    if (measure(line, fontSizePx) <= maxWidthPx) {
      best = line;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

const TITLE_SIZES = [72, 64, 56, 48, 42] as const;
const MAX_TITLE_LINES = 4;

/**
 * Pick the largest title font size whose wrapped text fits in MAX_TITLE_LINES;
 * at the smallest size the text is clamped to the line budget with an
 * ellipsis on the final line.
 */
export function layoutOgTitle(title: string, measure: MeasureFn): OgCardTitleLayout {
  const clean = title.trim().replace(/\s+/g, " ");
  for (const fontSize of TITLE_SIZES) {
    const lines = wrapText(clean, OG_CARD_MAX_TEXT_WIDTH, fontSize, measure);
    if (lines.length <= MAX_TITLE_LINES) {
      return { fontSize, lineHeight: Math.round(fontSize * 1.16), lines };
    }
  }
  const fontSize = TITLE_SIZES[TITLE_SIZES.length - 1];
  const lines = wrapText(clean, OG_CARD_MAX_TEXT_WIDTH, fontSize, measure).slice(
    0,
    MAX_TITLE_LINES,
  );
  const last = lines[lines.length - 1];
  if (last && !last.endsWith("…")) lines[lines.length - 1] = `${last.replace(/[,;:.\s]+$/, "")}…`;
  return { fontSize, lineHeight: Math.round(fontSize * 1.16), lines };
}

/** Storage object path for a generated card (media bucket). */
export function ogCardStoragePath(kind: "post" | "page", entityId: string): string {
  return `og-cards/${kind}-${entityId}.png`;
}
