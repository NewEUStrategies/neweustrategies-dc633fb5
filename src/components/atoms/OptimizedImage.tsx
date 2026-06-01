import { useState, type ImgHTMLAttributes, type CSSProperties } from "react";

type OptimizedImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "loading" | "decoding"> & {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  priority?: boolean;
  aspectRatio?: number;
  fadeIn?: boolean;
};

/**
 * Atom: <OptimizedImage>
 * - Native lazy loading + async decoding (below-the-fold by default).
 * - `priority` opts into eager + high fetch priority for LCP candidates.
 * - Reserves layout via `aspectRatio` to prevent CLS.
 * - Subtle fade-in on load to avoid layout pop.
 */
export function OptimizedImage({
  src,
  alt,
  width,
  height,
  priority = false,
  aspectRatio,
  fadeIn = true,
  className,
  style,
  onLoad,
  ...rest
}: OptimizedImageProps) {
  const [loaded, setLoaded] = useState(priority);

  const ratio =
    aspectRatio ?? (width && height ? width / height : undefined);

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

  return (
    <img
      {...rest}
      src={src}
      alt={alt}
      width={width}
      height={height}
      loading={priority ? "eager" : "lazy"}
      decoding={priority ? "sync" : "async"}
      fetchPriority={priority ? "high" : "auto"}
      className={className}
      style={computedStyle}
      onLoad={(e) => {
        setLoaded(true);
        onLoad?.(e);
      }}
    />
  );
}

export default OptimizedImage;
