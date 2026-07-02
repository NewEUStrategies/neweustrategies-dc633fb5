import type { CSSProperties, ReactEventHandler } from "react";
import { OptimizedImage, type HoverEffect } from "@/components/atoms/OptimizedImage";

interface WidgetMediaImageProps {
  src: string | null | undefined;
  alt?: string;
  frameClassName: string;
  sizes?: string;
  responsiveWidths?: readonly number[];
  priority?: boolean;
  objectFit?: CSSProperties["objectFit"];
  style?: CSSProperties;
  foregroundClassName?: string;
  foregroundStyle?: CSSProperties;
  onError?: ReactEventHandler<HTMLImageElement>;
  hoverEffect?: HoverEffect;
}

type WidgetMediaFrameStyle = CSSProperties & {
  "--widget-media-fit"?: CSSProperties["objectFit"];
};

/**
 * Shared widget image frame: paints one real image into a stable widget tile.
 * The default is cover, so media fills the reserved image field instead of
 * collapsing visually into a narrow strip. Components can opt into contain.
 */
export function WidgetMediaImage({
  src,
  alt = "",
  frameClassName,
  sizes,
  responsiveWidths,
  priority = false,
  objectFit = "cover",
  style,
  foregroundClassName = "absolute inset-0 block h-full w-full object-cover",
  foregroundStyle,
  onError,
}: WidgetMediaImageProps) {
  const frameStyle: WidgetMediaFrameStyle = {
    ...style,
    "--widget-media-fit": objectFit,
  };

  if (!src) {
    return <span data-widget-media className={frameClassName} style={frameStyle} />;
  }

  const responsiveProps = {
    responsive: true,
    responsiveWidths,
    sizes,
    priority,
  };

  return (
    <span data-widget-media className={frameClassName} style={frameStyle}>
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