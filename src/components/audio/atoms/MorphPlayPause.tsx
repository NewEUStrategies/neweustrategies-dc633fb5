// Atom: czytelna ikona play <-> pauza z płynnym crossfade + skalowaniem.
// Kolory z currentColor (dark/light OK). Kształty w SVG dla ostrości na każdym DPI.
import { cn } from "@/lib/utils";

export interface MorphPlayPauseProps {
  playing: boolean;
  className?: string;
}

export function MorphPlayPause({ playing, className }: MorphPlayPauseProps) {
  return (
    <span className={cn("mpp", className)} data-playing={playing ? "true" : "false"} aria-hidden>
      {/* Play - geometrycznie wycentrowany trójkąt. */}
      <svg
        className="mpp-svg mpp-svg-play"
        viewBox="0 0 24 24"
        fill="currentColor"
        focusable="false"
      >
        <path d="M8.75 5.9c0-1.08 1.18-1.75 2.12-1.2l9.72 6.1a1.4 1.4 0 0 1 0 2.4l-9.72 6.1a1.4 1.4 0 0 1-2.12-1.2V5.9Z" />
      </svg>
      {/* Pauza - dwa optycznie wycentrowane, zaokrąglone słupki. */}
      <svg
        className="mpp-svg mpp-svg-pause"
        viewBox="0 0 24 24"
        fill="currentColor"
        focusable="false"
      >
        <rect x="6.5" y="5" width="4.25" height="14" rx="1.4" />
        <rect x="13.25" y="5" width="4.25" height="14" rx="1.4" />
      </svg>
    </span>
  );
}
