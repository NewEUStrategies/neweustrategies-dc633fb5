/**
 * Pure classification of media assets by MIME type and file extension.
 *
 * Two independent axes:
 *  - `resolveMediaCategory` drives the thumbnail icon in grid/list views.
 *  - `resolvePreviewKind` drives which viewer the preview dialog mounts.
 *
 * Both are deterministic and side-effect free so they can be unit-tested and
 * reused by any surface (grid, list, preview, picker) without divergence.
 */
import { extOf } from "./mediaFormat";

export type MediaCategory = "image" | "video" | "audio" | "pdf" | "document" | "ebook" | "other";

const DOCUMENT_EXT = /^(doc|docx|odt|rtf|xls|xlsx|ods|csv)$/;
const EBOOK_EXT = /^(epub|mobi|azw3)$/;

/** Coarse category used to pick a thumbnail icon. */
export function resolveMediaCategory(
  mime: string | null | undefined,
  filename: string,
): MediaCategory {
  const ext = extOf(filename).toLowerCase();
  if (mime?.startsWith("video/")) return "video";
  if (mime?.startsWith("audio/")) return "audio";
  if (mime === "application/pdf" || ext === "pdf") return "pdf";
  if (DOCUMENT_EXT.test(ext)) return "document";
  if (EBOOK_EXT.test(ext)) return "ebook";
  if (mime?.startsWith("image/")) return "image";
  return "other";
}

/**
 * True when a real bitmap/vector should be rendered inline as an <img> in the
 * grid. Animated GIFs are intentionally shown as an icon (matching the legacy
 * behaviour) to avoid a wall of auto-playing thumbnails.
 */
export function isRenderableImage(mime: string | null | undefined, filename: string): boolean {
  const ext = extOf(filename).toLowerCase();
  return !!mime?.startsWith("image/") && ext !== "gif";
}

export type PreviewKind = "image" | "video" | "audio" | "pdf" | "text" | "office" | "other";

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp", "ico"]);
const VIDEO_EXT = new Set(["mp4", "webm", "mov", "m4v", "ogv"]);
const AUDIO_EXT = new Set(["mp3", "wav", "ogg", "m4a", "flac"]);
const TEXT_EXT = new Set([
  "txt",
  "md",
  "csv",
  "json",
  "log",
  "xml",
  "html",
  "css",
  "js",
  "ts",
  "tsx",
  "jsx",
]);
const OFFICE_EXT = new Set(["doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp"]);

/** Which viewer the preview dialog should mount for a given asset. */
export function resolvePreviewKind(
  mime: string | null | undefined,
  filename: string | null | undefined,
): PreviewKind {
  if (!filename && !mime) return "other";
  const m = mime ?? "";
  const ext = filename ? extOf(filename).toLowerCase() : "";
  if (m.startsWith("image/") || IMAGE_EXT.has(ext)) return "image";
  if (m.startsWith("video/") || VIDEO_EXT.has(ext)) return "video";
  if (m.startsWith("audio/") || AUDIO_EXT.has(ext)) return "audio";
  if (m === "application/pdf" || ext === "pdf") return "pdf";
  if (m.startsWith("text/") || TEXT_EXT.has(ext)) return "text";
  if (OFFICE_EXT.has(ext)) return "office";
  return "other";
}
