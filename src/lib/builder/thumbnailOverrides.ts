// Per-post thumbnail overrides for list/slider/gallery widgets.
// Stored on widget content as `thumbnailOverrides`: { [postId]: url }.
import type { WidgetContent } from "@/lib/builder/types";

export type ThumbnailOverrides = Record<string, string>;

export function readThumbnailOverrides(c: WidgetContent): ThumbnailOverrides {
  const raw = c["thumbnailOverrides"];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: ThumbnailOverrides = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "string" && v.trim()) out[k] = v.trim();
  }
  return out;
}

export function setThumbnailOverride(
  current: ThumbnailOverrides,
  postId: string,
  url: string,
): ThumbnailOverrides {
  const next = { ...current };
  if (url && url.trim()) next[postId] = url.trim();
  else delete next[postId];
  return next;
}
