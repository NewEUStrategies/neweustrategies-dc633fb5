/**
 * Sanitization helpers for user-authored builder content.
 * Use everywhere we render values coming out of `builder_data` JSONB or any
 * other user-controlled field.
 *
 * Two engines behind one API:
 *   - Browser: DOMPurify. Imported from `dompurify` directly - NEVER from
 *     `isomorphic-dompurify`, whose browser build calls
 *     `purify.sanitize.bind(purify)` at module scope and therefore crashes the
 *     whole Cloudflare Worker at init (no DOM -> no `sanitize` -> TypeError ->
 *     every request 500s as an opaque h3 HTTPError), and whose Node fallback
 *     (jsdom) cannot run on workerd either.
 *   - Server (SSR in workerd / Node dev): the allowlist walker in
 *     lib/ssrSanitizeHtml. The `import.meta.env.SSR` branch is statically
 *     replaced per build target, so the client bundle tree-shakes the parser
 *     away and the worker bundle never calls DOMPurify.
 */
import DOMPurify from "dompurify";

import { ssrSanitizeHtml } from "./ssrSanitizeHtml";

// ---------- HTML ----------

/** Sanitize a string of HTML, preserving safe markup only. */
export function sanitizeHtml(dirty: string): string {
  if (!dirty) return "";
  if (import.meta.env.SSR) return ssrSanitizeHtml(dirty);
  return DOMPurify.sanitize(dirty, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["style", "script", "iframe", "object", "embed", "form"],
    FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover", "style"],
  });
}

/** Sanitize markdown-rendered HTML. Allow more (figures, blockquotes). */
export function sanitizeMarkdownHtml(dirty: string): string {
  if (!dirty) return "";
  if (import.meta.env.SSR) return ssrSanitizeHtml(dirty, { allowStyleAttr: true });
  return DOMPurify.sanitize(dirty, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "style"],
    FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover"],
  });
}

// ---------- Plain text ----------

const HTML_ENTITY_MAP: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "-",
  mdash: "-",
  hellip: "…",
  laquo: "«",
  raquo: "»",
  bull: "•",
  copy: "©",
  reg: "®",
  trade: "™",
};

/**
 * Convert an HTML-ish string to clean plain text for display in UI surfaces
 * that render as text (cards, admin fields, widget descriptions, meta bars).
 *
 * Behaviour:
 * - Block-level tags (`p`, `div`, `br`, `li`, `h1`-`h6`, `tr`) become line
 *   breaks so paragraphs stay readable in `whitespace-pre-line` / `pre-wrap`.
 * - All other tags are removed.
 * - Common named / numeric HTML entities are decoded.
 * - Runs of whitespace inside a line are collapsed; blank lines are capped
 *   at one.
 *
 * SSR-safe (no DOMParser / document access).
 */
export function htmlToPlainText(input: string | null | undefined): string {
  if (!input) return "";
  // If the string has no tag / entity markers, short-circuit.
  if (!/[<&]/.test(input)) return input.trim();

  let out = input;
  // Normalise block boundaries to newlines BEFORE stripping tags.
  out = out.replace(/<\s*(br)\s*\/?>/gi, "\n");
  out = out.replace(
    /<\s*\/\s*(p|div|li|h[1-6]|tr|section|article|header|footer|blockquote|pre)\s*>/gi,
    "\n",
  );
  // List item bullets.
  out = out.replace(/<\s*li[^>]*>/gi, "• ");
  // Strip any remaining tags.
  out = out.replace(/<[^>]+>/g, "");
  // Decode entities.
  out = out.replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)));
  out = out.replace(/&#x([0-9a-f]+);/gi, (_, n: string) =>
    String.fromCodePoint(Number.parseInt(n, 16)),
  );
  out = out.replace(/&([a-z]+);/gi, (m, name: string) => {
    const v = HTML_ENTITY_MAP[name.toLowerCase()];
    return v ?? m;
  });
  // Collapse whitespace inside lines, cap blank lines to 1.
  out = out
    .split("\n")
    .map((l) => l.replace(/[ \t\f\v\u00a0]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return out;
}

// ---------- HTML id / class ----------

const ID_RE = /^[A-Za-z][\w-]{0,63}$/;
const CLASS_RE = /^[\w- ]{0,200}$/;

export function sanitizeHtmlId(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  return ID_RE.test(raw) ? raw : undefined;
}

export function sanitizeCssClass(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  return CLASS_RE.test(raw) ? raw : undefined;
}

// ---------- Custom CSS (scoped per widget) ----------

const CSS_BLACKLIST_RE =
  /(<\s*\/?\s*(style|script|html|body)|@import|javascript\s*:|expression\s*\(|behavior\s*:)/i;

// Conditional group rules whose *inner* selectors still need scoping.
const NESTED_AT_RULE_RE = /^@(media|supports|container|layer|scope)\b/i;
// At-rules whose body must be emitted verbatim - their "selectors" are keyframe
// stops (`0%`, `from`) or descriptors, which must NOT get the widget prefix.
const RAW_AT_RULE_RE =
  /^@(keyframes|-webkit-keyframes|-moz-keyframes|font-face|page|counter-style|property|font-feature-values)\b/i;

/**
 * Scope user CSS to a single widget. Every selector is prefixed with a parent
 * selector `[data-w-id="<scope>"]` so it cannot leak out - including selectors
 * nested inside `@media` / `@supports` / `@container` blocks, which are walked
 * recursively. `@keyframes` / `@font-face` / `@page` bodies are emitted as-is
 * (their inner "selectors" must not be prefixed). The input is rejected if it
 * contains style-breaking or script-loading tokens.
 *
 * Returns the scoped CSS or `""` when the input is unsafe.
 *
 * Note: brace matching is not string-aware, so a `{`/`}` inside a CSS string
 * value (e.g. `content: "}"`) is not supported - acceptable for widget CSS.
 */
export function scopeCustomCss(raw: string | undefined, scopeId: string): string {
  if (!raw) return "";
  if (CSS_BLACKLIST_RE.test(raw)) return "";
  return scopeCssRules(raw, `[data-w-id="${scopeId}"]`);
}

// Split CSS into top-level rules (respecting nested braces) and scope each.
function scopeCssRules(css: string, scope: string): string {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        const scoped = scopeCssRule(css.slice(start, i + 1), scope);
        if (scoped) out.push(scoped);
        start = i + 1;
      }
    }
  }
  return out.join("\n");
}

function scopeCssRule(rule: string, scope: string): string {
  const trimmed = rule.trim();
  const braceIdx = trimmed.indexOf("{");
  const closeIdx = trimmed.lastIndexOf("}");
  if (braceIdx < 0 || closeIdx <= braceIdx) return "";
  const prelude = trimmed.slice(0, braceIdx).trim();
  const body = trimmed.slice(braceIdx + 1, closeIdx).trim();
  if (RAW_AT_RULE_RE.test(prelude)) return `${prelude} { ${body} }`;
  if (NESTED_AT_RULE_RE.test(prelude)) return `${prelude} { ${scopeCssRules(body, scope)} }`;
  const prefixed = prelude
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => `${scope} ${s}`)
    .join(", ");
  return `${prefixed} { ${body} }`;
}

// ---------- URLs ----------

const SAFE_URL_RE = /^(https?:|mailto:|tel:|\/|#)/i;
const SAFE_IMG_URL_RE = /^(https?:|data:image\/|\/)/i;

export function safeUrl(raw: string | undefined, fallback = "#"): string {
  if (!raw) return fallback;
  return SAFE_URL_RE.test(raw) ? raw : fallback;
}

export function safeImageUrl(raw: string | undefined): string {
  if (!raw) return "";
  return SAFE_IMG_URL_RE.test(raw) ? raw : "";
}

// ---------- Injected <style> hardening ----------

/**
 * Harden a CSS string before it is written into a `<style>` element via
 * dangerouslySetInnerHTML. `<style>` is a raw-text element: HTML entities are
 * NOT decoded inside it, so the only way a stored value (theme colour, font
 * name, size) can escape into HTML - and run script - is the literal `</style>`
 * end tag, e.g. a colour stored as `red}</style><script>…`. We drop the `<`
 * from any `</style>` / `</script>` end tag and `<!--` comment opener so data
 * can no longer close the element. Valid CSS never contains these sequences, so
 * legitimate rules (including `>` child combinators and range-syntax media
 * queries) pass through unchanged. Use this for ANY data-derived `<style>`.
 */
export function hardenStyleCss(css: string): string {
  return String(css)
    .replace(/<(?=\s*\/\s*(?:style|script)\b)/gi, "")
    .replace(/<(?=!--)/g, "");
}
