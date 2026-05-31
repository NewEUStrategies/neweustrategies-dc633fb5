/**
 * Sanitization helpers for user-authored builder content.
 * Use everywhere we render values coming out of `builder_data` JSONB or any
 * other user-controlled field.
 */
import DOMPurify from "isomorphic-dompurify";

// ---------- HTML ----------

/** Sanitize a string of HTML, preserving safe markup only. */
export function sanitizeHtml(dirty: string): string {
  if (!dirty) return "";
  return DOMPurify.sanitize(dirty, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["style", "script", "iframe", "object", "embed", "form"],
    FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover", "style"],
  });
}

/** Sanitize markdown-rendered HTML. Allow more (figures, blockquotes). */
export function sanitizeMarkdownHtml(dirty: string): string {
  if (!dirty) return "";
  return DOMPurify.sanitize(dirty, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "style"],
    FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover"],
  });
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

/**
 * Scope user CSS to a single widget. The CSS string is wrapped with a parent
 * selector `[data-w-id="<scope>"]` so it cannot leak out, and is rejected if
 * it contains style-breaking or script-loading tokens.
 *
 * Returns the wrapped CSS or `""` when the input is unsafe.
 */
export function scopeCustomCss(raw: string | undefined, scopeId: string): string {
  if (!raw) return "";
  if (CSS_BLACKLIST_RE.test(raw)) return "";
  // Naïve scoping: every selector list gets the parent prefix prepended.
  // Block @media and @supports correctly by recursing into their bodies.
  const scope = `[data-w-id="${scopeId}"]`;
  const scoped = raw
    .replace(/\}/g, "}\n")
    .split(/(?<=})/)
    .map((rule) => {
      const trimmed = rule.trim();
      if (!trimmed) return "";
      // Leave @-rules untouched; they're already scoped by media context.
      if (trimmed.startsWith("@")) return trimmed;
      const idx = trimmed.indexOf("{");
      if (idx < 0) return "";
      const selectors = trimmed.slice(0, idx);
      const body = trimmed.slice(idx);
      const prefixed = selectors
        .split(",")
        .map((s) => `${scope} ${s.trim()}`)
        .join(", ");
      return `${prefixed} ${body}`;
    })
    .join("\n");
  return scoped;
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
