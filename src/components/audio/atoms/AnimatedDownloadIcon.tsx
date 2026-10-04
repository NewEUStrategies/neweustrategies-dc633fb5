import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface AnimatedDownloadIconProps {
  downloading: boolean;
  className?: string;
}

/** Czas wyświetlania „ptaszka” po zakończonym pobieraniu (ms). */
export const DOWNLOAD_DONE_VISIBLE_MS = 1600;

/**
 * Ikona pobierania współdzielona przez kartę artykułu i globalny pasek audio.
 * Download → Done: strzałka opada do tacki w trakcie pobierania, a po
 * zakończeniu rysuje się „ptaszek”, po czym ikona wraca do stanu spoczynku.
 */
export function AnimatedDownloadIcon({
  downloading,
  className,
}: AnimatedDownloadIconProps) {
  const [done, setDone] = useState(false);
  const wasDownloading = useRef(downloading);

  useEffect(() => {
    if (wasDownloading.current && !downloading) {
      setDone(true);
      const id = window.setTimeout(() => setDone(false), DOWNLOAD_DONE_VISIBLE_MS);
      wasDownloading.current = downloading;
      return () => window.clearTimeout(id);
    }
    if (downloading) setDone(false);
    wasDownloading.current = downloading;
    return undefined;
  }, [downloading]);

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={cn("audio-download-icon", downloading && "animate-spin", className)}
      data-downloading={downloading ? "true" : "false"}
      data-done={done ? "true" : "false"}
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
      <path
        className="audio-download-icon__check"
        d="M8 12.5l3 3 5-6"
        pathLength={1}
      />
    </svg>
  );
}
