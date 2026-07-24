// Post-sanitize enhancement pass for legacy/markdown article HTML (imported
// WordPress bodies included). The sanitizer strips dangerous markup but leaves
// author <img> tags bare: no lazy loading, no async decode, no responsive
// candidates, and - the biggest layout-shift hole on old posts - no intrinsic
// width/height, so the browser reserves no box and the article jumps as each
// image streams in (poor CLS). This pass upgrades every <img> in the
// already-sanitized string:
//   - loading="lazy" + decoding="async" (when absent),
//   - srcset/sizes via Supabase Storage transforms (transformable URLs only),
//   - width/height from a KNOWN intrinsic size (never guessed) so the browser
//     reserves the aspect-ratio box up front.
//
// CLS / no-distortion contract: we only ever set width/height from a source we
// can trust for the EXACT file - an attribute the author already wrote, or the
// WordPress sized-variant filename suffix `-WIDTHxHEIGHT.ext` (that is the
// intrinsic size of that specific rendition). We never invent dimensions. The
// attributes only define the aspect ratio for space reservation; Tailwind
// Preflight applies `img { max-width:100%; height:auto }` globally, so the
// image still scales responsively - the width/height never stretch it.
//
// SECURITY CONTRACT: run strictly AFTER sanitizeMarkdownHtml/sanitizeHtml -
// this function only ever appends attributes whose values are derived from an
// attribute that already passed sanitization, and re-escapes them for the
// attribute context. It must never be used to bypass or replace the sanitizer.
import { buildImageSrcSet, isSupabaseStorageUrl } from "@/lib/cropSizes";

const IMG_TAG_RE = /<img\b[^>]*?\/?>/gi;
const SRC_RE = /\ssrc\s*=\s*("([^"]*)"|'([^']*)')/i;

// WordPress sized-variant suffix: `photo-1024x768.jpg` (optionally ?query/#hash).
// The two numbers ARE the intrinsic pixel dimensions of that rendition. Requires
// >=2 digits per side (skips retina `@2x`-style and sub-10px tracking artefacts)
// and an image extension, so it never matches an incidental `-2x3` in a path.
const WP_DIM_SUFFIX_RE = /[-_](\d{2,5})x(\d{2,5})\.(?:jpe?g|png|gif|webp|avif)(?:$|[?#])/i;

/** Widths for in-article images; article prose renders at <=~800px. */
const CONTENT_IMAGE_WIDTHS = [320, 480, 640, 800, 1024, 1280] as const;
const CONTENT_IMAGE_SIZES = "(max-width: 768px) 100vw, 800px";

/**
 * Intrinsic width/height of an image URL when it is KNOWN, else null. Only the
 * WordPress `-WIDTHxHEIGHT.ext` filename convention is trusted - it is the exact
 * size of that rendition, not a guess. Bounds guard absurd values.
 */
export function imageDimsFromUrl(url: string): { width: number; height: number } | null {
  const m = WP_DIM_SUFFIX_RE.exec(url);
  if (!m) return null;
  const width = Number(m[1]);
  const height = Number(m[2]);
  if (!Number.isInteger(width) || !Number.isInteger(height)) return null;
  if (width < 10 || height < 10 || width > 20000 || height > 20000) return null;
  return { width, height };
}

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

  const srcMatch = SRC_RE.exec(tag);
  const rawSrc = srcMatch ? unescapeAttr(srcMatch[2] ?? srcMatch[3] ?? "") : "";

  if (!/\ssrcset\s*=/i.test(tag) && rawSrc && isSupabaseStorageUrl(rawSrc)) {
    const srcSet = buildImageSrcSet(rawSrc, CONTENT_IMAGE_WIDTHS);
    if (srcSet) {
      extra += ` srcset="${escapeAttr(srcSet)}"`;
      if (!/\ssizes\s*=/i.test(tag)) extra += ` sizes="${CONTENT_IMAGE_SIZES}"`;
    }
  }

  // Reserve the aspect-ratio box (kill CLS) only when we KNOW the intrinsic
  // size and the author set neither dimension. If either width or height is
  // already present we leave both alone - a partial override would distort.
  if (!/\swidth\s*=/i.test(tag) && !/\sheight\s*=/i.test(tag) && rawSrc) {
    const dims = imageDimsFromUrl(rawSrc);
    if (dims) extra += ` width="${dims.width}" height="${dims.height}"`;
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
