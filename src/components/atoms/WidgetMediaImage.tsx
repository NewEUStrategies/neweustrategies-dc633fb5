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
  backgroundClassName?: string;
  onError?: ReactEventHandler<HTMLImageElement>;
}

/**
 * Shared widget image frame: fills the tile visually with a soft cover layer,
 * while the foreground image stays fully visible without crop or zoom.
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
  backgroundClassName = "absolute inset-0 block h-full w-full object-cover widget-media-bg",
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
        alt=""
        aria-hidden
        {...responsiveProps}
        className={backgroundClassName}
        fadeIn={false}
      />
      <span aria-hidden className="widget-media-scrim absolute inset-0" />
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