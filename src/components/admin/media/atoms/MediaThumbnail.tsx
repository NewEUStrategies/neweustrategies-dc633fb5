import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { MediaRow } from "../types";
import { extOf } from "../lib/mediaFormat";
import { isRenderableImage, resolveMediaCategory } from "../lib/mediaKind";
import { MediaTypeIcon } from "./MediaTypeIcon";

interface MediaThumbnailProps {
  file: MediaRow;
  className?: string;
  /** Optional overlay (e.g. a selection badge) rendered inside the square. */
  overlay?: ReactNode;
}

/**
 * Atom: the square preview tile used in the grid. Renders the bitmap for real
 * images, or a type icon + extension label for everything else (animated GIFs
 * intentionally show the icon rather than autoplaying).
 */
export function MediaThumbnail({ file, className, overlay }: MediaThumbnailProps) {
  const renderable = isRenderableImage(file.mime_type, file.filename);
  return (
    <div className={cn("aspect-square bg-muted/30 flex items-center justify-center", className)}>
      {renderable ? (
        <img
          src={file.public_url}
          alt={file.alt_text || file.filename}
          className="w-full h-full object-cover"
          loading="lazy"
          draggable={false}
        />
      ) : (
        <div className="flex flex-col items-center justify-center text-muted-foreground gap-1">
          <MediaTypeIcon category={resolveMediaCategory(file.mime_type, file.filename)} />
          <span className="text-[9px] leading-[11px]">{extOf(file.filename)}</span>
        </div>
      )}
      {overlay}
    </div>
  );
}
