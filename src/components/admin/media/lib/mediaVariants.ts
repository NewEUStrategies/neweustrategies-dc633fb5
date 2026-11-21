/**
 * Size-matched image variants for the admin media library.
 *
 * The grid, list, info panel and preview dialog used to request the ORIGINAL
 * upload for every tile (often 1500-2000 px wide, hundreds of KB), so a folder
 * of 60 photos meant tens of megabytes before anything painted. Each surface
 * now asks the `/media/*` route for a width-scaled variant that matches what
 * it actually draws (2x for HiDPI screens). Download, "open in new tab", the
 * dimension readout and copied URLs keep the original file.
 *
 * Non-transformable sources (SVG, external hosts, `data:`) fall back to the
 * render URL unchanged, so nothing breaks for files the storage resizer
 * cannot handle.
 */
import { buildScaledImageUrl, isSupabaseStorageUrl } from "@/lib/cropSizes";
import { mediaRenderUrl } from "@/lib/media/publicUrl";

/** CSS widths (px) of each admin surface that renders an image. */
export const MEDIA_VARIANT_WIDTH = {
  /** List-view icon (24 px square). */
  row: 24,
  /** Grid / picker tile (about 150-200 px square). */
  tile: 200,
  /** Info side panel (max ~320 px). */
  panel: 320,
  /** Full preview dialog. */
  preview: 1280,
} as const;

export type MediaVariantSurface = keyof typeof MEDIA_VARIANT_WIDTH;

/** Largest width the storage resizer serves; bigger requests are clamped. */
const MAX_VARIANT_WIDTH = 2500;

export interface MediaVariant {
  /** 1x candidate (or the original when the file cannot be resized). */
  src: string;
  /** `1x, 2x` density candidates; omitted when the file cannot be resized. */
  srcSet?: string;
  /** Original file at full resolution, for fallback, download and new tab. */
  original: string;
}

function isResizable(renderUrl: string): boolean {
  return (
    !!renderUrl &&
    isSupabaseStorageUrl(renderUrl) &&
    !/\.(?:svg|gif|ico|bmp)(?:[?#]|$)/i.test(renderUrl)
  );
}

/** Variant of `publicUrl` sized for the given admin surface. */
export function mediaVariant(publicUrl: string, surface: MediaVariantSurface): MediaVariant {
  const original = mediaRenderUrl(publicUrl);
  if (!isResizable(original)) return { src: original, original };
  const base = MEDIA_VARIANT_WIDTH[surface];
  const one = Math.min(base, MAX_VARIANT_WIDTH);
  const two = Math.min(base * 2, MAX_VARIANT_WIDTH);
  const src = buildScaledImageUrl(original, one);
  const srcSet = two > one ? `${src} 1x, ${buildScaledImageUrl(original, two)} 2x` : `${src} 1x`;
  return { src, srcSet, original };
}

const prefetched = new Set<string>();
const MAX_PREFETCHED = 200;

/**
 * Warm the browser cache with the preview-dialog variant so a double-click
 * opens on an already-decoded image. Deduplicated per URL; no-op on the server.
 */
export function prefetchMediaPreview(publicUrl: string): void {
  if (typeof window === "undefined" || !publicUrl) return;
  const { src, srcSet } = mediaVariant(publicUrl, "preview");
  const key = srcSet ?? src;
  if (prefetched.has(key)) return;
  if (prefetched.size >= MAX_PREFETCHED) prefetched.clear();
  prefetched.add(key);
  const img = new window.Image();
  img.decoding = "async";
  if (srcSet) img.srcset = srcSet;
  img.src = src;
}

/** Test helper: forget which previews were prefetched. */
export function resetMediaPrefetchCache(): void {
  prefetched.clear();
}
