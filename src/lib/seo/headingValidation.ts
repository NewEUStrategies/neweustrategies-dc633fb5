// Content structure validation for the SEO panel. Scans a post's HTML body
// AND its block tree looking for heading anomalies that hurt SEO:
//   - No H1 present (or empty H1)
//   - More than one H1 on the page
//   - Skipped heading levels (H2 -> H4, H3 -> H5, ...)
// Pure - given the raw content payloads, returns per-language issues that
// mirror the SeoIssue shape so the SeoPanel can render them alongside the
// title/description warnings.

export type HeadingIssueKind = "missing_h1" | "multiple_h1" | "skipped_level" | "empty_heading";
export type HeadingIssueSeverity = "error" | "warning";
export type HeadingIssueLang = "pl" | "en";

export interface HeadingIssue {
  lang: HeadingIssueLang;
  kind: HeadingIssueKind;
  severity: HeadingIssueSeverity;
  /** Details for skipped_level: the jump we detected. */
  from?: number;
  to?: number;
  /** Count of H1s when kind = multiple_h1. */
  count?: number;
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

/** Compute the set of heading issues for a single language variant. */
export function validateHeadings(
  lang: HeadingIssueLang,
  input: { html?: string | null; blocks?: unknown },
): HeadingIssue[] {
  const headings = collectHeadings(input);
  // Empty document -> no signal to flag (editor may be new/draft).
  if (headings.length === 0) return [];

  const issues: HeadingIssue[] = [];

  const h1s = headings.filter((h) => h.level === 1);
  if (h1s.length === 0) {
    issues.push({ lang, kind: "missing_h1", severity: "warning" });
  } else if (h1s.length > 1) {
    issues.push({ lang, kind: "multiple_h1", severity: "error", count: h1s.length });
  }

  // Any completely empty heading is a warning.
  if (headings.some((h) => h.text.length === 0)) {
    issues.push({ lang, kind: "empty_heading", severity: "warning" });
  }

  // Detect skipped levels within the body. Compare only consecutive headings
  // and skip the transition from H1 (title) into the body.
  let prev = headings[0].level;
  for (let i = 1; i < headings.length; i++) {
    const cur = headings[i].level;
    if (cur > prev + 1) {
      issues.push({ lang, kind: "skipped_level", severity: "warning", from: prev, to: cur });
      break; // one issue is enough - avoids noisy repeated warnings
    }
    prev = cur;
  }

  return issues;
}
