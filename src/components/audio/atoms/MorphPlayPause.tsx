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
      {/* Play - solidny trójkąt z zaokrąglonymi rogami, wyśrodkowany w polu
          24x24 (krawędź lewa 4.81, czubek z wybrzuszeniem ~19.2), więc w
          okrągłym przycisku nie ucieka w prawo. Większy niż poprzedni glif,
          bo na mobilu mała ikona tonęła w pomarańczowym polu. */}
      <svg
        className="mpp-svg mpp-svg-play"
        viewBox="0 0 24 24"
        fill="currentColor"
        focusable="false"
      >
        <path d="M4.81 4.99c0-1.24 1.36-2.01 2.44-1.38l11.18 7.02a1.6 1.6 0 0 1 0 2.76l-11.18 7.02a1.6 1.6 0 0 1-2.44-1.38V4.99Z" />
      </svg>
      {/* Stop - pełny kwadrat z miękkimi rogami, optycznie zrównoważony
          z trójkątem (ta sama waga wizualna w polu 24x24). */}
      <svg
        className="mpp-svg mpp-svg-stop"
        viewBox="0 0 24 24"
        fill="currentColor"
        focusable="false"
      >
        <rect x="5.6" y="5.6" width="12.8" height="12.8" rx="3.2" />
      </svg>
    </span>
  );
}
