import { useEffect, useState, type ImgHTMLAttributes } from "react";
import { mediaVariant, type MediaVariantSurface } from "../lib/mediaVariants";

type NativeImgProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "srcSet">;

interface MediaVariantImageProps extends Omit<NativeImgProps, "alt"> {
  publicUrl: string;
  alt: string;
  surface: MediaVariantSurface;
}

/**
 * Atom: an `<img>` that requests the variant sized for its admin surface and
 * falls back to the original file once if the resizer cannot serve it (for
 * example an unusual format), so a tile is never left blank.
 */
export function MediaVariantImage({
  publicUrl,
  surface,
  alt,
  onError,
  decoding = "async",
  ...rest
}: MediaVariantImageProps) {
  const variant = mediaVariant(publicUrl, surface);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [publicUrl, surface]);

  const useOriginal = failed || !variant.srcSet;
  return (
    <img
      {...rest}
      alt={alt}
      decoding={decoding}
      src={useOriginal ? variant.original : variant.src}
      srcSet={useOriginal ? undefined : variant.srcSet}
      onError={(event) => {
        if (!useOriginal) setFailed(true);
        onError?.(event);
      }}
    />
  );
}
