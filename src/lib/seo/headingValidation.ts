// Content structure validation for the SEO panel. Scans a post's HTML body
// AND its block tree looking for heading anomalies that hurt SEO:
//   - No H1 present (or empty H1)
//   - More than one H1 on the page
//   - Skipped heading levels (H2 -> H4, H3 -> H5, ...), measured from the
//     layout's H1 when the layout renders the title as H1
// Headings are read the way the browser renders them: comments and
// non-rendered containers (iframe fallback, noscript, template, script,
// style, textarea) are ignored and HTML entities are decoded before any
// length / duplicate comparison.
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

// ---------------------------------------------------------------------------
// What the browser actually renders.
//
// The scanner used to be one flat regex over the raw source, so it counted
// headings the reader never sees and measured text the reader never reads.
// Three layers fix that, each linear in the input (this runs on every
// keystroke in the editor, so no regex here may backtrack over the document):
//   1. `visibleHtml` drops regions the HTML parser never turns into rendered
//      elements (comments and the containers listed below),
//   2. `headingsFromHtml` pairs `<hN>` with the first `</hN>` using
//      precomputed close positions instead of a lazy `[\s\S]*?` scan,
//   3. `headingText` strips inline tags, decodes entities ONCE and collapses
//      whitespace - the string a reader sees is the string we measure.
// ---------------------------------------------------------------------------

/**
 * Containers whose content is never rendered as document headings:
 *   - `iframe`   - RAWTEXT in the HTML parser; the "fallback" markup between
 *                  the tags is never parsed into elements (the frame shows
 *                  its `src` document instead),
 *   - `noscript` - RAWTEXT when scripting is enabled, which is how both our
 *                  readers and Googlebot's evergreen renderer see the page,
 *   - `template` - parsed into an inert DocumentFragment, never rendered
 *                  until script clones it,
 *   - `script` / `style` - raw text by definition; a `"<h2>"` inside a JS
 *                  string or a CSS comment is not a heading,
 *   - `textarea` - RCDATA: `<h2>` inside it is shown as literal text.
 * Deliberately NOT here: `blockquote`, `figure`/`figcaption`, `details`,
 * `aside` - their headings ARE real DOM headings and stay counted.
 */
const NON_RENDERED_CONTAINERS: ReadonlySet<string> = new Set([
  "iframe",
  "noscript",
  "template",
  "script",
  "style",
  "textarea",
]);

/**
 * Opening or closing tag name at a `<` position (sticky - matches only exactly
 * at `lastIndex`). Group 1 is `/` for an end tag.
 */
const TAG_NAME_AT = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)(?=[\s/>]|$)/y;

/** `\t \n \f \r` and space - the HTML tokenizer's whitespace. */
function isHtmlSpace(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0c || code === 0x0d;
}

/**
 * End (exclusive) of the tag whose name ends at `from`: the first `>` that is
 * NOT inside a quoted attribute value, so `<img alt="<script>">` is one
 * `<img>` tag and its `<script>` is attribute text, not a container. A quote
 * opens a value only right after `=` (as in the tokenizer), so `<a it's>`
 * stays a plain tag. Returns -1 when the tag runs to EOF (no `>` or an
 * unterminated quoted value) - the browser then renders nothing after it.
 */
function tagEnd(html: string, from: number): number {
  let j = from;
  while (j < html.length) {
    const code = html.charCodeAt(j);
    if (code === 0x3e /* > */) return j + 1;
    j++;
    if (code !== 0x3d /* = */) continue;
    while (j < html.length && isHtmlSpace(html.charCodeAt(j))) j++;
    const quote = html[j];
    if (quote === '"' || quote === "'") {
      const close = html.indexOf(quote, j + 1);
      if (close < 0) return -1;
      j = close + 1;
    }
  }
  return -1;
}

/** Closing-tag finders per container, built once and reused (`lastIndex` reset per use). */
const CONTAINER_CLOSE = new Map<string, RegExp>(
  [...NON_RENDERED_CONTAINERS].map((name) => [name, new RegExp(`</${name}(?=[\\s/>]|$)`, "gi")]),
);
/** `<template>` nests (it is parsed as a fragment, not raw text), so depth is counted. */
const TEMPLATE_TAG = /<(\/?)template(?=[\s/>]|$)/gi;

/** End (exclusive) of a comment starting at `lt`; unclosed comment swallows the rest, as in the browser. */
function commentEnd(html: string, lt: number): number {
  // `<!-->` and `<!--->` are complete (abruptly closed) comments per the HTML spec.
  if (html.startsWith("<!-->", lt)) return lt + 5;
  if (html.startsWith("<!--->", lt)) return lt + 6;
  const close = html.indexOf("-->", lt + 4);
  return close < 0 ? html.length : close + 3;
}

/** End (exclusive) of a non-rendered container whose opening tag ends at `from`. */
function containerEnd(html: string, name: string, from: number): number {
  let closeAt = -1;
  if (name === "template") {
    let depth = 1;
    TEMPLATE_TAG.lastIndex = from;
    for (let m = TEMPLATE_TAG.exec(html); m !== null; m = TEMPLATE_TAG.exec(html)) {
      depth += m[1] ? -1 : 1;
      if (depth === 0) {
        closeAt = m.index;
        break;
      }
    }
  } else {
    const re = CONTAINER_CLOSE.get(name);
    if (re) {
      re.lastIndex = from;
      closeAt = re.exec(html)?.index ?? -1;
    }
  }
  // Unclosed container: the parser keeps it open to EOF, so nothing after it renders.
  if (closeAt < 0) return html.length;
  const gt = html.indexOf(">", closeAt);
  return gt < 0 ? html.length : gt + 1;
}

/**
 * The source with comments and non-rendered containers cut out. Returns the
 * input unchanged (same string) when there is nothing to cut.
 *
 * Every tag is stepped over WHOLE (quote-aware, see `tagEnd`): a `<script`,
 * `<textarea` or `<!--` inside an attribute value is attribute text and must
 * not open a region that swallows the rest of the document - legacy / WP
 * import markup does not always escape `<` in `alt` or `title`. A tag that
 * runs to EOF (unterminated quoted value) cuts the rest, as the browser does.
 * Each character is visited once: tags are skipped by their end, containers
 * by their closing tag.
 */
export function visibleHtml(html: string): string {
  const parts: string[] = [];
  let cursor = 0;
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt < 0) break;
    let cutEnd = -1;
    if (html.startsWith("<!--", lt)) {
      cutEnd = commentEnd(html, lt);
    } else {
      TAG_NAME_AT.lastIndex = lt;
      const m = TAG_NAME_AT.exec(html);
      if (!m) {
        // `<` that does not start a tag (`a < b`, `<3`) is text.
        i = lt + 1;
        continue;
      }
      const end = tagEnd(html, lt + m[0].length);
      const name = m[2].toLowerCase();
      if (end < 0) {
        cutEnd = html.length;
      } else if (!m[1] && NON_RENDERED_CONTAINERS.has(name)) {
        cutEnd = containerEnd(html, name, end);
      } else {
        i = end;
        continue;
      }
    }
    parts.push(html.slice(cursor, lt));
    cursor = i = cutEnd;
  }
  if (cursor === 0) return html;
  parts.push(html.slice(cursor));
  return parts.join("");
}

/**
 * Named entities we decode. The HTML core set, typographic punctuation that
 * WYSIWYG editors and the WordPress import emit, and the Polish letters (the
 * editorial language). A `Map`, not an object literal: `&constructor;` must
 * not resolve to `Object.prototype.constructor`. Names are case-sensitive,
 * as in HTML (`&Oacute;` is not `&oacute;`). Unknown names stay verbatim.
 */
const NAMED_ENTITIES: ReadonlyMap<string, string> = new Map([
  ["nbsp", "\u00a0"],
  ["ensp", "\u2002"],
  ["emsp", "\u2003"],
  ["thinsp", "\u2009"],
  ["amp", "&"],
  ["lt", "<"],
  ["gt", ">"],
  ["quot", '"'],
  ["apos", "'"],
  ["hellip", "\u2026"],
  ["ndash", "\u2013"],
  ["mdash", "\u2014"],
  ["lsquo", "\u2018"],
  ["rsquo", "\u2019"],
  ["ldquo", "\u201c"],
  ["rdquo", "\u201d"],
  ["bdquo", "\u201e"],
  ["laquo", "\u00ab"],
  ["raquo", "\u00bb"],
  ["oacute", "\u00f3"],
  ["Oacute", "\u00d3"],
  ["aogon", "\u0105"],
  ["Aogon", "\u0104"],
  ["cacute", "\u0107"],
  ["Cacute", "\u0106"],
  ["eogon", "\u0119"],
  ["Eogon", "\u0118"],
  ["lstrok", "\u0142"],
  ["Lstrok", "\u0141"],
  ["nacute", "\u0144"],
  ["Nacute", "\u0143"],
  ["sacute", "\u015b"],
  ["Sacute", "\u015a"],
  ["zacute", "\u017a"],
  ["Zacute", "\u0179"],
  ["zdot", "\u017c"],
  ["Zdot", "\u017b"],
]);

// One alternation, one pass: `&amp;nbsp;` decodes to the literal "&nbsp;",
// never to a space (no double decoding). Every branch is a single character
// class terminated by `;`, which none of the classes contains - no backtracking.
const ENTITY_RE = /&(?:#[xX]([0-9a-fA-F]+)|#([0-9]+)|([a-zA-Z][a-zA-Z0-9]*));/g;

/** Out-of-range, NUL and surrogate code points become U+FFFD, as in the HTML parser (and never throw). */
function codePoint(cp: number): string {
  if (!Number.isFinite(cp) || cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) {
    return "\ufffd";
  }
  return String.fromCodePoint(cp);
}

/** Decode named / decimal / hex HTML entities exactly once. */
export function decodeHtmlEntities(input: string): string {
  if (!input.includes("&")) return input;
  return input.replace(
    ENTITY_RE,
    (raw, hex: string | undefined, dec: string | undefined, name: string | undefined) => {
      if (name !== undefined) return NAMED_ENTITIES.get(name) ?? raw;
      return codePoint(
        hex !== undefined ? Number.parseInt(hex, 16) : Number.parseInt(dec ?? "", 10),
      );
    },
  );
}

/**
 * Same result as `fragment.replace(/<[^>]*>/g, "")`, but linear: once no `>`
 * is left, no later `<` can start a tag, so the rest is kept verbatim instead
 * of being rescanned from every remaining `<` (quadratic on `<a<a<a...`).
 */
function stripInlineTags(fragment: string): string {
  let lt = fragment.indexOf("<");
  if (lt < 0) return fragment;
  let out = "";
  let cursor = 0;
  while (lt >= 0) {
    const gt = fragment.indexOf(">", lt);
    if (gt < 0) break;
    out += fragment.slice(cursor, lt);
    cursor = gt + 1;
    lt = fragment.indexOf("<", cursor);
  }
  return out + fragment.slice(cursor);
}

/** Text the reader sees: inline tags removed, entities decoded (after, so `&lt;b&gt;` stays text), whitespace collapsed. */
function headingText(fragment: string): string {
  return decodeHtmlEntities(stripInlineTags(fragment)).replace(/\s+/g, " ").trim();
}

/**
 * True when the body has ANY text a reader would see - after dropping
 * comments / non-rendered containers, stripping tags and decoding entities
 * (`<p>&nbsp;</p>`, the empty-editor `<p></p>` and a lone comment are all
 * "no text"). Lets a caller tell "this language has no content yet" (e.g. a
 * post without an EN translation) from "content without headings" - only the
 * latter is a heading check that could not run. Media-only bodies (`<img>`)
 * count as no text: there is nothing a heading could structure.
 */
export function hasReadableText(html: string | null | undefined): boolean {
  if (!html) return false;
  return headingText(visibleHtml(html)).length > 0;
}

/** `<hN` at a `<` position; `\b` as in the original scanner (`<h2-x>` still opens an H2). */
const HEADING_OPEN_AT = /<h([1-6])\b/iy;
/** Exact closing tag, no whitespace - the original contract (`<\/h\1>`). */
const HEADING_CLOSE = /<\/h([1-6])>/gi;

/** Extract heading refs from an HTML body string. */
export function headingsFromHtml(html: string | null | undefined): HeadingRef[] {
  if (!html) return [];
  const src = visibleHtml(html);
  // Close positions per level, ascending. A `<hN>` pairs with the first
  // `</hN>` after its opening tag; opens are visited in document order, so
  // one forward pointer per level keeps the whole pairing linear.
  const closes: number[][] = [[], [], [], [], [], [], []];
  HEADING_CLOSE.lastIndex = 0;
  for (let m = HEADING_CLOSE.exec(src); m !== null; m = HEADING_CLOSE.exec(src)) {
    closes[Number(m[1])].push(m.index);
  }
  if (closes.every((c) => c.length === 0)) return [];
  const next = [0, 0, 0, 0, 0, 0, 0];
  const out: HeadingRef[] = [];
  let i = 0;
  let gt = -1;
  while (i < src.length) {
    const lt = src.indexOf("<", i);
    if (lt < 0) break;
    HEADING_OPEN_AT.lastIndex = lt;
    const m = HEADING_OPEN_AT.exec(src);
    if (!m) {
      i = lt + 1;
      continue;
    }
    // First `>` after the opening `<` (cached: it is still valid while it lies
    // ahead of `lt`). No `>` left means no complete tag left - stop.
    if (gt < lt) gt = src.indexOf(">", lt);
    if (gt < 0) break;
    const level = Number(m[1]);
    const levelCloses = closes[level];
    let p = next[level];
    while (p < levelCloses.length && levelCloses[p] <= gt) p++;
    next[level] = p;
    if (p >= levelCloses.length) {
      // Unclosed heading: skipped, scanning resumes inside it (headings
      // nested in the unclosed one are still found).
      i = lt + 1;
      continue;
    }
    const closeAt = levelCloses[p];
    out.push({ level, text: headingText(src.slice(gt + 1, closeAt)) });
    i = closeAt + 5; // "</hN>".length
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
      const text = typeof rawText === "string" ? headingText(visibleHtml(rawText)) : "";
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
   * Suppresses `missing_h1`, reclassifies any body H1 as `extra_h1` and makes
   * that layout H1 the starting point of the hierarchy check: content opening
   * with an H3 is a real H1 -> H3 gap in the rendered DOM.
   */
  rendersTitleAsH1?: boolean;
  /** Max recommended heading length (chars) before flagging `too_long_heading`. */
  maxHeadingChars?: number;
}

/**
 * Result of a heading check. `headingCount` is what lets a caller tell "checked
 * and clean" (`issues: []`, `headingCount > 0`) from "nothing to check"
 * (`issues: []`, `headingCount === 0`) - the issue list alone cannot.
 */
export interface HeadingReport {
  issues: HeadingIssue[];
  /** Rendered headings found (after dropping comments / non-rendered containers). */
  headingCount: number;
}

/** Compute the set of heading issues for a single language variant. */
export function validateHeadings(
  lang: HeadingIssueLang,
  input: { html?: string | null; blocks?: unknown },
  options: ValidateHeadingsOptions = {},
): HeadingIssue[] {
  return analyzeHeadings(lang, input, options).issues;
}

/** `validateHeadings` plus the number of headings it actually looked at. */
export function analyzeHeadings(
  lang: HeadingIssueLang,
  input: { html?: string | null; blocks?: unknown },
  options: ValidateHeadingsOptions = {},
): HeadingReport {
  const { rendersTitleAsH1 = false, maxHeadingChars = 70 } = options;
  const headings = collectHeadings(input);
  // Empty document -> no signal to flag (editor may be new/draft). The caller
  // sees `headingCount: 0` and must not present this as "checked, no issues".
  if (headings.length === 0) return { issues: [], headingCount: 0 };

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
  // With the title rendered as H1 by the layout, the first content heading is
  // measured against that H1 (level 1), not against itself.
  let prev = rendersTitleAsH1 ? 1 : headings[0].level;
  for (let i = rendersTitleAsH1 ? 0 : 1; i < headings.length; i++) {
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

  return { issues, headingCount: headings.length };
}
