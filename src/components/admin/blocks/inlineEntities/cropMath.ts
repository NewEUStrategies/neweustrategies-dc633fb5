// Czyste pomocniki kadrowania obrazu encji inline (bez Reacta).

import type { CSSProperties } from "react";
import type { Area, MediaSize, Size } from "react-easy-crop";
import { mediaStoragePath } from "@/lib/media/publicUrl";
import { supabase } from "@/integrations/supabase/client";

/**
 * Adres, z którego canvas może odczytać piksele. Markowy `/media/…` nie wysyła
 * nagłówków CORS, więc dla plików z magazynu bierzemy bezpośredni adres
 * magazynu (publiczny kubełek wysyła `Access-Control-Allow-Origin: *`).
 */
export function corsSafeImageSource(src: string): string {
  if (src.startsWith("data:") || src.startsWith("blob:")) return src;
  const path = mediaStoragePath(src);
  if (!path) return src;
  return supabase.storage.from("media").getPublicUrl(path).data.publicUrl || src;
}

/** Ogranicza przesunięcie tak, by obraz zawsze wypełniał kadr. */
export function clampCropOffset(
  offset: { x: number; y: number },
  media: Pick<MediaSize, "width" | "height"> | null,
  crop: Size | null,
  zoom: number,
): { x: number; y: number } {
  if (!media || !crop) return offset;
  const maxX = Math.max(0, (media.width * zoom - crop.width) / 2);
  const maxY = Math.max(0, (media.height * zoom - crop.height) / 2);
  return {
    x: Math.min(Math.max(offset.x, -maxX), maxX),
    y: Math.min(Math.max(offset.y, -maxY), maxY),
  };
}

/** Styl podglądu kadru w kwadracie o boku `size` px (procenty z react-easy-crop). */
export function croppedPreviewStyle(area: Area): CSSProperties {
  return {
    position: "absolute",
    width: `${(100 / area.width) * 100}%`,
    height: `${(100 / area.height) * 100}%`,
    left: `${-(area.x / area.width) * 100}%`,
    top: `${-(area.y / area.height) * 100}%`,
    maxWidth: "none",
  };
}
