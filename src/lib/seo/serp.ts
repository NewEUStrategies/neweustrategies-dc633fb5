// SERP snippet metrics: Google truncates titles and descriptions by rendered
// PIXEL width (Arial 20px / 14px), not by character count, so a plain length
// counter misleads editors ("WWW" is 3 chars but 3x wider than "iii"). This
// module estimates the rendered width with a per-character-class width table -
// the same approach Yoast uses - and grades the result for the admin panel.
// Pure and framework-free, shared by the SERP preview and unit tests.

/** Approximate advance widths (px) for Arial at 20px (SERP title size). */
const TITLE_FONT_PX = 20;
/** Google cuts desktop titles at ~600px and descriptions at ~960px. */
export const SERP_TITLE_LIMIT_PX = 600;
export const SERP_DESCRIPTION_LIMIT_PX = 960;

/** Sensible authoring ranges (px) used for grading, mirroring Yoast's bounds. */
export const SERP_TITLE_MIN_PX = 200;
export const SERP_DESCRIPTION_MIN_PX = 400;

// Width classes as fractions of the font size (empirically close to Arial
// metrics; exactness is not required - the grade bands are wide).
const NARROW = 0.28; // i j l ' | ! .
const THIN = 0.42; // f t r ( ) [ ] - " space-ish
const REGULAR = 0.56; // most lowercase, digits
const WIDE = 0.72; // uppercase, some lowercase (m w handled below)
const EXTRA_WIDE = 0.92; // m M w W @

function charWidthFactor(ch: string): number {
  if (/[ijl'|!.,:;]/.test(ch)) return NARROW;
  if (/[ftr()[\]"\- ]/.test(ch)) return THIN;
  if (/[mwMW@]/.test(ch)) return EXTRA_WIDE;
  if (/[A-ZĄĆĘŁŃÓŚŹŻ%&]/.test(ch)) return WIDE;
  return REGULAR;
}

/** Estimated rendered width (px) of a string at the given font size. */
export function estimateTextWidthPx(text: string, fontSizePx: number): number {
  let units = 0;
  for (const ch of text) units += charWidthFactor(ch);
  return Math.round(units * fontSizePx);
}

export type SerpGrade = "empty" | "short" | "good" | "long";

export interface SerpMetric {
  px: number;
  limitPx: number;
  /** 0..1 fill ratio against the truncation limit (may exceed 1). */
  ratio: number;
  grade: SerpGrade;
}

function grade(px: number, minPx: number, limitPx: number): SerpGrade {
  if (px === 0) return "empty";
  if (px < minPx) return "short";
  if (px > limitPx) return "long";
  return "good";
}

/** Metrics for a SERP title candidate. */
export function serpTitleMetric(text: string): SerpMetric {
  const px = estimateTextWidthPx(text.trim(), TITLE_FONT_PX);
  return {
    px,
    limitPx: SERP_TITLE_LIMIT_PX,
    ratio: px / SERP_TITLE_LIMIT_PX,
    grade: grade(px, SERP_TITLE_MIN_PX, SERP_TITLE_LIMIT_PX),
  };
}

/** Metrics for a SERP description candidate (14px font). */
export function serpDescriptionMetric(text: string): SerpMetric {
  const px = estimateTextWidthPx(text.trim(), 14);
  return {
    px,
    limitPx: SERP_DESCRIPTION_LIMIT_PX,
    ratio: px / SERP_DESCRIPTION_LIMIT_PX,
    grade: grade(px, SERP_DESCRIPTION_MIN_PX, SERP_DESCRIPTION_LIMIT_PX),
  };
}

/** Truncate a string to a pixel budget with an ellipsis, for the preview. */
export function truncateToPx(text: string, fontSizePx: number, limitPx: number): string {
  if (estimateTextWidthPx(text, fontSizePx) <= limitPx) return text;
  let out = "";
  let units = 0;
  const budget = (limitPx - fontSizePx) / fontSizePx; // reserve room for the ellipsis
  for (const ch of text) {
    units += charWidthFactor(ch);
    if (units > budget) break;
    out += ch;
  }
  return `${out.trimEnd()}…`;
}
