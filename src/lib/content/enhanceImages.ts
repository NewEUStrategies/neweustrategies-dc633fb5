// Post-sanitize enhancement pass for legacy/markdown article HTML (imported
// WordPress bodies included). The sanitizer strips dangerous markup but leaves
// author <img> tags bare: no lazy loading, no async decode, no responsive
// candidates - the biggest bandwidth/CLS hole on old posts. This pass upgrades
// every <img> in the already-sanitized string:
//   - loading="lazy" + decoding="async" (when absent),
//   - srcset/sizes via Supabase Storage transforms (transformable URLs only).
//
// SECURITY CONTRACT: run strictly AFTER sanitizeMarkdownHtml/sanitizeHtml -
// this function only ever appends attributes whose values are derived from an
// attribute that already passed sanitization, and re-escapes them for the
// attribute context. It must never be used to bypass or replace the sanitizer.
import { buildImageSrcSet, isSupabaseStorageUrl } from "@/lib/cropSizes";

const IMG_TAG_RE = /<img\b[^>]*?\/?>/gi;
const SRC_RE = /\ssrc\s*=\s*("([^"]*)"|'([^']*)')/i;

/** Widths for in-article images; article prose renders at <=~800px. */
const CONTENT_IMAGE_WIDTHS = [320, 480, 640, 800, 1024, 1280] as const;
const CONTENT_IMAGE_SIZES = "(max-width: 768px) 100vw, 800px";

function unescapeAttr(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function enhanceImgTag(tag: string): string {
  let extra = "";
  if (!/\sloading\s*=/i.test(tag)) extra += ' loading="lazy"';
  if (!/\sdecoding\s*=/i.test(tag)) extra += ' decoding="async"';

  if (!/\ssrcset\s*=/i.test(tag)) {
    const srcMatch = SRC_RE.exec(tag);
    const rawSrc = srcMatch ? unescapeAttr(srcMatch[2] ?? srcMatch[3] ?? "") : "";
    if (rawSrc && isSupabaseStorageUrl(rawSrc)) {
      const srcSet = buildImageSrcSet(rawSrc, CONTENT_IMAGE_WIDTHS);
      if (srcSet) {
        extra += ` srcset="${escapeAttr(srcSet)}"`;
        if (!/\ssizes\s*=/i.test(tag)) extra += ` sizes="${CONTENT_IMAGE_SIZES}"`;
      }
    }
  }

  if (!extra) return tag;
  // Insert right before the closing "/>" or ">".
  const selfClosing = /\/>$/.test(tag);
  const insertAt = selfClosing ? tag.length - 2 : tag.length - 1;
  return tag.slice(0, insertAt) + extra + (selfClosing ? "/>" : ">");
}

/**
 * Upgrade `<img>` tags inside sanitized article HTML with lazy loading and
 * responsive srcset. Pure string transform, SSR-safe (no DOM), idempotent.
 */
export function enhanceContentImages(sanitizedHtml: string): string {
  if (!sanitizedHtml || !sanitizedHtml.includes("<img")) return sanitizedHtml;
  return sanitizedHtml.replace(IMG_TAG_RE, enhanceImgTag);
}
