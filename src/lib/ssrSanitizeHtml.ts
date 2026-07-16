/**
 * Worker-safe HTML sanitizer for the SSR half of `sanitizeHtml` /
 * `sanitizeMarkdownHtml` (see lib/sanitize.ts, which owns the branch).
 *
 * DOMPurify needs a live DOM, and the Cloudflare Worker runtime (workerd) has
 * none: DOMPurify initializes with `isSupported = false` and never defines
 * `sanitize`. The previous `isomorphic-dompurify` dependency went one step
 * further - its browser build calls `purify.sanitize.bind(purify)` at MODULE
 * scope, so merely importing it crashed the whole worker at init and every
 * request (including `/`) died as an opaque h3 `HTTPError` 500. Its Node
 * fallback (jsdom) cannot run on workerd either.
 *
 * So on the server we sanitize with an allowlist walker built on
 * node-html-parser (pure JS, no DOM). Output is REBUILT from decoded text and
 * re-escaped - raw input is never emitted. The failure mode of any parser
 * divergence is therefore escaped visible text, not markup. Only allowlisted
 * tags with allowlisted, value-validated attributes survive:
 *   - script/style/iframe/object/embed/svg/... are dropped WITH their content;
 *   - unknown/forbidden-but-benign tags are unwrapped (children kept), which
 *     mirrors DOMPurify's KEEP_CONTENT default;
 *   - URL attributes must match the same conservative schemes as lib/sanitize's
 *     `safeUrl` / `safeImageUrl`;
 *   - `style` attributes are only kept when the caller opts in (markdown
 *     variant) and never with `url(` / `expression(` / `@import` payloads.
 */
import { parse } from "node-html-parser";
import type { HTMLElement as ParsedElement, Node as ParsedNode } from "node-html-parser";

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

// Removed together with all of their content - executable, style-carrying or
// foreign-namespace containers where "keep the children" would be unsafe.
const DROP_WITH_CONTENT = new Set([
  "script",
  "style",
  "iframe",
  "frame",
  "frameset",
  "object",
  "embed",
  "applet",
  "template",
  "noscript",
  "svg",
  "math",
  "title",
  "head",
  "link",
  "meta",
  "base",
]);

// Standard HTML content tags (the DOMPurify `html` profile equivalent, minus
// the tags the app forbids everywhere: iframe/object/embed/form/style).
const ALLOWED_TAGS = new Set([
  "a",
  "abbr",
  "address",
  "article",
  "aside",
  "audio",
  "b",
  "bdi",
  "bdo",
  "blockquote",
  "br",
  "caption",
  "cite",
  "code",
  "col",
  "colgroup",
  "dd",
  "del",
  "details",
  "dfn",
  "div",
  "dl",
  "dt",
  "em",
  "figcaption",
  "figure",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hgroup",
  "hr",
  "i",
  "img",
  "ins",
  "kbd",
  "li",
  "main",
  "mark",
  "nav",
  "ol",
  "p",
  "picture",
  "pre",
  "q",
  "rp",
  "rt",
  "ruby",
  "s",
  "samp",
  "section",
  "small",
  "source",
  "span",
  "strong",
  "sub",
  "summary",
  "sup",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "time",
  "tr",
  "track",
  "u",
  "ul",
  "video",
  "wbr",
]);

const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

// Attributes allowed on every tag. data-* / aria-* are matched by prefix.
const GLOBAL_ATTRS = new Set(["class", "id", "title", "dir", "lang", "role", "translate"]);

const TAG_ATTRS: Record<string, Set<string>> = {
  a: new Set(["href", "target", "rel", "name"]),
  img: new Set(["src", "alt", "width", "height", "loading", "decoding"]),
  td: new Set(["colspan", "rowspan", "scope", "headers"]),
  th: new Set(["colspan", "rowspan", "scope", "headers", "abbr"]),
  col: new Set(["span"]),
  colgroup: new Set(["span"]),
  ol: new Set(["start", "type", "reversed"]),
  li: new Set(["value"]),
  time: new Set(["datetime"]),
  details: new Set(["open"]),
  blockquote: new Set(["cite"]),
  q: new Set(["cite"]),
  ins: new Set(["cite", "datetime"]),
  del: new Set(["cite", "datetime"]),
  audio: new Set(["src", "controls", "preload", "loop", "muted"]),
  video: new Set([
    "src",
    "controls",
    "preload",
    "loop",
    "muted",
    "poster",
    "width",
    "height",
    "playsinline",
  ]),
  source: new Set(["src", "srcset", "type", "media"]),
  track: new Set(["src", "kind", "srclang", "label", "default"]),
};

// Same conservative URL policies as lib/sanitize's safeUrl / safeImageUrl.
// The values are entity-DECODED before testing, so `java&#115;cript:` and
// friends cannot sneak past; anything not matching is dropped, which also
// kills whitespace/control-character scheme obfuscation.
const SAFE_URL_RE = /^(https?:|mailto:|tel:|\/|#)/i;
const SAFE_IMG_URL_RE = /^(https?:|data:image\/|\/)/i;
const SAFE_MEDIA_URL_RE = /^(https?:|\/)/i;

// `style` attribute payloads that can trigger requests or (legacy) script.
const UNSAFE_STYLE_RE = /(url\s*\(|expression\s*\(|javascript:|@import|<)/i;

const escapeText = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttr = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export interface SsrSanitizeOptions {
  /** Keep (hardened) `style` attributes - the markdown variant allows them. */
  allowStyleAttr?: boolean;
}

function isSafeUrl(tag: string, name: string, value: string): boolean {
  if (tag === "img" && name === "src") return SAFE_IMG_URL_RE.test(value);
  if (name === "poster") return SAFE_IMG_URL_RE.test(value);
  if (name === "src" || name === "srcset") return SAFE_MEDIA_URL_RE.test(value);
  return SAFE_URL_RE.test(value);
}

function sanitizeAttrs(
  tag: string,
  attrs: Record<string, string>,
  opts: SsrSanitizeOptions,
): string {
  let out = "";
  for (const [rawName, rawValue] of Object.entries(attrs)) {
    const name = rawName.toLowerCase();
    // Reject exotic attribute names outright (also excludes on* handlers,
    // which are not in any allowlist to begin with).
    if (!/^[a-z][a-z0-9-]*$/.test(name) || name.startsWith("on")) continue;

    const isAllowed =
      GLOBAL_ATTRS.has(name) ||
      name.startsWith("data-") ||
      name.startsWith("aria-") ||
      TAG_ATTRS[tag]?.has(name) ||
      (name === "style" && opts.allowStyleAttr === true);
    if (!isAllowed) continue;

    const value = String(rawValue ?? "");
    if (
      (name === "href" ||
        name === "src" ||
        name === "srcset" ||
        name === "cite" ||
        name === "poster") &&
      value &&
      !isSafeUrl(tag, name, value)
    ) {
      continue;
    }
    if (name === "style" && UNSAFE_STYLE_RE.test(value)) continue;
    if (name === "target" && value !== "_blank" && value !== "_self") continue;

    out += value === "" ? ` ${name}` : ` ${name}="${escapeAttr(value)}"`;
  }
  return out;
}

function sanitizeNode(node: ParsedNode, opts: SsrSanitizeOptions, out: string[]): void {
  if (node.nodeType === TEXT_NODE) {
    // `text` is the entity-DECODED content; re-escaping it neutralizes any
    // markup a browser might otherwise find where the parser saw plain text.
    out.push(escapeText(node.text));
    return;
  }
  if (node.nodeType !== ELEMENT_NODE) return; // comments, doctypes, CDATA

  const el = node as ParsedElement;
  const tag = (el.rawTagName ?? "").toLowerCase();

  // Parser root / fragment wrapper: descend without emitting anything.
  if (!tag) {
    for (const child of el.childNodes) sanitizeNode(child, opts, out);
    return;
  }
  if (DROP_WITH_CONTENT.has(tag)) return;
  if (!ALLOWED_TAGS.has(tag)) {
    // Unknown or forbidden-but-benign (form, dialog, ...) - unwrap children.
    for (const child of el.childNodes) sanitizeNode(child, opts, out);
    return;
  }

  out.push(`<${tag}${sanitizeAttrs(tag, el.attributes, opts)}>`);
  if (VOID_TAGS.has(tag)) return;
  for (const child of el.childNodes) sanitizeNode(child, opts, out);
  out.push(`</${tag}>`);
}

/** Sanitize untrusted HTML without a DOM. See module docs for the model. */
export function ssrSanitizeHtml(dirty: string, opts: SsrSanitizeOptions = {}): string {
  if (!dirty) return "";
  // node-html-parser surfaces doctypes as plain text nodes; drop them up front
  // so they are not re-escaped into visible output.
  const withoutDoctype = dirty.replace(/<!doctype[^>]*>/gi, "");
  // `pre` is deliberately NOT a block-text element (the default) so nested
  // markup like <pre><code> survives; its text content is re-escaped anyway.
  const root = parse(withoutDoctype, {
    comment: false,
    blockTextElements: { script: true, style: true, noscript: true },
  });
  const out: string[] = [];
  sanitizeNode(root, opts, out);
  return out.join("");
}
