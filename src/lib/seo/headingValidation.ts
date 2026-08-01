// Content structure validation for the SEO panel. Scans a post's HTML body
// AND its block tree looking for heading anomalies that hurt SEO:
//   - No H1 present (or empty H1)
//   - More than one H1 on the page
//   - Skipped heading levels (H2 -> H4, H3 -> H5, ...)
// Pure - given the raw content payloads, returns per-language issues that
// mirror the SeoIssue shape so the SeoPanel can render them alongside the
// title/description warnings.

export type HeadingIssueKind =
  | "missing_h1"
  | "multiple_h1"
  | "extra_h1"
  | "skipped_level"
  | "empty_heading"
  | "duplicate_heading"
  | "too_long_heading"
  | "shouty_heading";
export type HeadingIssueSeverity = "error" | "warning";
export type HeadingIssueLang = "pl" | "en";

export interface HeadingIssue {
  lang: HeadingIssueLang;
  kind: HeadingIssueKind;
  severity: HeadingIssueSeverity;
  /** Details for skipped_level: the jump we detected. */
  from?: number;
  to?: number;
  /** Count of H1s (multiple_h1 / extra_h1) or empty headings / duplicates. */
  count?: number;
  /** 1-based position of the heading in document order. */
  position?: number;
  /** Short plain-text snippet of the affected heading. */
  snippet?: string;
}

interface HeadingRef {
  level: number;
  text: string;
}

const HTML_HEADING_RE = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi;

function stripTags(input: string): string {
  return input
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Extract heading refs from an HTML body string. */
export function headingsFromHtml(html: string | null | undefined): HeadingRef[] {
  if (!html) return [];
  const out: HeadingRef[] = [];
  let match: RegExpExecArray | null;
  const re = new RegExp(HTML_HEADING_RE);
  while ((match = re.exec(html)) !== null) {
    out.push({ level: Number(match[1]), text: stripTags(match[2] ?? "") });
  }
  return out;
}

/**
 * Extract heading refs from a block tree. We look for objects with a `type`
 * hint of "heading" or "header" and read `level`/`data.level`/`props.level`.
 * Handles common Editor.js, Gutenberg and custom builder shapes.
 */
export function headingsFromBlocks(blocks: unknown): HeadingRef[] {
  const out: HeadingRef[] = [];
  const visit = (node: unknown): void => {
    if (!node) return;
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    if (typeof node !== "object") return;
    const rec = node as Record<string, unknown>;
    const rawType = rec.type ?? rec.blockName ?? rec.name;
    const type = typeof rawType === "string" ? rawType.toLowerCase() : "";
    if (type.includes("heading") || type === "header" || type === "core/heading") {
      const data =
        (rec.data as Record<string, unknown> | undefined) ??
        (rec.props as Record<string, unknown> | undefined) ??
        (rec.attributes as Record<string, unknown> | undefined) ??
        rec;
      const rawLevel = data.level ?? data.headingLevel ?? data.tag ?? rec.level;
      const parsed =
        typeof rawLevel === "number"
          ? rawLevel
          : typeof rawLevel === "string"
            ? Number(rawLevel.replace(/[^0-9]/g, ""))
            : NaN;
      const level = Number.isFinite(parsed) && parsed >= 1 && parsed <= 6 ? parsed : 2;
      const rawText = data.text ?? data.content ?? data.title ?? rec.text ?? rec.content ?? "";
      const text = typeof rawText === "string" ? stripTags(rawText) : "";
      out.push({ level, text });
    }
    // Recurse into any nested containers.
    for (const key of Object.keys(rec)) {
      const child = rec[key];
      if (child && typeof child === "object") visit(child);
    }
  };
  visit(blocks);
  return out;
}

/** Combine HTML and block sources; block tree wins when both are present. */
export function collectHeadings(input: { html?: string | null; blocks?: unknown }): HeadingRef[] {
  const fromBlocks = headingsFromBlocks(input.blocks);
  if (fromBlocks.length > 0) return fromBlocks;
  return headingsFromHtml(input.html);
}

/** Truncate to a readable snippet without cutting mid-word. */
function snippet(text: string, max = 60): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 20 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

export interface ValidateHeadingsOptions {
  /**
   * True when the page/post layout already renders the primary title as an
   * `<h1>` outside the block editor - so the body should NOT add another H1.
   * Suppresses `missing_h1` and reclassifies any body H1 as `extra_h1`.
   */
  rendersTitleAsH1?: boolean;
  /** Max recommended heading length (chars) before flagging `too_long_heading`. */
  maxHeadingChars?: number;
}

/** Compute the set of heading issues for a single language variant. */
export function validateHeadings(
  lang: HeadingIssueLang,
  input: { html?: string | null; blocks?: unknown },
  options: ValidateHeadingsOptions = {},
): HeadingIssue[] {
  const { rendersTitleAsH1 = false, maxHeadingChars = 70 } = options;
  const headings = collectHeadings(input);
  // Empty document -> no signal to flag (editor may be new/draft).
  if (headings.length === 0) return [];

  const issues: HeadingIssue[] = [];

  const h1Indices = headings.map((h, i) => (h.level === 1 ? i : -1)).filter((i) => i >= 0);
  if (rendersTitleAsH1) {
    // Layout renders the H1; any body H1 is a duplicate.
    if (h1Indices.length > 0) {
      issues.push({
        lang,
        kind: "extra_h1",
        severity: "warning",
        count: h1Indices.length,
        position: h1Indices[0] + 1,
        snippet: snippet(headings[h1Indices[0]].text),
      });
    }
  } else if (h1Indices.length === 0) {
    issues.push({ lang, kind: "missing_h1", severity: "warning" });
  } else if (h1Indices.length > 1) {
    issues.push({
      lang,
      kind: "multiple_h1",
      severity: "error",
      count: h1Indices.length,
      position: h1Indices[1] + 1,
      snippet: snippet(headings[h1Indices[1]].text),
    });
  }

  // Empty headings - report count + position of the first one.
  const emptyIdx = headings.findIndex((h) => h.text.length === 0);
  if (emptyIdx >= 0) {
    const count = headings.filter((h) => h.text.length === 0).length;
    issues.push({
      lang,
      kind: "empty_heading",
      severity: "warning",
      count,
      position: emptyIdx + 1,
    });
  }

  // Skipped levels - report the first jump with heading text as context.
  let prev = headings[0].level;
  for (let i = 1; i < headings.length; i++) {
    const cur = headings[i].level;
    if (cur > prev + 1) {
      issues.push({
        lang,
        kind: "skipped_level",
        severity: "warning",
        from: prev,
        to: cur,
        position: i + 1,
        snippet: headings[i].text ? snippet(headings[i].text) : undefined,
      });
      break;
    }
    prev = cur;
  }

  // Overly long H2/H3 (SERP-scale hurdle) - single warning.
  const longIdx = headings.findIndex(
    (h) => h.level >= 2 && h.level <= 3 && [...h.text].length > maxHeadingChars,
  );
  if (longIdx >= 0) {
    issues.push({
      lang,
      kind: "too_long_heading",
      severity: "warning",
      position: longIdx + 1,
      count: [...headings[longIdx].text].length,
      snippet: snippet(headings[longIdx].text),
    });
  }

  // ALL-CAPS heading (>= 8 letters, >70% uppercase) - readability signal.
  const shoutyIdx = headings.findIndex((h) => {
    const letters = h.text.replace(/[^\p{L}]/gu, "");
    if (letters.length < 8) return false;
    const upper = letters.replace(/[^\p{Lu}]/gu, "").length;
    return upper / letters.length > 0.7;
  });
  if (shoutyIdx >= 0) {
    issues.push({
      lang,
      kind: "shouty_heading",
      severity: "warning",
      position: shoutyIdx + 1,
      snippet: snippet(headings[shoutyIdx].text),
    });
  }

  // Duplicate heading text (case/whitespace-insensitive), across H2..H6.
  const seen = new Map<string, number>();
  for (let i = 0; i < headings.length; i++) {
    if (headings[i].level < 2 || !headings[i].text) continue;
    const key = headings[i].text.toLowerCase().replace(/\s+/g, " ").trim();
    if (seen.has(key)) {
      issues.push({
        lang,
        kind: "duplicate_heading",
        severity: "warning",
        position: i + 1,
        snippet: snippet(headings[i].text),
      });
      break;
    }
    seen.set(key, i);
  }

  return issues;
}
