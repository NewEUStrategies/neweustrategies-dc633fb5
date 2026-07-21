// Atom: animowana ikona play <-> pause z morfującym clip-path.
// Kolory dziedziczone przez currentColor (dark/light OK). Nadaje się do
// dowolnego przycisku - pozycjonuje się absolutnie i przejmuje rounding rodzica.
import { cn } from "@/lib/utils";

export interface MorphPlayPauseProps {
  playing: boolean;
  className?: string;
}

export function MorphPlayPause({ playing, className }: MorphPlayPauseProps) {
  return (
    <span
      className={cn("mpp", className)}
      data-playing={playing ? "true" : "false"}
      aria-hidden
    >
      <span className="mpp-icon">
        <span className="mpp-part mpp-left" />
        <span className="mpp-part mpp-right" />
      </span>
    </span>
  );
}
