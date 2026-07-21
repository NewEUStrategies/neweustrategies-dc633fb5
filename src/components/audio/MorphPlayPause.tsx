// Atom: czytelna ikona play <-> stop z płynnym crossfade + skalowaniem.
// Kolory z currentColor (dark/light OK). Kształty w SVG dla ostrości na każdym DPI.
import { cn } from "@/lib/utils";

export interface MorphPlayPauseProps {
  playing: boolean;
  className?: string;
}

export function MorphPlayPause({ playing, className }: MorphPlayPauseProps) {
  return (
    <span className={cn("mpp", className)} data-playing={playing ? "true" : "false"} aria-hidden>
      {/* Play - trójkąt z lekko zaokrąglonymi wierzchołkami */}
      <svg
        className="mpp-svg mpp-svg-play"
        viewBox="0 0 24 24"
        fill="currentColor"
        focusable="false"
      >
        <path d="M8.4 5.5c0-1.1 1.2-1.8 2.15-1.24l10.02 6.5a1.44 1.44 0 0 1 0 2.48l-10.02 6.5A1.44 1.44 0 0 1 8.4 18.5V5.5Z" />
      </svg>
      {/* Stop - zaokrąglony kwadrat */}
      <svg
        className="mpp-svg mpp-svg-stop"
        viewBox="0 0 24 24"
        fill="currentColor"
        focusable="false"
      >
        <rect x="5.5" y="5.5" width="13" height="13" rx="2.2" />
      </svg>
    </span>
  );
}
