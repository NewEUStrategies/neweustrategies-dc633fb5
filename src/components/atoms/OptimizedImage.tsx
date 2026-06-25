import { useState, type ImgHTMLAttributes, type CSSProperties } from "react";
import { buildTransformedImageUrl, buildImageSrcSet, RESPONSIVE_WIDTHS } from "@/lib/cropSizes";

export type HoverEffect = "none" | "zoom" | "fade" | "slide";

type OptimizedImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "loading" | "decoding"> & {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  priority?: boolean;
  aspectRatio?: number;
  fadeIn?: boolean;
  /** Optional hover effect (wraps img in overflow-hidden container). */
  hoverEffect?: HoverEffect;
  /** Optional crop preset - applies Supabase image transform. */
  crop?: { width: number; height: number; resize?: "cover" | "contain" | "fill" };
  /**
   * Opt into a responsive srcSet of width-scaled variants (Supabase storage
   * images only). Mutually exclusive with `crop`. Pair with `sizes` to tell the
   * browser how wide the image renders so it can pick the smallest sufficient
   * candidate - a real bandwidth/LCP win on cards and covers.
   */
  responsive?: boolean;
  responsiveWidths?: readonly number[];
  sizes?: string;
  quality?: number;
};

/**
 * Atom: <OptimizedImage>
 * - Native lazy loading + async decoding (below-the-fold by default).
 * - `priority` opts into eager + high fetch priority for LCP candidates.
 * - Reserves layout via `aspectRatio` to prevent CLS.
 * - Subtle fade-in on load to avoid layout pop.
 * - Optional `hoverEffect` ("zoom" | "fade" | "slide") wraps the img.
 * - Optional `crop` applies Supabase storage image transform.
 */
export function OptimizedImage({
  src,
  alt,
  width,
  height,
  priority = false,
  aspectRatio,
  fadeIn = true,
  hoverEffect = "none",
  crop,
  responsive = false,
  responsiveWidths = RESPONSIVE_WIDTHS,
  sizes,
  quality,
  className,
  style,
  onLoad,
  ...rest
}: OptimizedImageProps) {
  const [loaded, setLoaded] = useState(priority);
  const [errored, setErrored] = useState(false);

  const ratio =
    aspectRatio ?? (width && height ? width / height : undefined);

  const finalSrc = crop ? buildTransformedImageUrl(src, crop) : src;
  // Responsive srcSet only when opted-in, no fixed crop, and the source is a
  // transformable storage URL (else "" -> we omit srcSet, no broken candidates).
  const srcSet = !crop && responsive ? buildImageSrcSet(src, responsiveWidths, quality) : "";

  const computedStyle: CSSProperties = {
    ...(ratio ? { aspectRatio: String(ratio) } : null),
    ...(fadeIn && !errored
      ? { opacity: loaded ? 1 : 0, transition: "opacity 240ms ease-out" }
      : null),
    ...style,
  };

  if (errored || !finalSrc) {
    return (
      <span
        aria-label={alt}
        role="img"
        className={`inline-flex items-center justify-center bg-muted/40 text-muted-foreground ${className ?? ""}`}
        style={{ ...(ratio ? { aspectRatio: String(ratio) } : null), ...style }}
      >
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <path d="m21 15-5-5L5 21" />
        </svg>
      </span>
    );
  }

  const imgEl = (
    <img
      {...rest}
      src={finalSrc}
      srcSet={srcSet || undefined}
      sizes={srcSet ? (sizes ?? "100vw") : sizes}
      alt={alt}
      width={width}
      height={height}
      loading={priority ? "eager" : "lazy"}
      decoding={priority ? "sync" : "async"}
      fetchPriority={priority ? "high" : "auto"}
      className={hoverEffect === "none" ? className : `${className ?? ""} oi-img`}
      style={computedStyle}
      onLoad={(e) => {
        setLoaded(true);
        onLoad?.(e);
      }}
      onError={() => {
        if (typeof console !== "undefined") {
          // eslint-disable-next-line no-console
          console.warn("[OptimizedImage] failed to load", finalSrc);
        }
        setErrored(true);
      }}
    />
  );

  if (hoverEffect === "none") return imgEl;

  // Hover effects need a containing element. CSS in styles.css ships defaults;
  // here we set inline class hooks the consumer's CSS layer can target.
  return (
    <span
      className={`oi-wrap oi-hover-${hoverEffect} block overflow-hidden`}
      style={ratio ? { aspectRatio: String(ratio) } : undefined}
    >
      {imgEl}
    </span>
  );
}

export default OptimizedImage;
