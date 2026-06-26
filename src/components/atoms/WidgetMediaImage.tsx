import type { CSSProperties, ReactEventHandler } from "react";
import { OptimizedImage } from "@/components/atoms/OptimizedImage";

interface WidgetMediaImageProps {
  src: string | null | undefined;
  alt?: string;
  frameClassName: string;
  sizes?: string;
  responsiveWidths?: readonly number[];
  priority?: boolean;
  style?: CSSProperties;
  foregroundClassName?: string;
  foregroundStyle?: CSSProperties;
  onError?: ReactEventHandler<HTMLImageElement>;
}

/**
 * Shared widget image frame: shows the original image fully inside the tile,
 * without synthetic fills, blurred backgrounds, crop, or zoom.
 */
export function WidgetMediaImage({
  src,
  alt = "",
  frameClassName,
  sizes,
  responsiveWidths,
  priority = false,
  style,
  foregroundClassName = "absolute inset-0 block h-full w-full object-contain",
  foregroundStyle,
  onError,
}: WidgetMediaImageProps) {
  if (!src) {
    return <span data-widget-media className={frameClassName} style={style} />;
  }

  const responsiveProps = {
    responsive: true,
    responsiveWidths,
    sizes,
    priority,
  };

  return (
    <span data-widget-media className={frameClassName} style={style}>
      <OptimizedImage
        src={src}
        alt={alt}
        {...responsiveProps}
        className={`${foregroundClassName} widget-media-fg`}
        style={foregroundStyle}
        onError={onError}
      />
    </span>
  );
}