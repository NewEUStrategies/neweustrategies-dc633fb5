import { useState, type ImgHTMLAttributes, type CSSProperties } from "react";
import { buildTransformedImageUrl } from "@/lib/cropSizes";

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
  className,
  style,
  onLoad,
  ...rest
}: OptimizedImageProps) {
  const [loaded, setLoaded] = useState(priority);

  const ratio =
    aspectRatio ?? (width && height ? width / height : undefined);

  const finalSrc = crop ? buildTransformedImageUrl(src, crop) : src;

  const computedStyle: CSSProperties = {
    ...(ratio ? { aspectRatio: String(ratio) } : null),
    ...(fadeIn
      ? {
          opacity: loaded ? 1 : 0,
          transition: "opacity 240ms ease-out",
        }
      : null),
    ...style,
  };

  const imgEl = (
    <img
      {...rest}
      src={finalSrc}
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
