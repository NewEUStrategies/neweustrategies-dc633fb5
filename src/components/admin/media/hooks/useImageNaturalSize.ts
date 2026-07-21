/**
 * Measures the intrinsic pixel dimensions of an image asset by loading it in a
 * detached <img>. Returns null until measured (or for non-image targets), and
 * re-measures whenever the target image changes.
 */
import { useEffect, useState } from "react";
import type { ImageSize, MediaRow } from "../types";

export function useImageNaturalSize(target: MediaRow | null): ImageSize | null {
  const [size, setSize] = useState<ImageSize | null>(null);

  useEffect(() => {
    setSize(null);
    if (!target?.mime_type?.startsWith("image/") || !target.public_url) return;
    let cancelled = false;
    const img = new window.Image();
    img.onload = () => {
      if (!cancelled) setSize({ w: img.naturalWidth, h: img.naturalHeight });
    };
    img.src = target.public_url;
    return () => {
      cancelled = true;
    };
  }, [target?.id, target?.mime_type, target?.public_url]);

  return size;
}
