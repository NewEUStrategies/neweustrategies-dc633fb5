import { cn } from "@/lib/utils";

interface AnimatedDownloadIconProps {
  downloading: boolean;
  className?: string;
}

/**
 * Ikona pobierania współdzielona przez kartę artykułu i globalny pasek audio.
 * Ruch strzałki odpowiada faktycznemu stanowi pobierania, zamiast zapętlać demo.
 */
export function AnimatedDownloadIcon({
  downloading,
  className,
}: AnimatedDownloadIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={cn("audio-download-icon", className)}
      data-downloading={downloading ? "true" : "false"}
      focusable="false"
      aria-hidden
    >
      <path
        className="audio-download-icon__tray"
        d="M4 16.5v2A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5v-2"
      />
      <g className="audio-download-icon__arrow">
        <path d="M12 4v11" />
        <path d="m7.75 11 4.25 4.25L16.25 11" />
      </g>
    </svg>
  );
}