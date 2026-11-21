import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Loader2 } from "@/lib/lucide-shim";
import { MediaVariantImage } from "../atoms/MediaVariantImage";

interface MediaPreviewImageProps {
  publicUrl: string;
  alt: string;
}

/**
 * Molecule: progressive image for the preview dialog. The tile-sized variant
 * (already in the browser cache from the grid) paints instantly, then the
 * screen-sized variant fades in over it once decoded - the dialog never
 * opens on an empty canvas while a multi-megabyte original downloads.
 */
export function MediaPreviewImage({ publicUrl, alt }: MediaPreviewImageProps) {
  const { t } = useTranslation();
  const [loaded, setLoaded] = useState(false);
  useEffect(() => setLoaded(false), [publicUrl]);

  return (
    <div className="relative w-full h-full flex items-center justify-center">
      {!loaded && (
        <>
          <MediaVariantImage
            publicUrl={publicUrl}
            surface="tile"
            alt=""
            aria-hidden="true"
            draggable={false}
            className="absolute inset-0 m-auto max-w-full max-h-full w-auto h-full object-contain blur-sm opacity-70"
          />
          <span
            role="status"
            aria-live="polite"
            className="absolute inset-0 flex items-center justify-center"
          >
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" aria-hidden="true" />
            <span className="sr-only">{t("admin.media.previewLoading")}</span>
          </span>
        </>
      )}
      <MediaVariantImage
        key={publicUrl}
        publicUrl={publicUrl}
        surface="preview"
        alt={alt}
        fetchPriority="high"
        onLoad={() => setLoaded(true)}
        onError={() => setLoaded(true)}
        className={cn(
          "relative max-w-full max-h-full object-contain transition-opacity duration-200",
          loaded ? "opacity-100" : "opacity-0",
        )}
      />
    </div>
  );
}
