// Pure layout core of the OG-card generator (1200x630 social images). Text
// wrapping and font sizing are computed against an injected measure function,
// so the exact same layout drives the browser canvas renderer AND the unit
// tests (which inject a deterministic measurer). Brand palette mirrors the
// site tokens in styles.css.

export const OG_CARD_WIDTH = 1200;
export const OG_CARD_HEIGHT = 630;

/** Brand palette (styles.css: --brand / --brand-foreground dark theme). */
export const OG_CARD_COLORS = {
  background: "#131822",
  accent: "#FA9346",
  title: "#FFFFFF",
  kicker: "#FA9346",
  footer: "#B9C0CC",
} as const;

export const OG_CARD_PADDING = 80;
const MAX_TEXT_WIDTH = OG_CARD_WIDTH - OG_CARD_PADDING * 2;

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
    const lines = wrapText(clean, MAX_TEXT_WIDTH, fontSize, measure);
    if (lines.length <= MAX_TITLE_LINES) {
      return { fontSize, lineHeight: Math.round(fontSize * 1.16), lines };
    }
  }
  const fontSize = TITLE_SIZES[TITLE_SIZES.length - 1];
  const lines = wrapText(clean, MAX_TEXT_WIDTH, fontSize, measure).slice(0, MAX_TITLE_LINES);
  const last = lines[lines.length - 1];
  if (last && !last.endsWith("…")) lines[lines.length - 1] = `${last.replace(/[,;:.\s]+$/, "")}…`;
  return { fontSize, lineHeight: Math.round(fontSize * 1.16), lines };
}

/** Storage object path for a generated card (media bucket). */
export function ogCardStoragePath(kind: "post" | "page", entityId: string): string {
  return `og-cards/${kind}-${entityId}.png`;
}
